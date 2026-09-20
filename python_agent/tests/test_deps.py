"""`planner/deps.py` 的测试 —— 纯函数，不起任何上下文（附录 A 的 F2）。

⚑ 这一组测的都是「**指认不出来**」的情况 ——
   因为指错一条依赖的后果是**静默的**：那个任务永远等着一个不该等的东西，
   而界面上它就是个普普通通的「待办」（`E_DANGLING_DEP` 那一类）。
"""

import pytest

from app.planner.deps import DepResolveError, resolve_depends


def node(nid: str, title: str, deps: list[str] | None = None) -> dict:
    """一个"组装后的节点"（有 id）+ 一个"模型写的依赖"（用标题）合在一起。

    ⚠️ 默认给 **`[]`**（= 明确说"没有依赖"），而**不是省略那个键**。
       省略是**另一种情况**（"没说"）—— 它有自己的测试，见
       `test_missing_key_is_an_error_not_an_empty_list` ✓

    （⚑ 这个 helper 第一版就是"省略"的写法 —— 5 条测试连着挂。
       而那正是这个模块**唯一要区分**的那件事：没说 ≠ 没有。）
    """
    return {"id": nid, "title": title, "depends_on": deps if deps is not None else []}


def run(level_nodes, nodes):
    resolve_depends(level_nodes, nodes)
    return nodes


def test_resolves_title_to_id():
    nodes = [node("a1", "决定出行日期"), node("b2", "预订酒店", ["决定出行日期"])]
    run(nodes, nodes)  # 这里两份恰好一样（都有 id 也有 depends_on）
    assert nodes[1]["depends_on"] == ["a1"]


def test_empty_list_means_no_dependency():
    """`[]` = 明确说"我不依赖谁" ✓ —— 和"省略"是完全不同的两回事。"""
    nodes = [node("a1", "根", [])]
    assert run(nodes, nodes)[0]["depends_on"] == []


def test_missing_key_is_an_error_not_an_empty_list():
    """⚠️ 省略 `depends_on` 要**报错** —— 补一个 `[]` 就是替模型说"它没有依赖"。

    而实情是"**它没说**" —— 那两件事的差别，正是这个项目一路在守的。
    """
    with pytest.raises(DepResolveError, match="没有 `depends_on`"):
        # ⚠️ 这里要**故意**造一个没有这个键的节点 —— 所以不能用上面的 helper（它默认给 `[]`）
        resolve_depends([{"id": "a1", "title": "根"}], [{"id": "a1", "title": "根"}])


def test_unknown_title_is_an_error():
    """依赖了一个不存在的标题 —— 模型编的。**不猜**，直接报错。"""
    nodes = [node("a1", "根"), node("b2", "预订酒店", ["不存在的节点"])]
    with pytest.raises(DepResolveError, match="不存在的标题"):
        run(nodes, nodes)


def test_ambiguous_title_is_an_error():
    """同一个标题出现在两个节点上 → 歧义 → 报错（不取第一个了事）。

    ⚑ 这条是"重名"和"找不到"的**中间态**：看上去能解析，但指哪个都可能是错的。
    """
    nodes = [
        node("a1", "根"),
        node("b2", "准备", ["根"]),
        node("c3", "准备", ["根"]),
        node("d4", "订酒店", ["准备"]),
    ]
    with pytest.raises(DepResolveError, match="2 个"):
        run(nodes, nodes)


def test_self_dependency_is_NOT_an_error_here():
    """指到自己 → **不在这里拦** ✓ —— 它会变成一个自环，交给 §7.2 ③ 的校验。

    ⚑ 这条是"组装器不替校验做判断"的一个实例：
      自环是一种**合法的数据结构**（读得出来、画得出来），
      该不该报错是**校验**的判断（`E_CYCLE_DEP`），不是组装/解析的判断。
    """
    nodes = [node("a1", "根", ["根"])]
    assert run(nodes, nodes)[0]["depends_on"] == ["a1"]  # 指向了自己


def test_matches_by_index_not_by_content():
    """两份输入是**按下标**对应的 —— 顺序被打乱就会错配（所以由调用方保证顺序 ✓）。"""
    level = [{"title": "A", "depends_on": []}, {"title": "B", "depends_on": ["A"]}]
    nodes = [{"id": "id_a", "title": "A"}, {"id": "id_b", "title": "B"}]
    resolve_depends(level, nodes)
    assert nodes[1]["depends_on"] == ["id_a"]


def test_error_message_names_which_node():
    """报错要能指出**第几个**节点 —— 19 个节点里说"有个节点依赖错了"等于没说。"""
    nodes = [node("a1", "根"), node("b2", "订酒店", ["不存在"])]
    with pytest.raises(DepResolveError, match="第 2 个"):
        run(nodes, nodes)


def test_depends_on_must_be_a_list():
    nodes = [node("a1", "根"), {"id": "b2", "title": "订酒店", "depends_on": "根"}]
    with pytest.raises(DepResolveError, match="不是数组"):
        run(nodes, nodes)
