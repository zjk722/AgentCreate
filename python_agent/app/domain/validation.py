"""§7.2 ① 生成期校验 —— 对【模型的原始输出】跑的那 7 条规则。

⚑ 它有两个身份，这是它最值钱的地方：

    ① **产品功能** —— 产出 `issues` 给前端的问题条，并决定 §7.1 的闸门
       （有 `error` 就不许开工）。
    ② **评测的断言** —— §8.1 的"结构断言"（单根 / 层级 / 深度 / 扇出 / 标题长度）
       记的就是这 7 条。**一处实现、两处用。**

输入是【组装之前】的 level 列表 —— 所以节点还没有 id，
`node_id` 一律是 `None`，靠 message **指名道姓**（见 `_where`）。

⚠️ §7.2 的三组校验里，只有这一组跑在 Python 侧：
     ① 生成期（本文件）      对 level 表示，**组装之前**
     ② 层级树 / ③ 依赖图     对已存的 outline，前端和 Java 都要跑
                             （前端 `lib/outline.ts` 的 buildTree 已经实现了）
"""

from collections import Counter
from typing import Any

from app.planner.outline import level_breaks, level_parents

# §7.2 ① 的 `E_TITLE_TOO_LONG`：标题 > 12 字 → **超过**才算错，12 字正好合规。
TITLE_MAX = 12

# 层级基准：根是 level 1（用户 2026-09-15 定的）。
# ⚑ §7.2 ① 的 `E_LEVEL_SKIP` 判定需要这个基准 —— 它落在这里。
#    （组装器本身两种基准都认，它拿第一个节点的 level 当基准。）
LEVEL_BASE = 1


def validate_generated(
    level_nodes: list[dict[str, Any]], *, max_depth: int, max_children: int
) -> list[dict[str, Any]]:
    """跑完 7 条，返回 issues（形状照 §7.1：severity / node_id / code / message）。"""
    _require_checkable(level_nodes)

    issues: list[dict[str, Any]] = []
    issues += _check_titles(level_nodes)
    issues += _check_roots(level_nodes)

    skips = _check_level_skips(level_nodes)
    issues += skips
    issues += _check_depth(level_nodes, max_depth=max_depth)

    # ⚑ 扇出、兄弟重名这两条都要先知道"谁是谁的孩子"，而**跳级会把父子关系打断**
    #   （跳级那个节点没有爹，它后面的节点也失去了参照）。
    #   所以只有层级没问题时才跑。
    #
    #   ⚠️ 而"没跑"这件事**必须让用户看得见** —— 否则"没有 W_FANOUT_EXCEEDED"
    #      会被读成"查过了，没问题"（#13）。
    #      出口就在上面那条 E_LEVEL_SKIP 的 message 里，见 _check_level_skips。
    if not skips:
        parents = level_parents(level_nodes)
        issues += _check_fanout(level_nodes, parents, max_children)
        issues += _check_duplicate_siblings(level_nodes, parents)

    return issues


# ── 7 条规则 ─────────────────────────────────────────────────


