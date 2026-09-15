"""`level` → 树 的【栈组装】+ ID 生成（§11）。

⚠️ 这跟前端的 `lib/outline.ts` **不是同一个算法**，别当成重复实现去合并（§11）：

    Python  planner/outline.py   输入 `level`（模型的原文）       栈组装   在【写】的时候组装
    前端    lib/outline.ts       输入 `parent_id`/`order`（已存）  挂载     在【读】的时候重建

  两者方向都不同：一个在写时组装，一个在读时重建。

⚑ 模型**不产出** `id` / `parent_id` / `order` —— 那是这里算出来的。
  §4.2 说得清楚：`level` 只是模型的输出格式，组装成 `parent_id` 之后就丢弃。

输入契约（= `llm/prompts.py` 里 `PLAN_OUTPUT_SCHEMA` 声明的那个形状）：
    [{"level": int, "title": str,
      "assignee": "agent" | "user" | "blocked",
      "proposed_tool": str | null}]

⚠️ 这里**只验形状，不验语义**：
  跳级、标题超长、`assignee` 值合不合法 —— 都是 §7.2 ① 的 7 条规则，
  属于**你写的**校验规则表。这个文件只负责"把结构装对"。
"""

import secrets
from typing import Any

REQUIRED_KEYS = ("level", "title", "assignee", "proposed_tool")


class LevelSkipError(ValueError):
    """层级跳跃（上一层的下一层直接跳到了下下层）。

    ⚠️ 组装器**不修复**它，这是有意的：
      · **判定**该由 §7.2 ① 的 `E_LEVEL_SKIP` 做（在你的规则表里）
      · **修复**该由 §7.4 的 repair 环做

    这里直接报错，是因为"静默把跳级的节点挂到别处"会让用户看到
    **一棵错的树，却以为是对的** —— 那正是 #13。
    """


def new_id() -> str:
    """12 位 hex（§4.2）。

    ⚑ **随机生成，不是按内容算出来的** —— 这一点是有意的：

      如果 id 由标题（或别的节点内容）hash 而来，那么改一个错别字就会**换 id**，
      而别人的 `depends_on` 里还写着旧的那个 —— 引用会**静默断掉**，
      立刻造出 `E_DANGLING_DEP`（界面上那个任务就永远等着，看着像个普通待办）。

      id 必须在"内容变了"的时候保持不变。
    """
    return secrets.token_hex(6)  # 6 字节 = 12 个 hex 字符


def level_breaks(level_nodes: list[dict[str, Any]]) -> list[int]:
    """哪些节点【没有爹可挂】—— 层级跳跃，或 level 跑到基准上面。返回它们的下标。

    ⚑ **这是这条规则的唯一实现。** 组装器拿它决定"要报错"，校验器
      （§7.2 ① 的 `E_LEVEL_SKIP`）拿它决定"要记一条 issue"。

      两边对"哪里断了"必须完全一致 —— 否则会出现
      **"校验说没问题、组装却抛异常"**这种自相矛盾的状态。

    ⚠️ 注意【多根】不是断 —— 第二个 level=1 的节点是**合法的根**
      （"根应该恰好 1 个"是 §7.2 ① 的 `E_MULTIPLE_ROOTS`，属于**校验**的判断，
       组装器如实装出来，不替校验下结论）。
    """
    if not level_nodes:
        return []

    base = level_nodes[0]["level"]
    breaks: list[int] = []
    stack: list[int] = [0]  # stack[d] = 当前第 d 层那个节点的下标

    for i, raw in enumerate(level_nodes):
        if i == 0:
            continue

        depth = raw["level"] - base
        if depth < 0 or depth > len(stack):
            breaks.append(i)
            continue

        stack = stack[:depth]
        stack.append(i)

    return breaks


def level_parents(level_nodes: list[dict[str, Any]]) -> list[int | None]:
    """每个节点在列表里的【父节点下标】。用栈推。

    ⚑ 和 `level_breaks` 一样，这是"谁是谁的爹"的**唯一实现** ——
      组装器（`assemble`）和校验器（`domain/validation.py`）都用它。
      两份实现必然漂移，而漂移的后果很讽刺：
      **校验说没问题，装出来的树却是另一个样**，而且两边都不报错。

    ⚠️ **先跑 `level_breaks()`。** 断掉的节点这里也会返回 `None`，
       而那个 `None` 和"是根"的 `None` 长得一模一样 —— 分不出来是故意的，
       因为断掉的情况下"爹是谁"本来就没有答案。
    """
    parents: list[int | None] = []
    stack: list[int] = [0]
    base = level_nodes[0]["level"]

    for i, raw in enumerate(level_nodes):
        if i == 0:
            parents.append(None)
            continue

        depth = raw["level"] - base
        if depth < 0 or depth > len(stack):
            parents.append(None)
            continue

        stack = stack[:depth]
        parents.append(stack[-1] if depth else None)
        stack.append(i)

    return parents


