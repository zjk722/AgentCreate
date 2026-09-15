"""`planner/outline.py` 的测试 —— 附录 A 的 F2：**纯函数域测试，不起任何上下文**。

⚑ 为什么这里只测组装器：
  Prompt 是空的（那是留给人的活），所以"发一次真请求"这条路现在跑不通。
  但组装器是纯粹的输入→输出，**不需要网络也不需要 key** —— 它是我这一半里
  唯一能拿出真证据的地方。
"""

import re

import pytest

from app.planner.outline import LevelSkipError, assemble, level_parents, new_id

HEX12 = re.compile(r"^[0-9a-f]{12}$")


def node(level: int, title: str, assignee: str = "agent", tool: str | None = None) -> dict:
    """造一个"模型吐出来的节点"。"""
    return {"level": level, "title": title, "assignee": assignee, "proposed_tool": tool}


# 一份形状正常的样本：根 → 两个分支 → 分支下各有叶子
SAMPLE = [
    node(1, "根"),
    node(2, "行前准备"),
    node(3, "查往返机票价格", tool="flight_search"),
    node(3, "查当前汇率", tool="fx_rate"),
    node(2, "预订安排"),
    node(3, "预订大阪酒店", tool="hotel_booking"),
    node(3, "预订米其林餐厅"),  # 没提议工具 —— Policy 之后该变 blocked
]


def by_title(nodes: list[dict]) -> dict[str, dict]:
    return {n["title"]: n for n in nodes}


# ── 基本结构 ────────────────────────────────────────────────


def test_root_has_no_parent_and_others_are_attached():
    nodes = assemble(SAMPLE)
    by = by_title(nodes)

    assert by["根"]["parent_id"] is None
    assert by["行前准备"]["parent_id"] == by["根"]["id"]
    assert by["查往返机票价格"]["parent_id"] == by["行前准备"]["id"]
    assert by["预订大阪酒店"]["parent_id"] == by["预订安排"]["id"]


def test_order_is_contiguous_from_zero_per_parent():
    """§4.2 的硬约束：同一父下 order 必须恰好是 0..k-1。"""
    nodes = assemble(SAMPLE)
    groups: dict[str | None, list[int]] = {}
    for n in nodes:
        groups.setdefault(n["parent_id"], []).append(n["order"])

    for parent_id, orders in groups.items():
        assert sorted(orders) == list(range(len(orders))), f"父 {parent_id} 的 order 有洞或重复"


def test_sibling_after_a_deeper_node_returns_to_the_right_parent():
    """栈回退的关键用例 —— 这是栈组装最容易写错的一处。

    「查当前汇率」在「查往返机票价格」**之后**、且层级更浅，
    所以它必须是「行前准备」的孩子，而不是那条机票节点的孩子。
    """
    nodes = assemble(SAMPLE)
    by = by_title(nodes)

    assert by["查当前汇率"]["parent_id"] == by["行前准备"]["id"]
    assert by["查当前汇率"]["parent_id"] != by["查往返机票价格"]["id"]


def test_level_base_is_agnostic():
    """`level` 从 0 还是从 1 开始都行 —— 组装器拿第一个节点当基准。

    （§7.2 ① 的 E_LEVEL_SKIP 判定需要一个基准，那个基准由**规则表**定，
      不由组装器定。这里只证明"两种基准装出来的树一样"。）
    """
    from_zero = assemble([node(0, "根"), node(1, "A"), node(2, "A1"), node(1, "B")])
    from_one = assemble([node(1, "根"), node(2, "A"), node(3, "A1"), node(2, "B")])

    def shape(nodes: list[dict]) -> list[tuple[str, str | None, int]]:
        titles = {n["id"]: n["title"] for n in nodes}
        return [(n["title"], titles.get(n["parent_id"]), n["order"]) for n in nodes]

    assert shape(from_zero) == shape(from_one) == [
        ("根", None, 0),
        ("A", "根", 0),
        ("A1", "A", 0),
        ("B", "根", 1),
    ]


