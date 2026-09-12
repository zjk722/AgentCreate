# Agent 任务图引擎 · 项目开发文档

> **版本** v0.4
> **日期** 2026-09-12
> **定位** 自然语言目标 → 可执行任务图 → 自主执行 → 人机边界标注
> **关键词** 规划执行 · 人机边界 · 证据链 · 评测驱动 · MCP 双向

> **v0.4 变更**（§4.2 补两个字段 + 一条设计判断）：
>
> ① 补 `result_summary` —— §3.4 的 `/v1/execute_task` 一直在返回它，
> 但 outline 里没有字段接，引擎产出了结果却无处可存。顺带记录两个并行缺口：
> 失败原因（`execution_tasks.error`）同样没进 outline；以及为什么**不**存原始
> 思维链（自我报告不可信、提示注入面、成本）。
>
> ② 补 `assignee_reason` + `assignee_detail` —— §1.2 明写着原因
> （`[user · 需本人办理]`、`[blocked · 无可用工具]`），但 outline 里没有字段承接，
> 界面上要显示的这句话在存储层无处可放。
> **关键决策：用枚举而非 `reason: string`** —— 每个取值对应文档里一条明确规则，
> 界面上每句解释都能追到出处；自由文本则是不可验证的自我报告。

> **v0.3 变更**（前端 demo 设计评审的产出，共 9 处）：
> §4.2 加 `approval` 字段与三轴正交说明、明确 `order` 连续约束、澄清 `level` 不进存储；
> §5.2 重写状态机（修正 `blocked` 归属、拆分入库前/后状态、补 `rejected` 转移）；
> §5.3 补拖拽两手势与并发 `409` 不合并；
> §7.2 校验按"生成期/读取期/依赖图"三组重排，拆 `E_CYCLE` 并补 4 个新 code；
> §11 澄清 `lib/outline.ts` 与 Python `outline.py` 非同一算法

---

## 0. 阅读指引

| 谁读 | 读哪些 |
|---|---|
| **我自己（开发者）** | 全文。特别是 §6 ADR、§13 Vibe Coding 边界 |
| **AI 编码助手** | §3 边界铁律、§5 流程、§11 目录结构、§13。**照着这份文档写，不要自由发挥** |
| **面试官** | §1 定位、§6 ADR、附录 B 简历叙事 |

> ⚠️ **§3.2 边界铁律是本项目最重要的一节。** 任何代码改动如果违反它，方案就崩了。

---

## 目录