def assemble(level_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把扁平的 `level` 列表装成 §4.2 形状的扁平节点数组。

    输出的每个节点多出三个字段：`id` / `parent_id` / `order`。
    **没有** `depends_on` —— 那不是这里的事（§11 把它单独放在 `planner/deps.py`），
    而且现在还没做。所以它**不会**被填成 `[]`：填了就等于说"这节点没有依赖"，
    而实情是"还没算" —— 那是两回事。
    """
    if not level_nodes:
        raise ValueError("模型一个节点都没产出 —— 空的骨架没法入库")

    _check_shape(level_nodes)

    # ⚑ 组装器**不修复**层级跳跃，直接报错（理由见 LevelSkipError 的 docstring）。
    #   校验器（§7.2 ①）会先把同一件事报成一条 E_LEVEL_SKIP 的 issue，
    #   所以正常流程里走不到这儿 —— 但这里必须保留这道闸，不能指望上游。
    breaks = level_breaks(level_nodes)
    if breaks:
        i = breaks[0]
        raise LevelSkipError(_skip_reason(i, level_nodes[i], level_nodes[0]["level"]))

    parents = level_parents(level_nodes)
    counters: dict[str | None, int] = {}  # 每个父节点下已经放了几个孩子
    out: list[dict[str, Any]] = []

    for i, raw in enumerate(level_nodes):
        parent_index = parents[i]
        parent_id = out[parent_index]["id"] if parent_index is not None else None
        order = counters.get(parent_id, 0)
        counters[parent_id] = order + 1

        out.append(
            {
                "id": new_id(),
                "parent_id": parent_id,
                "order": order,  # 按出现顺序数 —— 同一父下自然就是 0..k-1（§4.2 的连续约束）
                "title": raw["title"],
                "assignee": raw["assignee"],
                "proposed_tool": raw["proposed_tool"],
            }
        )

    return out


def _skip_reason(i: int, raw: dict[str, Any], base: int) -> str:
    if raw["level"] < base:
        why = f"level={raw['level']} 比第一个节点的 level={base} 还小 —— 它跑到基准上面去了"
    else:
        why = f"level={raw['level']}，而它上一层一个节点都没有"
    return f"{_where(i)}（{raw['title']!r}）层级不对：{why}（§7.2 ① 的 E_LEVEL_SKIP）"


def _where(i: int) -> str:
    """报错时的位置说明。

    ⚑ 两个编号都给：**人**读「第 2 个」，**代码**跳「下标 1」。

    只报 0 基下标会让人数错一个 —— 这个坑是被测试抓到的：
    原来写成 `f"第 {i} 个"`，于是第二个节点报的是"第 1 个"，
    而 200 个节点的图里，这种错会让排查**往错的方向找**。
    """
    return f"第 {i + 1} 个节点（下标 {i}）"


def _check_shape(level_nodes: list[dict[str, Any]]) -> None:
    """缺字段就报错 —— 而且要报**第几个**节点缺什么。

    不补默认值：给 `assignee` 补个默认 `agent` 就等于替模型做了提议，
    而且是**用户看不见**的一次（#13）。
    """
    for i, raw in enumerate(level_nodes):
        if not isinstance(raw, dict):
            raise ValueError(f"{_where(i)}不是对象，而是 {type(raw).__name__}")

        missing = [k for k in REQUIRED_KEYS if k not in raw]
        if missing:
            raise ValueError(
                f"{_where(i)}缺字段：{'、'.join(missing)}"
                f"（契约见 llm/prompts.py 的 PLAN_OUTPUT_SCHEMA）"
            )

        level = raw["level"]
        # ⚠️ bool 是 int 的子类，要单独挡掉：`level: true` 也能过 isinstance(int)
        if not isinstance(level, int) or isinstance(level, bool):
            raise ValueError(f"{_where(i)}的 level 不是整数：{level!r}")
