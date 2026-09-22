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

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from app.domain.validation import validate_generated
from app.llm.client import PlanCallError, call_json
from app.llm.prompts import PLAN_OUTPUT_SCHEMA, SYSTEM_PROMPT, build_messages
from app.planner.deps import resolve_depends
from app.planner.outline import LevelSkipError, assemble
from app.tools.registry import load_tools


def prompt_fingerprint() -> str:
    """这一版 Prompt 的指纹 —— 回答"**这个结果是哪一版产出的**"。

    ⚑ 为什么需要它：改了 `prompts.py` 之后，**从外面没有任何办法知道
       正在跑的那个进程用的是哪一版**。

       `uvicorn --reload` 什么时候重载完、有没有干净地杀掉旧 worker ——
       这些都看不见。而表现是"**有时候结果对、有时候不对**"，
       页面上一切正常（#13 的形状：错的东西看起来是对的）。

       有了指纹，页面上直接显示它，一眼就能分辨。
       ⚑ 顺带把那个"两个 worker 抢同一个端口"的坑也变得**可见**了 ——
       打到旧 worker 的请求，指纹就是旧的。

    ⚑ 算的是【代码】不是【数据】：只取 `SYSTEM_PROMPT` + 输出 schema，
       **不含 `goal`**。含了的话每换一个目标指纹就变，等于没有指纹。
       （`sort_keys` 是必须的：dict 的顺序不该影响"这是哪一版"。）

    ⚠️ 已知边界：它**不覆盖** `build_user_prompt` 的模板改动。
       要覆盖得把模板也摘出来算 —— 等真遇到"改了模板却看不出来"再加。
       现在加只是把一件小事做复杂。
    """
    schema = json.dumps(PLAN_OUTPUT_SCHEMA, sort_keys=True, ensure_ascii=False)
    material = f"{SYSTEM_PROMPT}\x1f{schema}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:8]


@dataclass
class PlanResult:
    goal: str
    nodes: list[dict[str, Any]]
    issues: list[dict[str, Any]]
    usage: dict[str, int]
    # ⚑ 这条字段存在，就是为了让"跑的是哪一版 Prompt"从响应里看得出来
    #
    # ⚠️ **故意不给默认值**：给个 `""` 的话，哪天忘了在 `plan_goal()` 里传它，
    #   构造照样成功、响应里照样有字段 —— 只是永远是空的，**而没有任何东西会红** ✗
    #   （本项目踩过三次"参数收了从未使用"，都是这个形状。）
    #   必填的话，忘传 = 当场 TypeError ✓
    prompt_fingerprint: str
    # ⚠️ 这条字段存在，就是为了让"没报 issue"不被读成"通过"
    #
    # （它有默认值是对的：`check_implemented=False` 正是"还没查"的诚实值 ✓）
    check_implemented: bool = False


def plan_goal(goal: str, *, max_depth: int = 3, max_children: int = 9) -> PlanResult:
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

    # ⑤ 依赖解析：模型的【标题】依赖 → 【id】依赖
    # ⚑ 必须在组装**之后** —— 组装之前没有 id，而"标题 → id"的字典建不出来 ✓
    #
    #   装不出树时不解析（图是空的，没有"依赖"可言）——
    #   而那种情况已经被 E_LEVEL_SKIP 报成阻断性问题了 ✓
    if nodes:
        resolve_depends(level_nodes, nodes)

    return PlanResult(
        goal=goal,
        nodes=nodes,
        issues=issues,
        usage=usage,
        check_implemented=True,
        prompt_fingerprint=prompt_fingerprint(),
    )
