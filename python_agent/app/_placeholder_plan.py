"""⚠️ 占位数据 —— A0 内核写出来之后，这个文件应当被【删掉】。

为什么它叫 `_placeholder_plan`（带下划线）：
    它【不在】§11 的目录结构里，这是故意的 —— 它是临时的，
    名字就应该看起来可疑，好让删它的人一眼认出它。

------------------------------------------------------------------
这份数据模拟的是 `/v1/plan` 的响应（§3.4），不是 §4.2 的完整 outline。
两者【宽度不同】，这一点很容易搞混：

    /v1/plan 的响应（本文件）      id, parent_id, order, title,
                                   assignee, proposed_tool, depends_on
    入库后的完整节点（§4.2）        上面这些 + status, locked, approval,
                                   assignee_reason/detail, result_summary,
                                   evidence, source_span

差的那几样，都是【规划之后的工序】补上的：

    status             入库时给初始值（§5.2 的 todo）
    approval           由 Policy 按工具的 side_effect 推出（§9.2）
    assignee_reason    规则产出，不是模型产出（§4.2 每个取值都标了规则出处）
    locked             人工改过才有（§5.3 铁律 #3）
    result_summary /
    evidence           执行之后才有（§5.2）

所以这里【故意不写】 status / approval / evidence —— 写了就意味着
规划器越权干了 Policy 和执行引擎的活（ADR-2：提议 ≠ 决定）。

------------------------------------------------------------------
关于 assignee：这里填的是【模型的提议】，不是决定。
真正的归属要等 Java 的 Policy 裁决（§3.4 / §5.1 的 ② 步）。

⚠️ 最后一条节点（预订米其林餐厅）是【刻意】没有 propose 任何工具的：
   裁决之后它应当变成 `assignee=blocked` + `assignee_reason=no_tool`，
   也就是 §1.2 那条 [blocked · 无可用工具]。
   而它成立的前提是 shared/tools.json 里【没有】 restaurant_booking。
"""

from typing import Any

GOAL = "准备一次日本关西七日游"

# 12 位 hex（§4.2）。这里手写是为了可读；真实的 ID 由 planner 生成。
PLACEHOLDER_NODES: list[dict[str, Any]] = [
    {
        "id": "3f9c1e02b47a",
        "parent_id": None,
        "order": 0,
        "title": "准备一次日本关西七日游",
        "assignee": "agent",
        "proposed_tool": None,
        "depends_on": [],
    },
    # ── 一级分支：⚠️ 这两个是【容器】，不是任务 ──────────────
    # 容器不会被派发执行（你没法"做"一个分组）。
    # 前端的 summarize() 也是按"有没有被人当过 parent_id"把它们排除掉的。
    {
        "id": "7d2e8b45a901",
        "parent_id": "3f9c1e02b47a",
        "order": 0,
        "title": "行前准备",
        "assignee": "agent",
        "proposed_tool": None,
        "depends_on": [],
    },
    {
        "id": "e1f4382c6d95",
        "parent_id": "3f9c1e02b47a",
        "order": 1,
        "title": "预订安排",
        "assignee": "agent",
        "proposed_tool": None,
        "depends_on": [],
    },
    # ── 行前准备 ────────────────────────────────────────────
    {
        "id": "a3f9c1e02b47",
        "parent_id": "7d2e8b45a901",
        "order": 0,
        "title": "查往返机票价格",
        "assignee": "agent",
        "proposed_tool": "flight_search",
        "depends_on": [],
    },
    {
        "id": "b8c1d3e05f62",
        "parent_id": "7d2e8b45a901",
        "order": 1,
        "title": "查当前汇率",
        "assignee": "agent",
        "proposed_tool": "fx_rate",
        "depends_on": [],
    },
    # 这两条提议归 user：只有本人能办（§4.2 的 needs_human）。
    # ⚠️ 但 assignee_reason 是【裁决】写进去的，规划器不产出它 —— 所以这里没有。
    {
        "id": "c9d2e4f16a73",
        "parent_id": "7d2e8b45a901",
        "order": 2,
        "title": "决定出行日期",
        "assignee": "user",
        "proposed_tool": None,
        "depends_on": [],
    },
    {
        "id": "d0e3f5271b84",
        "parent_id": "7d2e8b45a901",
        "order": 3,
        "title": "办理签证",
        "assignee": "user",
        "proposed_tool": None,
        "depends_on": [],
    },
    # ── 预订安排 ────────────────────────────────────────────
    # 下面三条都依赖「决定出行日期」—— 没定日期就订不了任何东西。
    # 这就是 depends_on（执行顺序）与 parent_id（层级归属）彼此独立的例子：
    # 它们在树上属于「预订安排」，执行顺序上却依赖「行前准备」里的节点。
    {
        "id": "f2a5493d7ea6",
        "parent_id": "e1f4382c6d95",
        "order": 0,
        "title": "预订大阪酒店",
        "assignee": "agent",
        "proposed_tool": "hotel_booking",
        "depends_on": ["c9d2e4f16a73"],
    },
    {
        "id": "0ba65a4e8fb7",
        "parent_id": "e1f4382c6d95",
        "order": 1,
        "title": "预订京都民宿",
        "assignee": "agent",
        "proposed_tool": "hotel_booking",
        "depends_on": ["c9d2e4f16a73"],
    },
    # 🔴 刻意没有 propose 任何工具 —— 见文件头的说明。
    {
        "id": "1cb76b5f90c8",
        "parent_id": "e1f4382c6d95",
        "order": 2,
        "title": "预订米其林餐厅",
        "assignee": "agent",
        "proposed_tool": None,
        "depends_on": [],
    },
    # 🔴 二次确认那一格（irreversible，§9.2）。
    {
        "id": "2dc87c6a01d9",
        "parent_id": "e1f4382c6d95",
        "order": 3,
        "title": "预订接送机",
        "assignee": "agent",
        "proposed_tool": "airport_transfer_booking",
        "depends_on": ["c9d2e4f16a73"],
    },
]
