"""`make plan` 的落点 —— §12 给 A0 定的完成标准就是这一条命令。

    make plan GOAL="准备一次日本关西七日游"
    # → 打印可读的缩进任务图（含 assignee 提议）+ 校验结果

⚠️ 现在打印的是【占位数据】：树不是规划出来的，是 app/_placeholder_plan.py
   里手写的样本。所以输出开头必须自报家门 —— 一份"看起来像真规划结果"的
   假结果，比报错危险得多（§14.2 #13：用户看到的是错的东西，却以为是对的）。

这个文件里【唯一】不是占位的东西是树的渲染逻辑：把扁平数组按 parent_id
排成缩进树。那段代码接上真数据后照样用。
"""

import argparse
import sys

from app._placeholder_plan import GOAL as SAMPLE_GOAL
from app._placeholder_plan import PLACEHOLDER_NODES

BANNER = (
    "⚠️  占位实现 —— 下面这棵树是手写的样本（app/_placeholder_plan.py），"
    "不是规划出来的。"
)


def _children(nodes: list[dict], parent_id: str | None) -> list[dict]:
    """取某个父节点的孩子，按 order 排序（§4.2：order 是同级内下标）。"""
    return sorted(
        (n for n in nodes if n["parent_id"] == parent_id),
        key=lambda n: n["order"],
    )


def _containers(nodes: list[dict]) -> set[str]:
    """谁的 id 被别人当过 parent_id，谁就是【容器】。

    ⚑ 这个算法是照抄前端的（`lib/summary.ts` 的 summarize 就是这么排除容器的）——
       两边必须用同一个口径，否则会出现"前端不当任务、后端当任务"的错位。
    """
    return {n["parent_id"] for n in nodes if n["parent_id"] is not None}


def _describe(node: dict, by_id: dict[str, dict], containers: set[str]) -> str:
    """一个节点渲染成一行：标题 + [归谁 · 工具] + 依赖。"""
    tool = node["proposed_tool"]
    if node["id"] in containers:
        # ⚑ 容器是【分组】不是任务，不会被派发执行 —— 所以它没有工具是正常的，
        #   不该报警。（这一条前端已经踩过一次：CHANGELOG 推送 4 的
        #   「容器被当成了任务 —— 你没法"做"一个分组」。）
        who = "容器"
    elif node["assignee"] == "agent":
        who = f"agent · {tool}" if tool else "agent · ⚠️ 没提议任何工具"
    else:
        who = node["assignee"]

    line = f"{node['title']}  [{who}]"

    deps = node["depends_on"]
    if deps:
        # 依赖打印成标题而不是 id —— 看的人想知道"等谁做完"，不是"等哪个哈希"。
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


def main() -> int:
    # ⚑ Windows 上 Git Bash / cmd 的默认输出编码不是 UTF-8，打印中文会变乱码
    #   （开发这个仓库时实测过）。显式改掉，免得每次都在这里浪费一轮排查。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="目标 → 任务图骨架（当前是占位数据）")
    parser.add_argument("--goal", required=True, help="用户的自然语言目标")
    args = parser.parse_args()

    nodes = PLACEHOLDER_NODES
    by_id = {n["id"]: n for n in nodes}
    containers = _containers(nodes)

    print(BANNER)
    if args.goal != SAMPLE_GOAL:
        print(
            f"⚠️  而且它【不看你传了什么】—— 无论 --goal 是什么，"
            f"打出来的都是同一棵树（样本固定为「{SAMPLE_GOAL}」）。"
        )
    print()
    print(f"目标：{args.goal}")
    print()

    for root in [n for n in nodes if n["parent_id"] is None]:
        print(_describe(root, by_id, containers))
        _render(nodes, by_id, containers, root["id"])

    print()
    print(f"节点数：{len(nodes)}")
    print(
        "注：标着【容器】的是分组，不是任务 —— 它们不会被派发执行"
        "（前端的 summarize 也是这么排除它们的）。"
    )
    print(
        "校验（§7.2 ① 生成期 7 条规则）：未实现 —— 规则表待写。"
        "这里【不静默跳过】，只是还没轮到它。"
    )
    print(
        "注：assignee 是【提议】不是决定（ADR-2），"
        "真正的归属要等 Java 的 Policy 裁决（§5.1 的 ② 步）。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
