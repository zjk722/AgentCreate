"""生成流程的编排（§5.1 的 ① 规划、§7.4 的自纠环）。

    ① generate   ✅ 通了（Prompt → 调模型 → 栈组装）
    ② check      ✅ 通了（§7.2 ① 的 7 条，在 `domain/validation.py`）
    ③ repair     ❌ **还没有** —— 有 error 时【不会】自动重试修正

  所以现在：**有阻断性问题就直说，不修。**

  §7.4 的 repair 环（generate → check → 有 error → 把**具体 issues 回喂** → 再 check，
  cap 1–2 轮）要等 A3 的"循环控制"。在它到位之前，一张有 error 的图会**原样交给用户** ——
  由 §7.1 的闸门拦住"开始执行"，让用户知道该改哪儿。
  **这不算静默**（用户看得见 issue），但也不算完整。

⚑ CLI 和将来的 FastAPI 路由都调**这一个函数**，别各写一遍 ——
  那是 §14.2 的镜像双实现，只不过发生在同一侧。
"""

from dataclasses import dataclass
from typing import Any

from app.domain.validation import validate_generated
from app.llm.client import PlanCallError, call_json
from app.llm.prompts import build_messages
from app.planner.outline import LevelSkipError, assemble
from app.tools.registry import load_tools


@dataclass
class PlanResult:
    goal: str
    nodes: list[dict[str, Any]]
    issues: list[dict[str, Any]]
    usage: dict[str, int]
    # ⚠️ 这条字段存在，就是为了让"没报 issue"不被读成"通过"
    check_implemented: bool = False


def plan_goal(goal: str, *, max_depth: int = 3, max_children: int = 6) -> PlanResult:
    """目标 → 任务图骨架（§3.4 的 `/v1/plan` 干的就是这件事）。"""
    tools = load_tools()
    messages = build_messages(goal, tools, max_depth, max_children)
    data, usage = call_json(messages)

    level_nodes = data.get("nodes")
    if not isinstance(level_nodes, list):
        keys = "、".join(map(str, data)) if isinstance(data, dict) else type(data).__name__
        raise PlanCallError(
            f"模型返回的 json 里没有 `nodes` 数组（顶层有：{keys}）。\n"
            "  这通常意味着 PLAN_OUTPUT_SCHEMA 和 Prompt 正文对不上。"
        )

    # ② check —— 必须在组装【之前】跑：这 7 条看的是 `level` 表示（§7.2 ①）
    issues = validate_generated(level_nodes, max_depth=max_depth, max_children=max_children)

    # ③ 组装
    # ⚑ 跳级的图【装不出来】—— 组装器拒绝它（它**不修复**，见 planner/outline.py）。
    #   校验已经把同一件事报成 E_LEVEL_SKIP 了，所以这里只是不产树。
    #
    #   其余阻断性问题（标题超长、多个根…）**照样把树装出来**：
    #   前端的闸门会拦住"开始执行"（§7.1），而用户需要先【看见图】才知道要改哪儿。
    try:
        nodes = assemble(level_nodes)
    except LevelSkipError:
        nodes = []

    return PlanResult(
        goal=goal,
        nodes=nodes,
        issues=issues,
        usage=usage,
        check_implemented=True,
    )
