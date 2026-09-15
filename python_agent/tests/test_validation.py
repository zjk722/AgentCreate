"""`domain/validation.py` 的测试 —— §7.2 ① 的那 7 条。

⚑ 这批用例有第二个身份：**它是 A1 结构断言的雏形。**
   §8.1 说的"结构断言"（单根 / 层级 / 深度 / 扇出 / 标题长度）记的就是这 7 条 ——
   所以这里"一份坏数据 → 一条 issue"的形状，将来 corpus 可以直接复用。
"""

import pytest

from app.domain.validation import TITLE_MAX, validate_generated

# §7.2 ① 文档里写死的那 7 个 code。**产出的 code 一个都不许超出这个集合。**
DOCUMENTED_CODES = {
    "E_MULTIPLE_ROOTS",
    "E_LEVEL_SKIP",
    "E_EMPTY_TITLE",
    "E_TITLE_TOO_LONG",
    "W_DEPTH_EXCEEDED",
    "W_FANOUT_EXCEEDED",
    "W_DUPLICATE_SIBLING",
}


def n(level: int, title: str, **over) -> dict:
    """造一个"模型吐出来的节点"。"""
    node = {"level": level, "title": title, "assignee": "agent", "proposed_tool": None}
    node.update(over)
    return node


def check(nodes, *, max_depth=3, max_children=6) -> list[dict]:
    return validate_generated(nodes, max_depth=max_depth, max_children=max_children)


def codes(issues: list[dict]) -> list[str]:
    return [i["code"] for i in issues]


GOOD = [
    n(1, "根"),
    n(2, "行前准备"),
    n(3, "查机票"),
    n(3, "查汇率"),
    n(2, "预订安排"),
    n(3, "订酒店"),
]


# ── 干净数据 ────────────────────────────────────────────────


def test_good_input_has_no_issue():
    assert check(GOOD) == []


def test_issue_shape_matches_spec_7_1():
    """§7.1 的形状：severity / node_id / code / message —— 四个键，一个不多一个不少。"""
    issues = check([n(1, "根"), n(1, "又一个根")])
    assert set(issues[0]) == {"severity", "node_id", "code", "message"}
    assert issues[0]["severity"] in ("error", "warning")


# ── E_MULTIPLE_ROOTS ───────────────────────────────────────


def test_multiple_roots():
    issues = check([n(1, "根"), n(1, "又一个根")])
    assert codes(issues) == ["E_MULTIPLE_ROOTS"]
    assert issues[0]["severity"] == "error"
    # 跟具体某个节点无关 → node_id 是 None（§7.1 明说的）
    assert issues[0]["node_id"] is None
    assert "2 个" in issues[0]["message"]


def test_single_root_is_fine():
    assert "E_MULTIPLE_ROOTS" not in codes(check(GOOD))


# ── E_LEVEL_SKIP ───────────────────────────────────────────


def test_level_skip():
    issues = check([n(1, "根"), n(3, "跳了一层")])
    assert codes(issues) == ["E_LEVEL_SKIP"]
    assert issues[0]["severity"] == "error"


def test_level_above_base_is_also_reported():
    """level 跑到基准上面 —— 组装器会拒绝它，所以校验这边**必须**先报出来。

    不报的话，用户拿到的是一个崩溃的请求，而不是一条能看的 issue。
    """
    assert "E_LEVEL_SKIP" in codes(check([n(1, "根"), n(0, "跑到根上面")]))


def test_level_skip_announces_the_two_checks_it_disables():
    """⚑ 跳级会让【扇出】和【兄弟重名】判不了（父子关系断了）——
       而"没报那两条 warning"必须能被解释成"没查"，不是"查了没问题"（#13）。

       这条测试钉的就是那个**出口**：沉默本身不许不留痕迹。
    """
    msg = check([n(1, "根"), n(3, "跳了一层")])[0]["message"]
    assert "扇出" in msg
    assert "兄弟重名" in msg
    assert "跳过" in msg


def test_fanout_is_not_checked_when_levels_are_broken():
    """上面那条的配对测试：确实**没有**报扇出（而不是报了但没人看）。"""
    nodes = [n(1, "根"), n(2, "A"), n(4, "跳级"), n(2, "B")]
    got = codes(check(nodes, max_children=1))
    assert "E_LEVEL_SKIP" in got
    assert "W_FANOUT_EXCEEDED" not in got


# ── E_EMPTY_TITLE / E_TITLE_TOO_LONG ───────────────────────


def test_empty_title():
    issues = check([n(1, "根"), n(2, "   ")])
    assert codes(issues) == ["E_EMPTY_TITLE"]
    assert issues[0]["severity"] == "error"