1. [项目定位](#1-项目定位)
2. [需求定义](#2-需求定义)
3. [架构设计](#3-架构设计)
4. [数据模型](#4-数据模型)
5. [核心流程](#5-核心流程)
6. [关键技术决策（ADR）](#6-关键技术决策adr)
7. [质量门禁](#7-质量门禁)
8. [评测体系](#8-评测体系)
9. [安全设计](#9-安全设计)
10. [可观测性](#10-可观测性)
11. [目录结构](#11-目录结构)
12. [落地计划](#12-落地计划)
13. [Vibe Coding 边界](#13-vibe-coding-边界)
14. [风险与反模式](#14-风险与反模式)
- [附录 A · 可复用模式清单](#附录-a--可复用模式清单)
- [附录 B · 简历叙事](#附录-b--简历叙事)

---

## 1. 项目定位

### 1.1 一句话

用户输入一个**目标**，Agent 规划出任务图，**自主执行能做的部分**，并在图上**明确标出哪些是 Agent 完成的、哪些需要用户自己来**。

### 1.2 和"生成器"的本质区别

```
生成器：自然语言 → 结构化产物              （LLM 应用）
执行器：自然语言目标 → 任务图 → 自主执行 → 带状态的结果   （Agent）
```

导图不只是"展示"，它是**任务的可视化状态面板**：

```
🎯 准备一次日本关西七日游
├─ ✅ 查往返机票价格          [agent · done · 2.3s]
├─ ✅ 查当前汇率             [agent · done · 0.8s]
├─ 🟡 预订大阪酒店            [agent · 待确认 · 有副作用]
├─ ⬜ 决定出行日期            [user]
├─ ⬜ 办理签证               [user · 需本人办理]
└─ 🔴 预订米其林餐厅          [blocked · 无可用工具]
```

### 1.3 核心卖点（四个）

| # | 卖点 | 对应能力 |
|---|---|---|
| 1 | **规划与自主执行** | 目标拆解 + 工具调用 + 状态机 + 失败恢复 |
| 2 | **人机边界判定** | Agent 知道自己能做什么 → Policy 裁决 → 用户确认 |
| 3 | **证据链** | 每个 `done` 必须挂可验证的执行证据，杜绝"自我报告式完成" |
| 4 | **评测驱动** | 结构可自动断言 → 评测体系做得起来 → Prompt 迭代可量化 |

### 1.4 非目标

- ❌ 多人实时协作编辑
- ❌ 通用工作流引擎（只做"目标 → 任务图"这一种形态）
- ❌ 移动端原生 App

### 1.5 技术栈与侧重

| 层 | 技术 | 投入 |
|---|---|---|
| **Python Agent 引擎** | FastAPI + LangChain + LangGraph | 🔴 **主战场** |
| **Java Host 层** | Spring Boot + MyBatis-Plus + Postgres + Redis | 🟠 必要但不深挖 |
| **React 前端** | React 19 + Vite + TS + Tailwind + Zustand | 🟡 最小可用 |

---

## 2. 需求定义

### 2.1 功能需求

| ID | 需求 | 阶段 |
|---|---|---|
| FR-1 | 自然语言目标 → **任务图骨架**（含 assignee 提议） | A0 |
| FR-2 | **Policy 裁决**：按工具清单 + 副作用等级修正 assignee | A3 |
| FR-3 | **自主执行**：Agent 调用工具完成任务，状态实时更新 | A4 |
| FR-4 | **证据链**：每个 `done` 挂可验证的工具调用记录 | A4 |
| FR-5 | **多轮自然语言调整**（提案 → 确认 → 应用） | A3 |
| FR-6 | **前端可视化编辑**（拖拽 / 增删 / 改名 / 调层级） | A7 |
| FR-7 | 异步执行 + SSE 进度推送 | A6 |
| FR-8 | 长文输入走 **RAG + 节点溯源** | A2 |
| FR-9 | 引擎以 **MCP Server** 形式对外暴露能力 | A4 |
| FR-10 | 导出（Markdown / Mermaid / PNG / SVG） | A8 |

### 2.2 非功能需求

| ID | 需求 | 目标 |
|---|---|---|
| NFR-1 | 骨架生成延迟 | P95 < 15s |
| NFR-2 | 并发 | 单图最多 6 个任务并行执行 |
| NFR-3 | **幂等** | 同一任务重跑不产生重复副作用 |
| NFR-4 | 成本 | 单图 token 预算上限，超限降级 |
| NFR-5 | 可观测 | 每次 LLM / 工具调用可追溯、失败可重放 |
| NFR-6 | 可靠 | LLM 不可用时降级为"仅骨架"，而非整体失败 |
| NFR-7 | 安全 | 危险操作必经审批；工具输出视为不可信数据 |

---

## 3. 架构设计

### 3.1 三层定性（依据 MCP 的 Host / Server 模型）

```
┌──────────────── React 前端 ─────────────────────────────┐
│  · 任务图渲染（状态徽章 / 人机分色）                        │
│  · 对话面板（自然语言调整 + 提案确认）                      │
│  · 拖拽编辑（per-node 串行保存队列）                        │
│  · SSE 订阅（手写解析，携带 auth 头）                       │
│  ⚑ 布局算法【只在前端跑】，后端不存坐标                      │
└───────────────────┬──────────────────────────────────────┘
                    │ /api/v1/**  (JWT Bearer)
┌───────────────────▼──── Java = Agent 的 Host 层 ─────────┐
│  · 鉴权 + 归属校验（ownership 在 service 层）              │
│  · 持久化 + revision 乐观锁                                │
│  · 【Policy 引擎】assignee 裁决                            │
│  · 【审批流】按副作用等级走不同确认路径                      │
│  · 【任务调度】拓扑排序 + 虚拟线程 + Semaphore              │
│  · 【执行审计】谁在何时做了什么                             │
│  · SSE 推送（Redis pub/sub + snapshot）                    │
└───────────────────┬──────────────────────────────────────┘
                    │ 内部 HTTP（无状态、幂等）
┌───────────────────▼──── Python = Agent 引擎 ─────────────┐
│  · 规划：目标 → 任务图骨架                                  │
│  · 单任务执行：选工具 → 调工具 → 产出【证据】               │
│  · 改稿工具（@tool + bind_tools）→ 只产出【操作列表】       │
│  · RAG：分块 / 混合检索 / 重排 / 溯源                       │
│  · generate → check → repair 自纠环                        │
│  · MCP 双向（Server 暴露 + Client 消费）                    │
│  ⚑ 不连数据库、不存会话、不知道 revision 是什么             │
└──────────────────────────────────────────────────────────┘
```

> **Java 层薄不是偷懒，是设计。** MCP 的哲学就是 **Host 管治理、引擎管能力**。
> 面试话术：「我的 Host 层刻意保持薄——只做鉴权、持久化、审批、调度和推送。
> 因为 Agent 的能力应该在引擎侧，通过协议暴露，而不是焊死在 Host 里。」

### 3.2 边界铁律 ⚠️

> **Python Agent 引擎必须完全无状态。**

```
❌ 不连数据库
❌ 不存会话 / 不存历史
❌ 不知道 revision 是什么
❌ 不决定"要不要批准"（那是 Host 的事）
✅ 每个请求自带完成它所需的全部信息
✅ 幂等由 Java 侧的 idempotency_key 负责
```

**为什么这条最重要**：把 Python 关进无状态服务，等于**用网络边界物理性地强制了「模型不能直接写库」**。这不是洁癖——这是把最大的安全风险用架构消掉了。

**如何强制**（别指望"我记住了"）：
- Python 侧禁止 import 任何数据库驱动 → 加 lint 规则 / 依赖检查测试
- Python 侧禁止出现 `revision` / `approve` / `policy` 等词 → 命名审查
- Java 侧是唯一持有 Postgres 连接的服务

### 3.3 内部分工：谁调度，谁执行

```
Java（Host）                          Python（引擎）
─────────────                         ─────────────
持有任务图状态                         无状态
拓扑排序决定执行顺序                    接收「执行这一个任务」的请求
虚拟线程 + Semaphore 并发              选择工具 → 调用 → 产出证据
审批流                                 返回结果 + 证据 + issues
审计
```

**为什么调度在 Java**：调度需要**知道任务图的全局状态**，而状态在 Host。
这和参考项目 `DeckGenerationService`（页级扇出 + Semaphore）的结构一致。

### 3.4 内部接口（Python 引擎）

Python 侧**独立暴露 OpenAPI**，Java 据此生成客户端。

```jsonc
// POST /v1/plan —— 目标 → 任务图骨架
{
  "goal": "我想准备一次日本关西七日游",
  "tools": [ /* 可用工具清单，见 §4.4 */ ],
  "max_depth": 3,
  "max_children": 6
}
→
{
  "nodes": [
    {"id": "a3f9c1e02b47", "parent_id": null, "order": 0,
     "title": "预订大阪酒店",
     "assignee": "agent",            // ⚑ Agent 的【提议】
     "proposed_tool": "hotel_search",
     "depends_on": ["7d2e8b45a901"]  // ⚑ 依赖其他节点
    }
  ],
  "issues": [...],
  "usage": {"input_tokens": 812, "output_tokens": 233}
}
```

```jsonc
// POST /v1/execute_task —— 执行单个已批准的任务
{
  "task": {"node_id": "a3f9...", "title": "预订大阪酒店"},
  "tools": [ /* 可用工具清单 */ ],
  "context": {"goal": "...", "sibling_results": [...]},
  "idempotency_key": "map_9f2c:a3f9...:rev7"
}
→
{
  "status": "done",                 // done | failed | needs_input
  "evidence": {                     // ⚑ 没有证据的 done 一律降级为 failed
    "tool": "hotel_search",
    "args": {"city": "大阪", "nights": 3},
    "result_ref": "tool_call_9f2c",
    "elapsed_ms": 2310
  },
  "result_summary": "找到 12 家酒店，最低 ¥580/晚",
  "issues": [...]
}
```

```jsonc
// POST /v1/revise —— 自然语言调整
{
  "outline": [...],
  "instruction": "把第三点拆开",
  "history": [ /* ⚑ 上限 5 轮，由客户端携带 */ ]
}
→
{
  "operations": [ /* 只返回操作列表，不写库 */ ],
  "issues": [...]
}
```

---

## 4. 数据模型

### 4.1 表设计

```sql
users (
  id uuid pk, email text unique, password_hash text,   -- argon2
  created_at, updated_at
)

-- 任务图（核心表）
maps (
  id          uuid pk,
  user_id     uuid fk → users on delete cascade,
  title       text not null,
  goal        text,                          -- 原始自然语言目标
  status      text not null,                 -- draft|planning|executing|ready|failed
  outline     jsonb not null default '[]',   -- ⚑ 扁平节点数组（见 4.2）
  issues      jsonb not null default '[]',
  revision    integer not null default 1,    -- ⚑ 乐观锁
  created_at, updated_at
)

-- 执行任务（每个 agent 节点一条）
execution_tasks (
  id              uuid pk,
  map_id          uuid fk → maps on delete cascade,
  node_id         text not null,             -- 对应 outline 里的节点
  idempotency_key text not null,             -- ⚑ f"{map_id}:{node_id}:rev{revision}"
  status          text not null,             -- pending|running|done|failed|skipped
  attempt         integer not null default 0,
  evidence        jsonb,                     -- ⚑ 证据链
  error           text,
  created_at, updated_at,
  unique (idempotency_key)
)

-- 审批记录
approvals (
  id           uuid pk,
  map_id       uuid fk → maps on delete cascade,
  node_id      text not null,
  level        text not null,                -- confirm | double_confirm
  status       text not null,                -- pending|approved|rejected
  requested_at timestamptz default now(),
  decided_at   timestamptz
)

-- AI 修改提案
map_edit_proposals (
  id uuid pk, map_id uuid fk, revision integer,
  instruction text, operations jsonb, issues jsonb,
  status text,                               -- pending|applied|discarded
  created_at
)
```

### 4.2 `outline` 的结构：扁平列表

```jsonc
[
  {
    "id": "a3f9c1e02b47",
    "parent_id": null,            // ⚑ 层级由它表达；null = 根
    "order": 0,                   // ⚑ 同级内下标，必须连续 0..k-1
    "title": "预订大阪酒店",

    "assignee": "agent",          // ⚑ agent | user | blocked
    "assignee_reason": null,      // ⚑ 为什么这么分【枚举】，见下
    "assignee_detail": null,      // ⚑ 短细节：缺的工具名 / 触发的规则名
    "status": "done",             // ⚑ todo|running|done|failed|skipped
    "depends_on": ["7d2e8b45a901"],
    "locked": true,               // ⚑ 人工改过 → AI 不许碰

    "result_summary": "找到 12 家酒店，最低 ¥580/晚",   // ⚑ 产出摘要，见下
    "evidence": {
      "tool": "hotel_search",
      "args": {"city": "大阪", "nights": 3},
      "result_ref": "tool_call_9f2c",   // ⚑ 完整输出在这条审计记录里
      "elapsed_ms": 2310
    },
    "source_span": [[12, 48]],    // ⚑ RAG 溯源：对应原文的字符区间

    "approval": {                 // ⚑ 审批（A6 由 Java join approvals 表拍平）
      "level": "confirm",         //   confirm | double_confirm
      "status": "pending"         //   pending | approved | rejected
    }
  }
]
```

| 字段 | 说明 |
|---|---|
| `id` | **12 位 hex**，跨轮对话的唯一句柄 |
| `parent_id` | 父节点 id；`null` 即根。**层级由它表达** |
| `order` | 同级内的下标，**必须连续 `0..k-1`** |
| `assignee` | `agent` / `user` / `blocked` ── **归谁做** |
| `status` | 任务生命周期（见 §5.2）── **走到哪一步** |
| `depends_on` | 依赖的节点 id 列表（DAG） |
| `locked` | 人工改过 → AI 不覆盖 |
| `result_summary` | **产出摘要**（见下）—— 用户看图时最想知道的东西 |
| `evidence` | 执行证据（见 §5.2） |
| `source_span` | 溯源到原文的字符区间（防幻觉） |
| `approval` | 审批状态；由 Java 从 `approvals` 表 join 拍平 |

#### ⚑ `assignee_reason`：用【枚举】而不是自由文本

§1.2 的示例里明写着原因（`办理签证 [user · 需本人办理]`、`预订米其林餐厅 [blocked · 无可用工具]`），
但此前 `outline` 里**没有字段承接它** —— 界面上要显示的这句话，存储层无处可放。

**关键决策：这是枚举，不是 `reason: string`。** 理由与「不存原始思维链」是同一条：

> **自由文本是模型的自我报告，不可验证；枚举是规则产出，可验证。**

每个取值都对应文档里一条**明确的规则**，因此界面上显示的每一句原因都能追到出处：

| `assignee_reason` | `assignee` | 含义 | 规则出处 |
|---|---|---|---|
| `needs_human` | `user` | 只能人来（需本人办理 / 个人偏好） | §1.2 的签证、出行日期 |
| `no_tool` | `blocked` | 工具清单里没有能做的工具 | §9.2「无工具」 |
| `agent_failed` | `user` | Agent 尝试过但失败，转人工 | §5.2 失败降级表 |
| `user_rejected` | `user` | 用户否决了 Agent 的方案 | §5.2 的 rejected 转移 |
| `policy_denied` | `blocked` | Policy 按规则拒绝 | §9.2「Policy 拒绝」 |
| `null` | `agent` | 归 Agent，无需解释 | —— |

**`assignee_detail`** 只放**短且机器可读优先**的内容（缺的工具名、触发的规则名），
例如 `no_tool` 时填 `restaurant_booking`。**不要**在这里写叙述性句子 ——
一旦开了口子，它就会退化成和自由文本一样不可验证的东西。

> 界面上那句自然的说明（如「需本人办理」）由前端**根据枚举翻译**，不由后端生成。
> 这样措辞可以改而不动数据，且永远不会出现"听着合理但无出处"的句子。

#### ⚑ `result_summary`：摘要进节点，全文进审计

§3.4 的 `/v1/execute_task` 一直返回 `result_summary`，但此前 `outline` 里**没有字段接它** ——
引擎产出了结果，却无处可存。这是一个真缺口：用户盯着任务图，最想知道的正是
「那个 Agent 到底查到了什么」，而在此之前节点上只有耗时。

**为什么只存摘要，不存全文**：

| | 放哪 | 理由 |
|---|---|---|
| `result_summary` | 节点（JSONB） | 短、跟着节点走、不需单独查询 |
| 完整输出 | 审计日志 | 由 `evidence.result_ref` 指向（§5.2 已有的指针模式） |

200 个节点 × 每条摘要数十字符是可接受的；换成完整输出（一次检索可能上千字）会把
outline 撑爆，而 §4.3 明确要求 outline 是「写入原子、整批替换」的字段。

**长度约束**：建议由生成侧截断到 ~40 字，超长截断加省略号 —— 与 `E_TITLE_TOO_LONG`
同理，界面上放不下的东西不该进存储。

> ⚠️ **相关的并行缺口**：失败原因（§4.1 `execution_tasks.error`）同样没有进 `outline`。
> 一个 `failed` 节点在界面上目前说不出"为什么失败"。建议在补这条时一并处理，
> 但要注意它与 `result_summary` 语义不同：一个是**结果**，一个是**诊断**，不要合并成一个字段。

#### ⚑ 三个正交的轴（不要合并它们）

节点上有三条**互不替代**的信息。把它们压进一个字段，会让所有读 `status` 的地方都被迫理解审批语义：

| 轴 | 回答 | 取值 |
|---|---|---|
| `assignee` | 这活**归谁** | `agent` / `user` / `blocked` |
| `status` | 这活**到哪一步** | `todo` / `running` / `done` / `failed` / `skipped` |
| `approval` | 这活**批没批** | `level` × `status` |

**为什么审批不复用 `status`**：§9.2 的两档审批（单次 / 二次）需要区分，且 §4.1 的 `approvals` 表里有 `level` / `requested_at` / `decided_at` / 拒绝原因 —— 一个 `status` 值装不下。**视图需要**（画 🟡）不等于**存储需要**：前端可以自己算出一个展示态，不必把视图需求倒逼进存储模型。

#### ⚑ `order` 的约束与移动语义

- **同一父节点下，`order` 必须恰好是 `0..k-1`**（连续、不重复）。`order` 是**派生值**，不是创作值 —— 每次结构性改动都要重编号整个兄弟组。
- 校验因此只有一条：排序后的 `order` 序列必须等于 `[0,1,...,k-1]`。**一行断言同时抓重复和空洞。**
- 跨父移动 = 从旧父的孩子组摘掉（重编号）**+** 插入新父的孩子组（重编号）——**两组都要重编号**，只改一组会留下空洞。

#### ⚑ `level` 不进存储

`level` 只是 LLM 的**输出格式**，程序栈组装成 `parent_id` 后就丢弃（见 §11 `outline.py`）。前端需要深度时自己遍历算。§7.2 的 `E_LEVEL_SKIP` 也是在组装**之前**对模型原始输出做的检查。

**为什么扁平优于嵌套**：

| 问题 | 扁平如何解决 |
|---|---|
| LLM 结构化输出**不支持递归 schema** | 扁平不是递归的，schema 简单可控 |
| AI 改 vs 人改的 diff | 扁平天然可 diff |
| 局部更新 | 改一个节点不用重传整棵树 |
| **依赖图** | `depends_on` 天然是图结构，嵌套树表达不了 |

### 4.3 存储取舍：JSONB vs 真列

> **规则：结构会演进的用 JSONB；要查询/排序/加锁的用真列。**

| 用 JSONB | 用真列 |
|---|---|
| `outline`（节点全量） | `status` / `revision` / `user_id` |
| `issues` | `node_id` / `idempotency_key` |
| `operations` / `evidence` | `attempt` / `map_id` |

**为什么不建节点表**：导图规模 20–200 节点，写入是"整批替换"语义，JSONB 更原子。
> **什么时候换成节点表**：需要跨导图查节点、逐节点审计、或节点数上千。

### 4.4 工具注册表（`shared/tools.json`）⭐

**Java Policy 引擎和 Python 引擎读同一份** —— 不会出现"两边对工具的理解不一致"。

```jsonc
[
  {
    "name": "hotel_search",
    "description": "查询指定城市的酒店。何时用：用户要订酒店时。何时别用：只问价格时用 flight_search。",
    "input_schema": {...},
    "side_effect": "read_only",        // ⚑ read_only | reversible | irreversible
    "idempotency": "natural",          // ⚑ natural | keyed | none
    "timeout_ms": 10000
  }
]
```

`side_effect` 直接决定审批等级（见 §9.2），`idempotency` 决定重试策略（见 §5.2）。

---

## 5. 核心流程

### 5.1 生成流程（plan-then-fill）

```
用户输入目标
   ↓
① 规划       Python /v1/plan → 任务图骨架（含 assignee 提议 + depends_on）
   ↓
② 裁决       Java Policy 按工具清单 + 副作用等级修正 assignee
   ↓
③ 用户确认   "我将执行 3 项，5 项需要你" ← 可调整
   ↓
④ 展开       分支并发展开（Semaphore 限流，取消只在边界检查）
   ↓
⑤ 校验       有 error → repair（cap 1–2 轮）
   ↓
⑥ 入库 + SSE 推送
```

### 5.2 执行流程 ⭐ 本项目核心

#### 任务状态机

> ⚑ **`status` 只表达生命周期。** 归谁是 `assignee`、批没批是 `approval` —— 三者正交（见 §4.2）。

**① 入库前（Host 内存态，不持久化，UI 看不到）**

```
planned ──裁决──▶ assigned ──确认──▶ pending
```

**② 持久化后的 `status`（§4.2 的 5 个值）**

```
todo ──▶ running ──▶ done          （agent 任务）
todo ──────────────▶ done          （user 任务：人自己做完标记）

running ──▶ failed                 ──▶ (重试 / 转 assignee=user)
todo    ──▶ skipped                （依赖失败级联）
```

**③ 审批分支（走 `approval.status`，不占用 `status` 的值）**

```
approval.status = pending ──批准──▶ approved   → 任务继续走 todo → running
                          └─拒绝──▶ rejected   → assignee=user, status=todo
```

**三个容易搞错的地方**：

| 常见误解 | 真相 |
|---|---|
| `planned`/`assigned`/`pending` 是 UI 状态 | ❌ 它们是**入库前**的内存态。UI 一律看到 `todo` |
| `blocked` 是一种 `status` | ❌ 它是 **`assignee`** 的取值（依 §4.2 与 §1.2 的图示） |
| `needs_input` 是一种 `status` | ❌ 它是**引擎→Host 的信号**（§3.4 响应）。Host 收到后翻译成 `assignee=user` + `status=todo` |

> **拒绝后为什么转 `user` 而不是 `blocked`**：用户拒绝意味着"我不让你做，我自己来"，与 §5.2 失败降级表里「参数错误 → 转 `assignee=user`」同构。而 `blocked` 表达的是"谁都做不了"。

#### 执行时序

```
Java 调度器                           Python 引擎
    │
    ├─ 拓扑排序：找出所有 depends_on 已满足的 pending 任务
    │
    ├─ 虚拟线程 + Semaphore(6) 并发投递
    │        │
    │        └──POST /v1/execute_task──▶  选工具 → 调用 → 产出证据
    │        ◀─────{status, evidence}───
    │
    ├─ 写 execution_tasks（幂等键去重）
    ├─ 更新 outline 节点 status
    ├─ SSE 推送（全量状态）
    │
    └─ 循环直到无 pending 或达预算上限
```

#### 幂等执行铁律

```
幂等键 = f"{map_id}:{node_id}:rev{revision}"

重试时：
  · 工具 idempotency = "natural"  → 直接重试（只读操作，天然幂等）
  · 工具 idempotency = "keyed"    → 带上幂等键重试（下游据此去重）
  · 工具 idempotency = "none"     → 🚫 【禁止自动重试】，转人工
```

> ⚠️ **没有幂等键，重试一次就是多下一单。**

#### 证据链规则 ⭐

> **没有证据的 `done`，一律降级为 `failed`。**

```jsonc
"evidence": {
  "tool": "hotel_search",
  "args": {"city": "大阪", "nights": 3},
  "result_ref": "tool_call_9f2c",     // 指向审计日志里的原始调用
  "elapsed_ms": 2310,
  "verified_at": "2026-09-10T12:03:11Z"
}
```

**理由**：不信任模型的自我报告。「Agent 说做完了」→「Agent 拿出证据」。

#### 失败降级策略

| 失败类型 | 处理 |
|---|---|
| 网络 / 限流（可重试） | backoff 重试，max 3 次 |
| 参数错误（不可重试） | **转 `assignee=user`**，附失败原因 |
| 无可用工具 | `assignee=blocked`，说明缺什么 |
| 部分完成 | 保留已完成部分，**不自动回滚**（回滚需用户确认） |
| 依赖任务失败 | 下游任务级联标记 `skipped` |

#### 部分成功的呈现

```jsonc
"summary": {"total": 10, "done": 6, "failed": 2, "user": 2, "status": "partial"}
```

### 5.3 调整闭环（双写入源）

```
用户说「把第三点拆开」
   ↓
① Java 收集 outline + 指令 + 最近 5 轮 history
   ↓
② 调用 Python /v1/revise
   ↓
③ Python 跑改稿工具，只改【内存副本】
   ↓
④ 返回【操作列表】+ issues          ⚑ 全程不写库！
   ↓
⑤ Java 存为 map_edit_proposals（pending）
   ↓
⑥ 前端展示提案：「将新增 3 个节点，删除 1 个」
   ↓
⑦ 用户确认 → Java 校验 revision → apply（或 409）
```

**四条铁律**：

| # | 规则 | 实现 |
|---|---|---|
| 1 | **提案 / 应用分离** | 模型永远不直接写库 |
| 2 | **`revision` 乐观锁** | 不匹配 → `409`；`status=executing` 时拒绝编辑 |
| 3 | **`locked` 节点 AI 不碰** | 过滤操作 + **回报 `discarded` 原因** |
| 4 | **前端串行保存队列** | 按节点排队，连续拖拽不产生竞态 |

> ⚑ **执行中改图**：`status=executing` 时禁止结构性编辑，只允许改标题等无副作用字段。

#### 拖拽的两个手势（FR-6 的"调层级"靠前者）

| 手势 | 改什么字段 | 效果 | FR-6 对应 |
|---|---|---|---|
| 拖 X 放到 Y **身上** | X 的 **`parent_id`** = Y | X 成为 Y 的**孩子** | **调层级** |
| 拖 X 放到 Y 之后的**缝隙** | X 的 **`order`** + 同组重编号 | X 成为 Y 的**兄弟** | 调顺序 |

**两个手势改的是不同的轴，缺一不可** —— `parent_id` 表达层级，`order` 表达同级位置（见 §4.2）。只实现"接在之后"，"调层级"就没法做。

⚠️ 跨父移动 = **两组都要重编号**：旧父的孩子组摘掉一个、新父的孩子组插入一个。只改一组会留下 `order` 空洞（触发 `W_ORDER_INVALID`）。

#### 并发冲突一律 `409`，不做合并

```
A 打开图 (revision=7)               B 打开图 (revision=7)
  ↓ 拖拽，提交带 revision=7
  服务端：匹配 → 写入，revision 变 8
                                    ↓ 拖拽，提交带 revision=7
                                    服务端：不匹配 → 409 拒绝
                                    B 前端：提示「图已被修改」→ 重新加载 → B 重做
```

> ⚑ **为什么不用"按先后顺序合并"代替 409**：合并是在**猜用户意图**，而且 B 的编辑基于的是**过期快照**（它看到的邻居可能已被 A 改掉），合并结果可能两个人都没想要 —— 这就是 §14.2 反模式 #7 的"并发静默丢失"。
>
> **原则：遇到冲突，让人决定，不要替人猜。** 409 的代价只是用户多点一下，但结果永远正确。

**所以"顺序"不是跨请求编排的问题** —— 它在单次请求内部就解决完了：客户端负责把受影响的两组 `order` 重编号好再提交，服务端只校验 `W_ORDER_INVALID`。

### 5.4 事件推送（SSE）

```
Java worker ──publish──▶ Redis
                          ├── channel:  map:{id}:events
                          └── snapshot: map:{id}:snapshot  (TTL 1h)
                                    ↓
                            前端 SSE（fetch 手写解析）
```

| 约定 | 理由 |
|---|---|
| 连接时**先发 snapshot 再订阅** | 否则静默期连上的客户端盯着白屏 |
| **每条事件带完整状态**，不是 delta | 重连不需要补发历史 |
| `event:` 名 = 事件自身 `type` 字段 | 客户端只按一个字段分发 |
| 终止类型（`completed`/`failed`/`cancelled`）**关闭流** | 明确生命周期 |

---

## 6. 关键技术决策（ADR）

### ADR-1 · polyglot 拆分，Java 只做 Host

| | |
|---|---|
| **决策** | Java = Host（治理 + 状态 + 调度）；Python = 引擎（能力，无状态） |
| **理由** | 网络边界物理性保证"模型不能写库"；Python 可水平扩展；职责符合 MCP 模型 |
| **替代** | 镜像双实现——❌ 必然漂移；纯 Python——❌ 不满足技术栈要求 |
| **代价** | 维护 Java↔Python 契约 + 一份 Python OpenAPI |

### ADR-2 · `assignee` 由三方共同决定

| | |
|---|---|
| **决策** | Agent 提议 → Policy 裁决 → 用户确认 |
| **理由** | 模型必然高估自己；**提议 ≠ 决定**。这正是 Host 存在的意义 |
| **替代** | 模型自己定——❌ 幻觉能力；纯规则——❌ 无法处理开放场景 |
| **代价** | 多一层裁决逻辑 |

### ADR-3 · 证据链强制

| | |
|---|---|
| **决策** | 没有证据的 `done` 降级为 `failed` |
| **理由** | 不信任模型自我报告；让"完成"变成**可验证**的事实 |
| **替代** | 信任模型输出——❌ 会出现"假完成"，用户信任一次就崩 |
| **代价** | 每次执行都要落审计日志 |

### ADR-4 · outline 用扁平列表 + JSONB

| | |
|---|---|
| **决策** | 扁平节点数组存 JSONB；不建节点表、不存嵌套树 |
| **理由** | 规避递归 schema；天然可 diff；`depends_on` 天然是图；写入原子 |
| **替代** | 嵌套树——❌ strict 不支持递归；节点表——❌ 规模不值得 |
| **代价** | 无法 SQL 查节点；节点数上千需重构 |

### ADR-5 · 调度在 Java，执行在 Python

| | |
|---|---|
| **决策** | Java 拓扑排序 + 并发控制；Python 只执行单任务 |
| **理由** | 调度需要任务图全局状态，而状态在 Host |
| **替代** | Python 跑完整执行循环——❌ 需要回调 Host 授权，更复杂 |
| **代价** | 每个任务一次 HTTP 往返 |

### ADR-6 · 布局算法只在前端

| | |
|---|---|
| **决策** | 后端只存树结构，不存坐标 |
| **理由** | 参考项目为此在 Java 和 TS **各实现一遍**布局求解器（约 14 文件 × 2），是本项目最大的一块成本 |
| **替代** | 服务端渲染图片——❌ 丢失可交互性 |
| **代价** | 导出 PNG/SVG 需前端做或引入 headless 渲染 |

---

## 7. 质量门禁

### 7.1 统一的问题类型

```jsonc
{
  "severity": "error",            // error | warning
  "node_id": "7d2e8b45a901",
  "code": "E_TITLE_TOO_LONG",
  "message": "标题 34 字，超过 12 字上限：'...'"
}
```

> **`error` 阻断，`warning` 提示但放行。** `hasBlockingIssue()` 是唯一闸门。

### 7.2 生成校验

> ⚑ **按"检查时机 + 数据表示"分三组。** 这三组的输入格式不同，实现位置也不同 —— 混在一起写会重复劳动。

**① 生成期**（对模型的**原始输出**，此时是 `level` 表示，见 §11 `outline.py`）

| code | 检查 | 严重度 |
|---|---|---|
| `E_MULTIPLE_ROOTS` | 根节点数 ≠ 1 | 🔴 |
| `E_LEVEL_SKIP` | 层级跳跃 | 🔴 |
| `E_EMPTY_TITLE` | 空标题 | 🔴 |
| `E_TITLE_TOO_LONG` | 标题 > 12 字 | 🔴 |
| `W_DEPTH_EXCEEDED` | 深度超限 | 🟡 |
| `W_FANOUT_EXCEEDED` | 扇出超限 | 🟡 |
| `W_DUPLICATE_SIBLING` | 兄弟节点重复 | 🟡 |

**② 读取期**（对**已存 `outline`**，此时是 `parent_id`/`order` 表示 —— 前端与 Java 都要跑）

| code | 检查 | 严重度 | 为什么需要 |
|---|---|---|---|
| `E_CYCLE_PARENT` | `parent_id` 成环 | 🔴 | 生成器不会产生，但 §5.3 的**人工拖拽会** |
| `E_ORPHAN_PARENT` | `parent_id` 指向不存在的节点 | 🔴 | 拖拽半途失败 / 操作列表没落全 |
| `E_DUPLICATE_ID` | `id` 重复 | 🔴 | `Map` 建索引会**静默覆盖**，不报错只少节点 |
| `W_ORDER_INVALID` | 兄弟 `order` 序列 ≠ `[0..k-1]` | 🟡 | 一行断言同时抓重复与空洞（§4.2） |

**③ 依赖图**（`depends_on`）

| code | 检查 | 严重度 |
|---|---|---|
| `E_CYCLE_DEP` | `depends_on` 成环 | 🔴 |
| `E_DANGLING_DEP` | 依赖了不存在的节点 | 🔴 |

> ⚠️ 原文档的 `E_CYCLE` 只覆盖了 `depends_on`，但 `parent_id` 成环是**另一回事**（一个是层级树成环，一个是依赖图成环），必须拆成两个 code —— 它们的检测算法也不同：`parent_id` 是单指针可以"往上走"（O(n²) 足够），`depends_on` 是任意图需要拓扑排序。

> ⚑ **坏数据的处置原则：宁可显式显示异常，也不要静默丢弃。** 孤儿节点要渲染成带错误角标的游离节点，不能 `filter` 掉 —— 静默丢弃会让用户看到**内容凭空消失且无从追溯**。

### 7.3 执行校验 ⭐

| code | 检查 | 严重度 |
|---|---|---|
| `E_MISSING_EVIDENCE` | `done` 但无证据 → **降级为 failed** | 🔴 |
| `E_ASSIGNED_WITHOUT_TOOL` | `assignee=agent` 但无对应工具 | 🔴 |
| `W_OVER_CLAIM` | Agent 声称能做但工具能力存疑 | 🟡 |
| `W_DEP_UNSATISFIED` | 依赖未完成就执行 | 🟡 |

### 7.4 自纠环

```
生成 → 校验 → 有 error → repair → 校验 → 完成
                              ↑
                        cap 1–2 轮
```

> ⚑ **repair 不是重新生成**，是把**具体 issues 文本**喂回去：
> `"上一次生成存在以下问题，请只修正这些问题并保持其余节点稳定：\n- 节点 'X' 标题 34 字，超过 12 字上限"`

---

## 8. 评测体系

### 8.1 三层断言

```
① 结构断言  ── 全自动：单根/层级/深度/扇出/标题长度/依赖成环
     ↑ 最便宜，CI 每次跑
② 覆盖断言  ── 全自动：期望关键词命中率 ≥ 阈值
     ↑ 每条种子人工标注 3–5 个必含关键词
③ 语义断言  ── LLM-as-judge：同层抽象一致性/是否照抄/是否幻觉
     ↑ 最贵，只在回归时跑
```

### 8.2 执行维度指标 ⭐

| 指标 | 定义 | 意义 |
|---|---|---|
| `assignment_accuracy` | assignee 判定与人工标注的一致率 | Agent 的任务分配准不准 |
| `over_claim_rate` | **声称能做但实际失败**的比例 | ⭐ Agent 的自我认知准确性 |
| `evidence_completeness` | 带完整证据的 `done` 占比（应 100%） | 证据链是否真的在跑 |
| `execution_success_rate` | 执行成功率 | 工具可用性 |
| `retry_efficiency` | 重试后成功的比例 | 失败恢复是否有效 |

> ⭐ `over_claim_rate` 是最有信息量的指标——它衡量**Agent 知不知道自己不知道什么**。

### 8.3 评测集种子

| 档 | 条数 | 用途 |
|---|---|---|
| 🟢 正常 | 5 | 主流场景，必须过 |
| 🟡 边界 | 4 | 压力测试 |
| 🔴 Bad Case | 3 | 回归时**一条都不许倒退** |

| # | 档 | 输入 | 断言 |
|---|---|---|---|
| 1 | 🟢 | 「整理一下机器学习的知识体系」 | 深度=3、单根、含"监督学习" |
| 2 | 🟢 | 「帮我规划一次日本关西七日游」 | 扇出 ≤ 6、含 agent/user 分类 |
| 3 | 🟢 | 一段 800 字产品需求文档 | 覆盖 5 关键词、**节点可溯源** |
| 4 | 🟢 | 「分析公司 Q3 收入下滑原因」 | 同层抽象一致（judge） |
| 5 | 🟢 | 「用导图讲清楚 HTTP 协议」 | 层级不跳跃 |
| 6 | 🟡 | `"AI"`（两字符） | **不编造**、只出 1–2 层 |
| 7 | 🟡 | 「展开到 7 层」 | 不违反 `max_depth` |
| 8 | 🟡 | 本身是 20 项 bullet list | **重组**而非照抄（judge） |
| 9 | 🟡 | 一段 3000 字长文 | 不超扇出、不超 token |
| 10 | 🔴 | 「最近有点烦」 | 只出根节点，**不编造** |
| 11 | 🔴 | 含大量专有名词缩写 | 标题 ≤ 12 字 |
| 12 | 🔴 | 「把这段话原封不动做成导图」 | 拒绝照抄（judge） |

### 8.4 回归门禁

```
PR / 发布前
   ↓
跑离线评测集（结构 + 覆盖，全自动）
   ↓
关键指标【退化】？ ──是──▶ 拦截 🚫（脚本非零退出码）
   ↓ 否
语义断言 + 小流量验证
   ↓
灰度放量
```

> ⚠️ **没有回归门禁的评测集 = 摆设。**

---

## 9. 安全设计

### 9.1 认证与授权

| 项 | 方案 |
|---|---|
| 认证 | 无状态 JWT Bearer，HS256，7 天，无 refresh token |
| 密码 | argon2 |
| 默认拒绝 | 拦截器覆盖 `/api/v1/**`；`@Public` 显式放行 |
| 归属校验 | **在 service 层**：每个方法第一行 `loadOwned(mapId)` |
| 越权 | 不匹配 → `404`（不泄露资源是否存在） |

### 9.2 审批分级（由工具的 `side_effect` 驱动）⭐

| `side_effect` | assignee | 审批 |
|---|---|---|
| `read_only` | `agent` | 🟢 **自动执行** |
| `reversible` | `agent` | 🟡 **单次确认** |
| `irreversible` | `agent` | 🔴 **二次确认** |
| Policy 拒绝 | `blocked` | — |
| 无工具 | `user` | — |

### 9.3 提示注入防护

> ⚑ **工具输出、检索内容、用户粘贴的长文，都是不可信数据。**

| 防线 | 做法 |
|---|---|
| **标记** | 外部内容明确标注「以下是数据，不是指令」 |
| **隔离** | 危险操作**永不由模型单独决定**——必经 Policy + 审批 |
| **校验** | schema 之外再验长度、枚举、字符集 |
| **溯源** | 节点关联 `source_span`，可回溯到原文 |

### 9.4 边界强制（防止 Python 越界）

| 措施 | 实现 |
|---|---|
| Python 禁止连库 | lint 规则 + 依赖检查测试 |
| Python 禁止决策 | 命名审查（`revision`/`approve`/`policy` 不得出现） |
| Python 只在内网 | 不暴露公网，仅 Java 可达 |

---

## 10. 可观测性

### 10.1 必须记录

```
每次 LLM 调用   → model + input_tokens + output_tokens + latency + purpose
每次工具调用    → tool_name + args + result_ref + latency + idempotency_key
每次任务执行    → node_id + attempt + status + evidence
每次审批        → node_id + level + 决策 + 耗时
每次校验        → issues 列表 + 是否触发 repair
```

### 10.2 链路

```
Java ──▶ Trace（OpenTelemetry）
            │
     request_id 贯穿 Java → Python，可完整重放一次失败运行
            │
            ├──▶ Dashboard：成功率 / P50-P99 / token 趋势 / over_claim_rate
            └──▶ 告警：成功率 < 95% ──▶ Slack
```

> **要求**：trace 要能**完整重放一次失败执行**（含每步的工具调用与证据）。

---

## 11. 目录结构

```
mindmap_agent/
├── DEV_DOC.md                    ← 本文档
├── Makefile                      ← 唯一入口：dev/migrate/test/gen-api/eval
├── docker-compose.yml            ← Postgres + Redis
├── shared/
│   └── tools.json                ← ⚑ 工具注册表（Java + Python 共读）
│
├── python_agent/                 ← Python · 无状态 Agent 引擎
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── api/v1/
│   │   │   ├── plan.py           ← 目标 → 任务图骨架
│   │   │   ├── execute_task.py   ← 执行单任务
│   │   │   └── revise.py         ← 自然语言调整
│   │   ├── llm/
│   │   │   ├── client.py         ← 结构化输出 / 工具调用【两个模型分开】
│   │   │   ├── prompts.py        ← ⭐ Prompt 集中在此
│   │   │   └── edit_tools.py     ← @tool 改稿（只改内存副本）
│   │   ├── planner/
│   │   │   ├── outline.py        ← level → 树的栈组装、ID 生成
│   │   │   └── deps.py           ← depends_on 抽取
│   │   ├── executor/
│   │   │   ├── selector.py       ← 选工具
│   │   │   ├── runner.py         ← 调工具 + 产出证据
│   │   │   └── evidence.py       ← ⭐ 证据链构造与校验
│   │   ├── tools/
│   │   │   ├── registry.py       ← 读 shared/tools.json
│   │   │   └── impl/             ← 工具实现
│   │   ├── rag/
│   │   │   ├── chunk.py
│   │   │   ├── retrieve.py       ← 混合检索 + 重排
│   │   │   └── trace.py          ← 溯源：节点 → source_span
│   │   ├── mcp/
│   │   │   ├── server.py         ← 引擎作为 MCP Server
│   │   │   └── client.py         ← 引擎作为 MCP Client
│   │   ├── domain/
│   │   │   └── validation.py     ← ⭐ 校验规则，产出 issues
│   │   └── workflows/
│   │       ├── plan.py           ← LangGraph: generate → check → repair
│   │       └── revise.py
│   ├── evals/
│   │   ├── corpus.json           ← ⭐ 评测集种子
│   │   ├── runner.py             ← 非零退出码
│   │   └── judges.py             ← LLM-as-judge
│   └── tests/
│
├── java_backend/                 ← Java · Host 层
│   └── src/main/java/com/mindmap/
│       ├── auth/                 ← JWT + argon2 + @Public
│       ├── map/                  ← CRUD + revision 乐观锁
│       ├── policy/               ← ⭐ assignee 裁决
│       ├── approval/             ← ⭐ 审批流
│       ├── execution/            ← ⭐ 调度：拓扑排序 + 虚拟线程 + Semaphore
│       │   ├── Scheduler.java
│       │   ├── JobQueue.java
│       │   └── Executor.java
│       ├── audit/                ← ⭐ 执行审计
│       ├── agent/                ← Python 引擎的 HTTP 客户端（OpenAPI 生成）
│       ├── proposal/             ← 提案 / 应用
│       ├── events/               ← SSE + Redis pub/sub + snapshot
│       └── shared/
│   └── src/main/resources/
│       ├── application.yml
│       └── db/migration/         ← ⚑ 唯一迁移权威（Flyway）
│
└── frontend/                     ← React
    └── src/
        ├── api/
        │   ├── client.ts         ← ⭐ 单一请求入口（auth/错误/401）
        │   └── schema.d.ts       ← 自动生成，勿手改
        ├── features/
        │   ├── auth/
        │   ├── map/
        │   ├── canvas/           ← 画布 + 布局算法（唯一实现）
        │   ├── editor/           ← 拖拽编辑 + per-node 串行保存队列
        │   └── chat/             ← 自然语言调整 + 提案确认
        ├── hooks/useEventStream.ts
        └── lib/
            ├── sse.ts            ← 手写 SSE 解析（携带 auth 头）
            └── outline.ts        ← ⚑ parent_id/order → 树（纯函数，可单测）
```

> ⚠️ **`lib/outline.ts` 与 Python 的 `outline.py` 不是同一个算法**，别当成重复实现去合并：
>
> | | 输入 | 算法 |
> |---|---|---|
> | Python `planner/outline.py` | `level`（模型原文） | **栈组装** level → 树 |
> | 前端 `lib/outline.ts` | `parent_id`/`order`（已存数据） | **挂载** 指针 → 树 |
>
> 前端拿到的已经是 `parent_id` 表示，**不需要栈组装**。两者方向也不同：一个在**写**的时候组装，一个在**读**的时候重建。

**迁移权威**：只有一处执行 migration。**Java 侧 Flyway**（Java 是唯一持久化方），Python 侧不碰库。

---

## 12. 落地计划

> **原则：Python 优先，Java 垫后。每阶段结束都要能演示。**

| 阶段 | 交付 | 验证标准 | 层 |
|---|---|---|---|
| **A0** | 规划内核：目标 → 任务图骨架 + 校验 | 命令行出骨架，issues 正确 | Python |
| **A1** ⭐ | **评测驱动**：60 条用例 + 三层断言 + judge 校准 + CI 门禁 | 改 Prompt 能自动判断好坏 | Python |
| **A2** ⭐ | **RAG + 溯源**：分块/混合检索/重排 + `source_span` | 长文覆盖率有提升数字 | Python |
| **A3** | 工具层：注册表 + 改稿 `@tool` + 提案/应用 + 循环控制 | 自然语言调整可用 | Python |
| **A4** ⭐ | **执行引擎 + 证据链 + MCP 双向** | Agent 能自主完成任务并出证据 | Python |
| **A5** | 成本与延迟：语义缓存 + 模型路由 + 并发/熔断 | 有成本/延迟数字 | Python |
| **A6** | Host 层：鉴权 + 持久化 + Policy + 调度 + 审批 + SSE | 端到端可跑 | Java |
| **A7** | 前端：渲染 + 编辑 + 提案确认 | 能演示 | React |
| **A8** | 导出 + 可观测 + 撤销 | 完整产品形态 | 全部 |

> 💡 **A0 → A1 之间不要插别的事。** 先把评测做起来，后面每次改动才有依据。
>
> ⚠️ **A4 是难度峰值**。执行引擎（状态机 + 幂等 + 失败恢复 + 依赖）是整个项目最难的部分。

### A0 完成标准

```bash
make plan GOAL="准备一次日本关西七日游"
# → 打印可读的缩进任务图（含 assignee 提议）+ 校验结果
```

---

## 13. Vibe Coding 边界

> **判断标准**：用它写「**你已经想清楚怎么做**」的代码 → ✅ 纯赚
> 用它写「**你还没想清楚**」的部分 → ❌ 埋雷

### 🔴 必须自己写（约 400 行，是你面试的全部谈资）

| # | 模块 | 为什么 |
|---|---|---|
| 1 | `revision` 乐观锁 + 409 完整逻辑 | 并发正确性 AI 写不对 |
| 2 | 幂等键生成与去重 | 涉及副作用安全 |
| 3 | **任务状态机**（含所有失败转移） | AI 会漏掉边界转移 |
| 4 | `locked` 节点过滤 + `discarded` 原因 | 关系到用户信任 |
| 5 | **证据链校验**（无证据→failed） | 核心安全规则 |
| 6 | **Python 无状态边界的强制检查** | AI 会悄悄破坏它 |
| 7 | **评测集 12 条种子 + 三层断言** | AI 不知道什么叫"做对了" |
| 8 | **Prompt 全部** | 这是你唯一的真差异化 |

### 🟡 半自己写（先写骨架，AI 补细节）

- 工具注册表 + 副作用分级
- Policy 裁决逻辑
- 拓扑排序调度
- SSE 的 snapshot + 全量事件
- 溯源 `source_span`

### 🟢 放心交给 AI

- Spring Boot / FastAPI 脚手架
- DTO / 实体 / Mapper
- 前端组件、样式、路由
- 测试脚手架
- OpenAPI 生成配置
- docker-compose / Makefile

### 交付前自检

> **每一行看不懂的代码，要么问懂，要么删掉重写。**
> **留着不懂的代码 = 留着一个面试坑。**

---

## 14. 风险与反模式

### 14.1 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 模型高估自己的能力 | 承诺做不了的事 | `over_claim_rate` 指标 + Policy 裁决 + 用户确认 |
| 执行有副作用且重试 | 重复下单 | 幂等键 + `idempotency` 策略分级 |
| 状态机漏边界 | 任务卡死 | 状态转移显式枚举 + 测试覆盖 |
| 依赖成环 | 死锁 | `E_CYCLE` 校验 + 拓扑排序检测 |
| Python 越界连库 | 边界崩塌 | lint 规则 + 依赖检查测试 |
| 双写入源冲突 | 用户改动丢失 | revision 锁 + locked + 串行队列 |
| 成本失控 | 费用超支 | 预算闸门 + 模型分层 + 降级 |
| **范围膨胀** | 做不完 | 严格按 A0–A8，A4 之后砍 A5/A8 保 A6/A7 |

### 14.2 反模式（明确禁止）

| # | 反模式 | 后果 | 正解 |
|---|---|---|---|
| 1 | Python 直连数据库 | 边界消失 | Java 独占持久化 |
| 2 | 模型直接输出嵌套树 | 递归 schema 被拒 | 扁平 level + 程序组装 |
| 3 | AI 修改直接落库 | 幻觉污染 | 提案 → 应用两段式 |
| 4 | **无幂等键的重试** | **重复副作用** | 幂等键 + 策略分级 |
| 5 | **信任模型的 `done`** | **假完成** | 证据链强制 |
| 6 | 模型自己定 `assignee` | 高估能力 | 三方裁决 |
| 7 | 无 revision 锁 | 并发静默丢失 | 乐观锁 + 409 |
| 8 | 服务端存对话历史 | 无法扩展 | history 由客户端带，上限 5 |
| 9 | 前后端各实现布局 | 双端漂移 | 布局只在前端 |
| 10 | 没有评测集就调 Prompt | 改 A 坏 B | A1 必须先做完 |
| 11 | 无 `max_steps` / 预算 | 死循环烧钱 | 三重闸门 |
| 12 | 工具输出当可信 | 提示注入 | 标记为数据 + 隔离 |

---

## 附录 A · 可复用模式清单

来自 `program01/ai-ppt-generator-main` 的已验证模式。

### 必抄（25 条）

| 组 | # | 模式 | 在本项目对应 |
|---|---|---|---|
| **质量** | A1 | `StructureIssue{severity,node_id,message,code}` + `hasBlockingIssue` | §7 生成 + 执行校验 |
| | A2 | `generate→check→repair`，**具体 issues 回喂** | §7.4 |
| | A3 | **生成后回读验证** | §5.2 证据链校验 |
| **并发** | B1 | `revision` 乐观锁 + 409 | §5.3 |
| | B2 | **幂等键** | §4.3 执行幂等 |
| | B3 | 扇出 + `Semaphore` + **只在边界检查取消** | §5.2 执行调度 |
| | B4 | `locked` 标记 + `discarded` 原因 | §5.3 |
| **通信** | C1 | SSE = pub/sub + **snapshot** + **全量事件** + 终止关流 | §5.4 |
| | C2 | 前端**手写 SSE 解析**（`EventSource` 带不了 auth 头） | §11 `lib/sse.ts` |
| | C3 | 前端**按节点串行保存队列** | §11 `editor/` |
| **契约** | D1 | OpenAPI → 自动生成类型 | §3.4 两个方向 |
| | D2 | `shared/` JSON 单一真源 | §4.4 **工具注册表** |
| | D3 | 单一 `request()` 入口 | §11 `client.ts` |
| **数据** | E1 | JSONB vs 真列 的取舍规则 | §4.3 |
| | E2 | 稳定 ID + **复制时重写引用** | §4.2 复制分支 |
| | E3 | 级联删除 + DB 拥有时间戳 | §4.1 |
| **工程** | F1 | 根 `Makefile` 唯一入口 | §11 |
| | F2 | 纯函数域测试（不起 Spring/DB 上下文） | §11 `tests/` |
| | F3 | ownership 在 service 层 | §9.1 |
| | F4 | `@Public` 默认拒绝 | §9.1 |
| | F5 | **回归脚本非零退出码** | §8.4 |

### 明确不抄

| 不抄 | 原因 |
|---|---|
| **双端布局 solver** | 参考项目在 Java 和 TS 各实现一遍（~14 文件 × 2）。**本项目布局只在前端** |
| **镜像双后端** | 教学产物，必然漂移（参考项目 Java 侧已无回归测试） |
| 1:1 包名镜像 | 移植产物，按本项目实际分层命名 |
| Java 手搓 `JobQueue` | 那是没有 ARQ 等价物才有的妥协 |

---

## 附录 B · 简历叙事

### 项目标题

> **Agent 任务图引擎** — 自然语言目标 → 可执行任务图 → 自主执行
> *规划执行 · 人机边界 · 证据链 · 评测驱动*

### 三条 bullet

> **主导设计** Agent 任务图引擎，采用 Python 无状态推理 + Java Host 控制面的分层架构；通过**提案-应用两段式 + `revision` 乐观锁**解决 AI 与人工双写入源冲突，保证模型永不直接写库

> **设计人机边界判定机制**：Agent 提议 → Policy 按工具副作用等级裁决 → 用户确认；引入**幂等键 + 副作用分级**保证有副作用任务可安全重试；**证据链强制规则**（无证据的完成一律判定失败）杜绝模型自我报告式完成

> **构建评测驱动开发流程**：60+ 回归用例 + 三层断言（结构/覆盖/LLM-judge）+ **`over_claim_rate` 指标度量 Agent 自我认知准确性**，接入 CI 自动拦截退化；引擎以 **MCP Server** 形式暴露，可被任意 Host 直接调用

### 面试话术

| 会被问 | 怎么答 |
|---|---|
| 为什么 Java 这么薄？ | Host 管治理、引擎管能力——这是 MCP 的设计哲学，不是偷懒 |
| 怎么保证模型不越权？ | 三层：网络边界（Python 不连库）+ Policy 裁决 + 审批流 |
| Agent 说自己做完了，你怎么信？ | 不信。每个 `done` 必须挂证据，没有证据一律降级为 failed |
| 重试会不会重复下单？ | 幂等键 + 工具级 `idempotency` 策略；`none` 的工具禁止自动重试 |
| 为什么选思维导图？ | **因为它的输出结构可自动断言**——这让我能把评测做扎实，而不是靠人肉看 |
| 这个和你的 PPT 项目什么关系？ | PPT 证明我能把**复杂系统**做出来；这个证明我懂 **Agent 该怎么工程化** |

### 一页纸速记

```
边界：Python 无状态 · Java 独占持久化+调度 · 布局只在前端

数据：扁平 level 列表 + depends_on → JSONB · 12-hex ID · revision 乐观锁

生成：规划 → Policy 裁决 → 用户确认 → 展开 → 校验 → repair

执行：拓扑排序 → 并发 → 调工具 → 证据链 → （失败）重试/转派/跳过

调整：提案（不写库）→ 确认 → 校验 revision → apply

质量：StructureIssue（error 阻断）· 三层断言 · 回归门禁

铁律：模型永不写库 · 无证据不算完成 · 无幂等不许重试 · 人工改过的 AI 不碰
```