def test_multiple_roots_are_passed_through_not_rejected():
    """多根**不在这里**报错 —— 那是 §7.2 ① 的 `E_MULTIPLE_ROOTS`，属于校验规则表。

    组装器的职责是"如实装出来"，不是"替校验做判断"。
    """
    nodes = assemble([node(1, "根A"), node(1, "根B")])
    assert [n["parent_id"] for n in nodes] == [None, None]
    assert [n["order"] for n in nodes] == [0, 1]


def test_level_parents_is_the_single_source_of_truth():
    """`level_parents()` 是"谁是谁的爹"的**唯一实现** —— 组装器和校验器（§7.2 ①）共用。

    这条测试钉住"组装器确实用了它"。不然哪天有人把 `assemble` 改回自己推栈，
    **校验和组装就会各说各话，而两边都不报错** —— 那正是这个项目最怕的形状。
    """
    nodes = assemble(SAMPLE)
    parents = level_parents(SAMPLE)

    for i, node in enumerate(nodes):
        expected_index = parents[i]
        expected_id = nodes[expected_index]["id"] if expected_index is not None else None
        assert node["parent_id"] == expected_id


# ── id ──────────────────────────────────────────────────────


def test_ids_are_12_hex_and_unique():
    nodes = assemble(SAMPLE)
    ids = [n["id"] for n in nodes]

    assert all(HEX12.match(i) for i in ids), ids
    assert len(set(ids)) == len(ids)


def test_two_runs_produce_different_ids():
    """id 是**随机**的，不是按内容算的 —— 这是有意的。

    如果 id 由标题 hash 而来，改个错别字就会换 id，
    而别人的 depends_on 里还写着旧的 → 引用静默断掉（立刻造出 E_DANGLING_DEP）。
    """
    a = assemble([node(1, "根")])[0]["id"]
    b = assemble([node(1, "根")])[0]["id"]
    assert a != b


def test_new_id_length():
    assert HEX12.match(new_id())


# ── 坏数据一律报错，不静默兜底 ──────────────────────────────


def test_level_skip_raises():
    """跳级要报错，**不能**悄悄挂到别处 —— 那会让用户看到一棵错的树却以为是对的（#13）。"""
    with pytest.raises(LevelSkipError):
        assemble([node(1, "根"), node(3, "跳了一层")])


def test_level_going_above_the_base_raises():
    with pytest.raises(LevelSkipError):
        assemble([node(2, "根"), node(1, "跑到基准上面去了")])


def test_empty_input_raises():
    with pytest.raises(ValueError):
        assemble([])


@pytest.mark.parametrize("missing", ["level", "title", "assignee", "proposed_tool"])
def test_missing_field_raises(missing: str):
    """缺字段要报错，**不补默认值**。

    给 assignee 补个默认 `agent`，就等于替模型做了一次提议 ——
    而且是用户看不见的一次。
    """
    raw = node(1, "根")
    del raw[missing]
    with pytest.raises(ValueError, match=missing):
        assemble([raw])


def test_bool_level_is_rejected():
    """bool 是 int 的子类 —— `level: true` 也能过 isinstance(int)，要单独挡掉。"""
    with pytest.raises(ValueError, match="level"):
        assemble([{"level": True, "title": "根", "assignee": "agent", "proposed_tool": None}])


def test_error_message_names_which_node():
    """报错要能指出**第几个**节点 —— 200 个节点里说"有个节点缺字段"等于没说。

    ⚑ 而且要同时给「人读的编号」和「代码跳的下标」：
       这条测试第一版就红过 —— 代码当时只报 0 基下标，
       于是**第二个**节点被说成"第 1 个"，排查会往错的方向找。
    """
    with pytest.raises(ValueError) as e:
        assemble([node(1, "根"), {"title": "缺了 level"}])

    msg = str(e.value)
    assert "第 2 个" in msg, msg  # 给人看的（1 基）
    assert "下标 1" in msg, msg  # 给代码跳的（0 基）