def test_missing_title_counts_as_empty():
    """模型没给 `title` 时，用户看到的同样是"这一格是空的" ——
       报成同一个 code 才修得动。"""
    issues = check([n(1, "根"), {"level": 2, "assignee": "agent", "proposed_tool": None}])
    assert codes(issues) == ["E_EMPTY_TITLE"]


def test_title_length_boundary():
    """§7.2 ① 写的是「标题 **>** 12 字」—— 所以 12 字正好合规，13 字才错。

    ⚑ 边界必须钉死：差一个字，"每次都撞 error"和"完全没事"就换了个位置。
    """
    assert check([n(1, "根"), n(2, "一" * TITLE_MAX)]) == []

    issues = check([n(1, "根"), n(2, "一" * (TITLE_MAX + 1))])
    assert codes(issues) == ["E_TITLE_TOO_LONG"]
    assert f"{TITLE_MAX} 字上限" in issues[0]["message"]


# ── W_DEPTH_EXCEEDED / W_FANOUT_EXCEEDED ───────────────────


def test_depth_boundary():
    """深度**恰好**等于 max_depth 不报；多一层才报。而且是 warning，不是 error。"""
    ok = [n(1, "根"), n(2, "A"), n(3, "B")]
    assert codes(check(ok, max_depth=3)) == []

    issues = check([n(1, "根"), n(2, "A"), n(3, "B"), n(4, "C")], max_depth=3)
    assert codes(issues) == ["W_DEPTH_EXCEEDED"]
    assert issues[0]["severity"] == "warning"


def test_fanout_boundary():
    kids = [n(2, f"子{i}") for i in range(6)]
    assert codes(check([n(1, "根"), *kids], max_children=6)) == []

    issues = check([n(1, "根"), *kids, n(2, "第七个")], max_children=6)
    assert codes(issues) == ["W_FANOUT_EXCEEDED"]
    assert issues[0]["severity"] == "warning"


# ── W_DUPLICATE_SIBLING ────────────────────────────────────


def test_duplicate_sibling():
    issues = check([n(1, "根"), n(2, "重名"), n(2, "重名")])
    assert codes(issues) == ["W_DUPLICATE_SIBLING"]
    assert issues[0]["severity"] == "warning"


def test_same_title_in_different_branches_is_fine():
    """§7.2 ① 说的是【兄弟】重复 —— 跨分支同名是合法的
       （两个分支下各有一个「准备」，很正常）。"""
    assert codes(check([n(1, "根"), n(2, "A"), n(3, "准备"), n(2, "B"), n(3, "准备")])) == []


# ── 两条"防自己"的 ─────────────────────────────────────────


def test_every_produced_code_is_one_of_the_documented_seven():
    """⚑ 钉住 code 的拼写。

    产出文档里没有的 code（比如把 `E_TITLE_TOO_LONG` 打成 `E_TITLE_TOOL_LONG`），
    前端**认不出来**，而且**没有任何东西会报错** —— 正是 #13 的形态。

    这里把所有能触发的坏数据混在一起跑一遍，确认产出的集合没有冒出去。
    """
    bad = [
        n(1, ""),  # 空标题
        n(1, "一" * 99),  # 超长标题
        n(1, "根"), n(1, "第二个根"),  # 多根
        n(1, "根"), n(3, "跳级"),  # 跳级
        n(1, "根"), n(2, "A"), n(3, "B"), n(4, "C"),  # 太深
        n(1, "根"), *[n(2, f"c{i}") for i in range(9)],  # 太宽
        n(1, "根"), n(2, "重"), n(2, "重"),  # 兄弟重名
    ]
    produced = set(codes(check(bad, max_depth=2, max_children=2)))

    assert produced, "一条都没触发 —— 那这个测试就白写了"
    assert produced <= DOCUMENTED_CODES, f"冒出了文档里没有的 code：{produced - DOCUMENTED_CODES}"


def test_level_must_be_an_integer():
    """⚠️ §7.2 ① 的 7 条里【没有】"缺字段 / 类型不对"的 code —— 所以这里只能报错。

    这是一处**已知缺口**（DeepSeek 的 json 模式只保证"是合法 json"，
    不保证符合 schema，所以一定会撞到）。这条测试钉的是：
    **既不许发明 code，也不许静默放过。**
    """
    with pytest.raises(ValueError, match="level"):
        check([n(1, "根"), {"title": "缺了 level"}])


def test_bool_level_is_rejected():
    """`bool` 是 `int` 的子类 —— `level: true` 也能过 isinstance(int)，要单独挡掉。"""
    with pytest.raises(ValueError):
        check([{"level": True, "title": "根", "assignee": "agent", "proposed_tool": None}])


def test_nodes_must_be_a_list():
    with pytest.raises(ValueError):
        check({"nodes": []})