def _check_titles(level_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`E_EMPTY_TITLE` / `E_TITLE_TOO_LONG`（都是 🔴 阻断）。

    ⚑ 标题**缺失**也算空标题：模型没给 title 时，用户看到的同样是"这一格是空的"，
       报成同一个 code 才修得动。（§7.2 ① 里没有"字段缺失"这一类，见 _require_checkable）
    """
    issues = []
    for i, raw in enumerate(level_nodes):
        title = raw.get("title")

        if not isinstance(title, str) or not title.strip():
            issues.append(_issue("error", "E_EMPTY_TITLE", f"{_where(i, raw)}：标题是空的"))
            continue

        n = len(title.strip())
        if n > TITLE_MAX:
            issues.append(
                _issue(
                    "error",
                    "E_TITLE_TOO_LONG",
                    f"{_where(i, raw)}：标题 {n} 字，超过 {TITLE_MAX} 字上限"
                    f"（{title.strip()[:20]!r}）",
                )
            )
    return issues


def _check_roots(level_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`E_MULTIPLE_ROOTS`（🔴 阻断）。根节点数必须**恰好** 1 个。

    ⚑ `node_id` 是 `None` —— §7.1 说了，这个错跟具体某个节点无关
       （是"整张图"的性质），硬挂一个 id 反而误导。
    """
    roots = [i for i, n in enumerate(level_nodes) if n["level"] == LEVEL_BASE]
    if len(roots) == 1:
        return []
    return [
        _issue(
            "error",
            "E_MULTIPLE_ROOTS",
            f"根节点（level={LEVEL_BASE}）有 {len(roots)} 个，应该【恰好 1 个】"
            f"（下标 {'、'.join(map(str, roots))}）",
        )
    ]


def _check_level_skips(level_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`E_LEVEL_SKIP`（🔴 阻断）：层级跳跃，或 level 跑到基准上面。

    ⚑ 这条的 message 里**额外带一句"有两条检查被跳过了"** ——
       因为跳级会让父子关系断掉，扇出和兄弟重名判不了。
       "没报那两条 warning" 必须能被解释成"没查"，而不是"查了没问题"（#13）。
    """
    issues = []
    # ⚑ "哪里断了"用 `level_breaks()` —— 和组装器**同一份实现**。
    #   不自己再推一遍：两份必然漂移，而漂移的形状是
    #   "校验说没问题、组装却抛异常"，两边都不报错。
    for i in level_breaks(level_nodes):
        raw = level_nodes[i]
        level = raw["level"]

        if level < LEVEL_BASE:
            why = f"level={level} 比基准 {LEVEL_BASE} 还小 —— 它跑到根上面去了"
        else:
            why = f"level={level}，而它上一层（level={level - 1}）一个节点都没有"

        issues.append(
            _issue(
                "error",
                "E_LEVEL_SKIP",
                f"{_where(i, raw)}：层级跳跃（{why}）。"
                "⚠️ 在这一条修好之前，【扇出】和【兄弟重名】两条检查是被跳过的"
                "（父子关系断了，判不了）—— 别把它们的沉默读成通过。",
            )
        )
    return issues


def _check_depth(level_nodes: list[dict[str, Any]], *, max_depth: int) -> list[dict[str, Any]]:
    """`W_DEPTH_EXCEEDED`（🟡 提示）：深度超限。

    深度 = 最深的 level 换算成层数（基准 1 时，level 3 就是 3 层）。
    """
    deepest = max(n["level"] for n in level_nodes)
    depth = deepest - LEVEL_BASE + 1
    if depth <= max_depth:
        return []
    return [
        _issue(
            "warning",
            "W_DEPTH_EXCEEDED",
            f"深度 {depth} 层，超过上限 {max_depth} 层（最深处是 level={deepest}）",
        )
    ]


def _check_fanout(
    level_nodes: list[dict[str, Any]], parents: list[int | None], max_children: int
) -> list[dict[str, Any]]:
    """`W_FANOUT_EXCEEDED`（🟡 提示）：某个节点的孩子数超限。"""
    counts = Counter(p for p in parents if p is not None)
    return [
        _issue(
            "warning",
            "W_FANOUT_EXCEEDED",
            f"{_where(index, level_nodes[index])}：有 {n} 个子节点，超过上限 {max_children} 个",
        )
        for index, n in counts.items()
        if n > max_children
    ]


def _check_duplicate_siblings(
    level_nodes: list[dict[str, Any]], parents: list[int | None]
) -> list[dict[str, Any]]:
    """`W_DUPLICATE_SIBLING`（🟡 提示）：同一父节点下出现同名兄弟。

    ⚑ 空标题的节点不参与这条 —— 它们已经被 `E_EMPTY_TITLE` 报过了，
       再报一次同名只会让问题条更吵（§7.3 那条"报警疲劳"的同一个道理）。
    """
    groups: dict[int | None, list[int]] = {}
    for i, p in enumerate(parents):
        groups.setdefault(p, []).append(i)

    issues = []
    for parent_index, kids in groups.items():
        seen: dict[str, list[int]] = {}
        for i in kids:
            title = (level_nodes[i].get("title") or "").strip()
            if title:
                seen.setdefault(title, []).append(i)

        for title, indexes in seen.items():
            if len(indexes) < 2:
                continue
            if parent_index is None:
                where = "根节点下"
            else:
                where = f"{_where(parent_index, level_nodes[parent_index])} 下"
            positions = "、".join(f"下标 {i}" for i in indexes)
            issues.append(
                _issue(
                    "warning",
                    "W_DUPLICATE_SIBLING",
                    f"{where} 有 {len(indexes)} 个同名兄弟「{title}」（{positions}）",
                )
            )
    return issues


# ── 工具 ─────────────────────────────────────────────────────


def _issue(severity: str, code: str, message: str) -> dict[str, Any]:
    """§7.1 的形状。`node_id` 恒为 None —— 这里还没有 id（见模块说明）。"""
    return {"severity": severity, "node_id": None, "code": code, "message": message}


def _where(i: int, node: dict[str, Any]) -> str:
    """报错的位置。**同时给人读的编号和给代码跳的下标。**

    ⚑ 这是踩过才有的：早期只报 0 基下标，于是**第二个**节点被说成"第 1 个"，
       200 个节点的图里这种错会让排查往错的方向找。
    """
    where = f"第 {i + 1} 个节点（下标 {i}）"
    title = node.get("title")
    if isinstance(title, str) and title.strip():
        return f"{where}「{title.strip()}」"
    return where


def _require_checkable(level_nodes: Any) -> None:
    """这 7 条**需要** `level` 是整数才能跑。

    ⚠️ **缺字段 / 类型不对【没有对应的 code】** —— §7.2 ① 的 7 条里
       没有"模型输出不合 schema"这一类。所以这里直接**报错**，
       而不是发明一个文档里没有的 code。

       ⚑ 这是一处已知缺口，而且**一定会被撞到**：DeepSeek 的 json 模式
       只保证"是合法 json"，不保证符合 schema。真要撞到的时候，
       加哪个 code 由你定（那是 v0.7 的事）。
    """
    if not isinstance(level_nodes, list):
        raise ValueError(f"模型返回的 nodes 不是数组，而是 {type(level_nodes).__name__}")

    for i, raw in enumerate(level_nodes):
        if not isinstance(raw, dict):
            raise ValueError(f"第 {i + 1} 个节点（下标 {i}）不是对象，而是 {type(raw).__name__}")
        level = raw.get("level")
        if not isinstance(level, int) or isinstance(level, bool):
            raise ValueError(
                f"第 {i + 1} 个节点（下标 {i}）的 level 不是整数：{level!r}\n"
                "  ⚠️ §7.2 ① 的 7 条里没有「缺字段 / 类型不对」的 code —— 这是待补的缺口。"
            )
