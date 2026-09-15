"""`make plan` 的落点 —— §12 给 A0 定的完成标准就是这一条命令。

    make plan GOAL="准备一次日本关西七日游"
    # → 打印可读的缩进任务图（含 assignee 提议）+ 校验结果

    make prompt GOAL="准备一次日本关西七日游"
    # → 只打印【将要发出去】的内容，不调模型、不花钱（改 Prompt 时用它）

**现在做得到的**：真的调模型、真的组装成树。
**现在做不到的**：校验（§7.2 ① 的 7 条规则表待写）—— 这一点会打印在输出里。

⚠️ 如果 `llm/prompts.py` 里的 Prompt 和 schema 还空着，这条命令会**报错**
   并告诉你缺哪一块 —— **不会退回假数据**。

⚠️ 这份输出**不是** `/v1/plan` 的响应形状（§3.4）：
   那是给人看的缩进树。响应体是 `PlanResult.nodes`，形状按 §3.4。
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

from app.llm.client import PlanCallError
from app.llm.prompts import PromptNotWritten, build_messages
from app.planner.outline import LevelSkipError
from app.tools.registry import load_tools
from app.workflows.plan import PlanResult, plan_goal

# .env 放在 python_agent/ 下（和 pyproject.toml 同级）。
# ⚑ 为什么在代码里读、而不是在 Makefile 里加 `uv run --env-file`：
#    那样 `make plan` 会读 .env，而手动 `uv run python -m app.cli` 调试时不读 ——
#    两条入口行为不一致，是这个项目最烦的坑。详见 pyproject.toml 里的说明。
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def _children(nodes: list[dict], parent_id: str | None) -> list[dict]:
    """取某个父节点的孩子，按 order 排序（§4.2：order 是同级内下标）。"""
    return sorted(
        (n for n in nodes if n["parent_id"] == parent_id),
        key=lambda n: n["order"],
    )


def _containers(nodes: list[dict]) -> set[str]:
    """谁的 id 被别人当过 `parent_id`，谁就是【容器】。

    ⚑ 这个算法照抄前端的 `lib/summary.ts`（summarize 就是这么排除容器的）——
       两边必须用同一个口径，否则会出现"前端不当任务、后端当任务"的错位。
    """
    return {n["parent_id"] for n in nodes if n["parent_id"] is not None}


def _describe(node: dict, by_id: dict[str, dict], containers: set[str]) -> str:
    """一个节点渲染成一行：标题 + [归谁 · 工具] + 依赖。"""
    tool = node.get("proposed_tool")

    if node["id"] in containers:
        # ⚑ 容器是【分组】不是任务，不会被派发执行 —— 没有工具是正常的，不该报警。
        who = "容器"
    elif node["assignee"] == "agent":
        who = f"agent · {tool}" if tool else "agent · ⚠️ 没提议任何工具"
    else:
        who = node["assignee"]

    line = f"{node['title']}  [{who}]"

    # ⚠️ 组装出来的节点【没有】depends_on —— 依赖抽取（planner/deps.py）还没做。
    #    所以这里用 .get，并且在结尾明确打印这件事，别让人以为"没有依赖"。
    deps = node.get("depends_on") or []
    if deps:
        names = "、".join(by_id[d]["title"] for d in deps if d in by_id)
        line += f"  ← 依赖: {names}"
    return line


def _render(
    nodes: list[dict],
    by_id: dict[str, dict],
    containers: set[str],
    parent_id: str | None,
    prefix: str = "",
) -> None:
    kids = _children(nodes, parent_id)
    for i, node in enumerate(kids):
        last = i == len(kids) - 1
        print(f"{prefix}{'└─ ' if last else '├─ '}{_describe(node, by_id, containers)}")
        _render(nodes, by_id, containers, node["id"], prefix + ("   " if last else "│  "))


def _print_messages(goal: str, max_depth: int, max_children: int) -> None:
    """把【将要发给模型】的内容原样打印出来 —— 不调模型，不花一分钱。

    ⚑ 为什么值得有这个：**措辞的好坏只能看，但看之前不该先付费。**
       改一个字就要跑一次模型的话，人会不自觉地少改几次。

    ⚑ 顺带做一次粗检：**目标有没有真的出现在 user 消息里**。
       这个坑本项目已经踩过三次（占位实现"不看你传了什么" / max_depth 被覆盖 /
       goal 收了没用），而那三次**全都不报错** —— 所以把它变成一条自动检查。
       ⚠️ 这只是**子串粗检**：如果你的写法把 goal 转义或拆得面目全非，它会误报。
    """
    messages = build_messages(goal, load_tools(), max_depth, max_children)
    for m in messages:
        print(f"{'═' * 8} {m['role']} {'═' * 8}")
        print(m["content"])
        print()

    print("（以上是【将要发出去】的内容 —— 没有调模型，没有花一分钱）")

    if goal not in messages[1]["content"]:
        print()
        print(f"⚠️  目标 {goal!r} 没有出现在 user 消息里 —— 模型不知道要规划什么，")
        print("    它会自己编一个目标，而且【不会报错】。（#13）")


def _report(result: PlanResult) -> None:
    nodes = result.nodes
    by_id = {n["id"]: n for n in nodes}
    containers = _containers(nodes)

    print(f"目标：{result.goal}")
    print()

    if nodes:
        for root in [n for n in nodes if n["parent_id"] is None]:
            print(_describe(root, by_id, containers))
            _render(nodes, by_id, containers, root["id"])
    else:
        # ⚑ 不产树也要**说一句**，不能留白 —— 留白会被读成"跑完了，没结果"。
        print("（图没装出来 —— 见下面的阻断性问题）")

    print()
    print(f"节点数：{len(nodes)}（其中容器 {len(containers)} 个）")
    u = result.usage
    print(
        f"用量：input {u.get('input_tokens', 0)} / output {u.get('output_tokens', 0)} tokens"
        f" · {u.get('elapsed_ms', 0)} ms"
    )

    # ── 校验结果（§7.2 ①）────────────────────────────────
    print()
    if not result.check_implemented:
        # ⚑ 这一行必须打印。没有它，「0 个 issue」会被读成「校验通过」——
        #    而实情是「还没查」。这是 #13 的形态。
        print("⚠️ 校验（§7.2 ① 的 7 条规则）：**未实现** —— 没有 issue ≠ 没有问题，是还没查。")
    else:
        errors = [i for i in result.issues if i["severity"] == "error"]
        warns = [i for i in result.issues if i["severity"] == "warning"]
        print(f"校验（§7.2 ① 的 7 条）：{len(errors)} 个 error（阻断）· {len(warns)} 个 warning")
        for issue in result.issues:
            mark = "🔴" if issue["severity"] == "error" else "🟡"
            print(f"  {mark} [{issue['code']}] {issue['message']}")
        if errors:
            print("  ⚠️ 有 error → 前端的「确认并开始执行」会被闸门拦住（§7.1）。这是设计，不是故障。")

    print()
    print("注：标着【容器】的是分组，不是任务 —— 它们不会被派发执行。")
    print("注：assignee 是【提议】不是决定（ADR-2），归属要等 Java 的 Policy 裁决（§5.1 的 ② 步）。")
    print("注：依赖抽取（planner/deps.py）还没做，所以上面没有「← 依赖」那一截。")


def main() -> int:
    # ⚑ Windows 上 Git Bash / cmd 的默认输出编码不是 UTF-8，打印中文会变乱码
    #   （开发这个仓库时实测过）。显式改掉，免得每次都在这里浪费一轮排查。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    load_dotenv(ENV_FILE)

    parser = argparse.ArgumentParser(description="目标 → 任务图骨架（§5.1 的 ① 规划）")
    parser.add_argument("--goal", required=True, help="用户的自然语言目标")
    parser.add_argument("--max-depth", type=int, default=3, help="深度上限（默认 3，§3.4）")
    parser.add_argument("--max-children", type=int, default=6, help="扇出上限（默认 6，§3.4）")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印将要发出去的内容，不调模型（零成本；改 Prompt 时用它）",
    )
    args = parser.parse_args()

    try:
        if args.dry_run:
            _print_messages(args.goal, args.max_depth, args.max_children)
            return 0
        result = plan_goal(
            args.goal, max_depth=args.max_depth, max_children=args.max_children
        )
    except (PromptNotWritten, PlanCallError, LevelSkipError, ValueError) as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2

    _report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
