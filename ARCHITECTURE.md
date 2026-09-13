# 架构概览

> **版本** v1.0 · **日期** 2026-09-12 · 对应 `DEV_DOC.md` v0.5

---

## ⚠️ 读之前：本文的定位

**本文是「导航层」，不是权威。**

| | |
|---|---|
| **权威** | `DEV_DOC.md` —— 带编号的章节 + ADR，是唯一的真相源 |
| **本文** | 全景图、数据流、进度、约束清单 —— **方便随时回看** |
| **冲突时** | **以 `DEV_DOC.md` 为准** |

**为什么这样分**：本文若复制了 DEV_DOC 的细节，两者必然漂移 ——
这正是 §14.2 反模式里"镜像双后端必然漂移"的同一个道理，只是发生在文档层。

**所以本文只写"不重复的内容"**：跨章节的全景、当前进度、约束清单。
凡是能给出章节号的地方，一律给章节号而不复制。

---

## 0. 三十秒读懂

```
用户输入一个目标
   → Agent 规划出任务图骨架
   → 三方可裁决「每件事归谁做」（Agent 提议 / Policy 裁决 / 用户确认）
   → 自主执行能做的部分，每件完成都挂【可验证的证据】
   → 图上明确标出：哪些 Agent 做完了、哪些要你自己做、哪些卡住了
```

**和"生成器"的本质区别**（§1.2）：

```
生成器：自然语言 → 结构化产物              （LLM 应用）
执行器：自然语言目标 → 任务图 → 自主执行 → 带状态的结果   （Agent）
```

**导图不是展示图，是任务的状态面板。**

---

## 1. 三层定位

```
┌──────────────────────────────────────────────────────────────┐
│  ① React 前端                                                 │
│     · 任务图渲染（状态徽章 / 人机分色）                          │
│     · 对话面板（Agent 汇报 + 自然语言调整）                      │
│     · 拖拽编辑（per-node 串行保存队列）                          │
│     · SSE 订阅（手写解析，携带 auth 头）                         │
│     ⚑ 布局算法【只在前端跑】—— 后端不存坐标                     │
└───────────────────────┬──────────────────────────────────────┘
                        │  /api/v1/**   (JWT Bearer)
┌───────────────────────▼──────────────────────────────────────┐
│  ② Java = Agent 的 Host 层                                    │
│     · 鉴权 + 归属校验          · 持久化 + revision 乐观锁        │
│     · 【Policy 引擎】assignee 裁决                              │
│     · 【审批流】按副作用等级走不同确认路径                        │
│     · 【任务调度】拓扑排序 + 虚拟线程 + Semaphore                │
│     · 【执行审计】谁在何时做了什么                               │
│     · SSE 推送（Redis pub/sub + snapshot）                     │
│     ───────────────────────────────────────                   │
│     ⚑ 唯一持有 Postgres 连接的服务                              │
└───────────────────────┬──────────────────────────────────────┘
                        │  内部 HTTP（无状态、幂等）
┌───────────────────────▼──────────────────────────────────────┐
│  ③ Python = Agent 引擎                                        │
│     · 规划：目标 → 任务图骨架                                   │
│     · 单任务执行：选工具 → 调工具 → 产出【证据】                  │
│     · 改稿工具（@tool + bind_tools）→ 只产出【操作列表】          │
│     · RAG：分块 / 混合检索 / 重排 / 溯源                         │
│     · generate → check → repair 自纠环                         │
│     · MCP 双向（Server 暴露 + Client 消费）                     │
│     ───────────────────────────────────────                   │
│     ❌ 不连数据库  ❌ 不存会话  ❌ 不知道 revision 是什么         │
└──────────────────────────────────────────────────────────────┘
```

> **一句话概括**：**Java 管治理（谁、能不能、什么时候），Python 管能力（怎么做）。**
>
> Java 层薄是**设计**，不是妥协。它来自 MCP 的 Host/Server 模型，
> 而且用网络边界**物理性地**保证了"模型不能写库"。详见 §3.1 / §3.2 / ADR-1。

---

## 2. 一次完整请求的时序

场景：**用户输入目标 → 出图 → 确认 → 执行 → 完成**

```
① 输入目标
   前端 → Java:  POST /api/v1/maps  { goal: "帮我规划一次日本关西七日游" }

② 鉴权 + 建图
   Java: JWT 校验 → 创建 map(user_id, status='planning')

③ 规划                                              ⚑ Python
   Java → Python:  POST /v1/plan { goal, tools, max_depth:3, max_children:6 }
   Python: 调 LLM → 模型输出【扁平 level 列表】
           → 程序【栈组装】成 parent_id 结构
           → 生成 12-hex ID → 生成期校验 → 返回 nodes + issues + usage

④ 裁决                                              ⚑ Java
   Policy 读 shared/tools.json 的 side_effect
   → 修正每个节点的 assignee（模型只是【提议】，ADR-2）

⑤ 入库
   Java: 写 maps.outline (JSONB)，revision = 1

⑥ 用户确认                                          ⚑ 前端
   显示 Agent 汇报卡片（完成度 / 主要问题 / 需要你做的 + 原因）
   用户点「确认并开始执行」

⑦ 调度循环                                          ⚑ Java
   拓扑排序 → 找出 depends_on 已全部 done 的 pending 任务
   → 虚拟线程 + Semaphore(6) 并发投递

⑧ 执行单个任务                                      ⚑ Python
   Java → Python:  POST /v1/execute_task
                   { task, tools, context, idempotency_key }
   Python: selector 选工具 → runner 调用 → evidence 产出证据
           → 返回 { status, evidence, result_summary }

⑨ 落库 + 广播
   Java: 写 execution_tasks（幂等键去重）
         → 更新 outline 节点状态 → revision + 1
         → Redis publish → 前端 SSE

⑩ 回到 ⑦，直到没有 pending 或达到预算上限
```

**两个接口的区别**（§3.4）：

| 接口 | 粒度 |
|---|---|
| `/v1/plan` | **一次调用产出整张图** |
| `/v1/execute_task` | **一个任务一次调用**（ADR-5 的代价：每任务一次 HTTP 往返）|

---

## 3. 数据存在哪

| 数据 | 存在哪 | 谁写 | 详见 |
|---|---|---|---|
| 用户账号 | Postgres `users` | Java | §4.1 |
| **任务图** | Postgres `maps.outline` **JSONB** | Java | §4.1 / §4.2 / ADR-4 |
| **证据链** | Postgres `execution_tasks.evidence` | Java | §5.2 |
| 审批记录 | Postgres `approvals` | Java | §4.1 / §9.2 |
| 改稿提案 | Postgres `map_edit_proposals` | Java | §5.3 |
| SSE 事件 + 快照 | Redis（TTL 1h）| Java | §5.4 |
| **对话历史** | **不存** | —— | 客户端携带，上限 5 轮（§5.3）|
| **节点坐标** | **不存** | —— | 前端算（ADR-6）|
| **工具注册表** | `shared/tools.json` | 人 | **Java 和 Python 共读同一份**（§4.4）|

### 刻意不存的三样东西

| 不存什么 | 为什么 |
|---|---|
| **对话历史** | 服务端存 → 无法扩展 + 扩大隐私面（§14.2 反模式 #8）|
| **坐标** | 参考项目为此在 Java 和 TS **各实现一遍**，是最大的一块成本（ADR-6）|
| **第二份工具清单** | 存两份必然漂移（反模式：镜像双后端）|

### JSONB 与真列的分界（§4.3）

> **规则：结构会演进的用 JSONB；要查询 / 排序 / 加锁的用真列。**

| 用 JSONB | 用真列 |
|---|---|
| `outline` / `issues` / `operations` / `evidence` | `status` / `revision` / `user_id` / `node_id` / `idempotency_key` |

**`revision` 必须是真列**，因为乐观锁要这么写（比较必须原子）：

```sql
UPDATE maps SET outline = ?, revision = revision + 1
 WHERE id = ? AND revision = ?;   -- 返回 0 行 ⇒ 409
```

---

## 4. 目录结构

```
mindmap_agent/
├── DEV_DOC.md                  ← ⚑ 权威文档
├── ARCHITECTURE.md             ← 本文（导航层）
├── Makefile                    ← 唯一入口：dev/migrate/test/gen-api/eval
├── docker-compose.yml          ← Postgres + Redis
├── shared/
│   └── tools.json              ← ⚑ 工具注册表（Java + Python 共读）
│
├── python_agent/               ← ③ Python · 无状态引擎（A0–A5）
│   └── app/
│       ├── api/v1/             ← plan.py / execute_task.py / revise.py
│       ├── llm/                ← client.py / prompts.py ⭐ / edit_tools.py
│       ├── planner/            ← outline.py（level→树）/ deps.py
│       ├── executor/           ← selector.py / runner.py / evidence.py ⭐
│       ├── tools/              ← registry.py / impl/（各工具实现）
│       ├── rag/                ← chunk.py / retrieve.py / trace.py
│       ├── mcp/                ← server.py / client.py
│       ├── domain/validation.py ← ⭐ 校验规则，产出 issues
│       ├── workflows/          ← LangGraph: generate→check→repair
│       └── evals/              ← corpus.json ⭐ / runner.py / judges.py
│
├── java_backend/               ← ② Java · Host 层（A6）
│   └── src/main/java/com/mindmap/
│       ├── auth/               ← JWT + argon2 + @Public
│       ├── map/                ← CRUD + revision 乐观锁
│       ├── policy/             ← ⭐ assignee 裁决
│       ├── approval/           ← ⭐ 审批流
│       ├── execution/          ← ⭐ Scheduler / JobQueue / Executor
│       ├── audit/              ← ⭐ 执行审计
│       ├── agent/              ← Python 引擎的 HTTP 客户端（OpenAPI 生成）
│       ├── proposal/           ← 提案 / 应用
│       ├── events/             ← SSE + Redis pub/sub + snapshot
│       └── shared/
│   └── src/main/resources/
│       ├── application.yml
│       └── db/migration/       ← ⚑ 唯一迁移权威（Flyway）
│
└── frontend/                   ← ① React（属于 A7，已提前做出 demo）
    └── src/
        ├── types/outline.ts    ← ⚑ 数据契约（§4.2 的唯一前端映射）
        ├── lib/                ← 纯函数层（见下）
        ├── mocks/              ← §8.3 评测集种子当数据源
        └── features/
            ├── canvas/         ← 画布 + 布局算法（唯一实现）
            └── chat/           ← Agent 汇报 + 输入
```

### 前端 `lib/` 的分工（都是纯函数，可单测）

| 文件 | 职责 | 上游 |
|---|---|---|
| `outline.ts` | 扁平数组 → 树（含坏数据处理）+ `displayState()` | §4.2 / §7.2 |
| `layout.ts` | 树 → 坐标（Reingold–Tilford）| ADR-6 |
| `summary.ts` | 图 → Agent 该汇报什么 | §5.2 |
| `simulation.ts` | 模拟推进状态（按 §5.2 + §9.2 的规则）| §5.2 / §9.2 |
| `reasons.ts` | `assignee_reason` 枚举 → 人话 | §4.2 |

> ⚠️ **`lib/outline.ts` 与 Python 的 `planner/outline.py` 不是同一个算法**（§11）：
> 一个是 `level → 树`（栈组装），一个是 `parent_id → 树`（挂载）。方向也不同 —— 一个在写时组装，一个在读时重建。**别当成重复实现去合并。**

---

## 5. 当前进度

| 层 | 对应阶段 | 状态 |
|---|---|---|
| **文档** | —— | ✅ **v0.6**（每次修订的来历见文末「文档演进记录」）|
| **前端 demo** | 属于 A7 | ✅ **可运行**（数据全 mock）|
| **Python 引擎** | A0–A5 | ❌ 未开始 |
| **Java Host** | A6 | ❌ 未开始 |

### demo 里什么是真的、什么是假的

| ✅ 真的 | ❌ 假的（等 A0/A6/A4）|
|---|---|
| 数据契约（`types/outline.ts`）| 数据来源 —— mock，不是 A0 规划出来的 |
| 扁平→树重建 + **§7.2 全部 ②③ 两组坏数据检测** | 编排与调度 —— 真在 Java |
| 布局算法（ADR-6 的核心）| 状态同步 —— 真在 Java + Redis |
| **§7.1 的阻断闸门**（有 error 就不让开始执行）| 工具调用 —— 真在 Python |
| 状态机推进（按 §5.2 + §9.2 规则）| 审批写库 / 审计留痕 |
| 容器状态汇总 | 修订（`revision` 乐观锁 → 409）—— 见下 |
| Agent 汇报生成 + 审批/否决流 | |
| **依赖图渲染**（虚线箭头）+ 调度按 `depends_on` 拓扑排序 | |
| **结构性编辑**：拖拽改层级/顺序、删节点（含引用清理与重编号）| |

> ⚠️ **结构性编辑目前是"本地直接生效"** —— 没有 `revision`、没有 409、没有保存队列。
> 那些都在 A6（§5.3 的铁律 #2 和 #4）。**这是 demo 与真实系统差距最大的一处**：
> 单机演示下感觉不到差别，但真做起来这里是并发正确性的全部所在。

> **提前做 demo 最大的收益**：接口形状已经被钉住了。
> 将来 A0/A6 接上去，前端这一层**不需要重写**。

---

## 6. 不可违反的约束

| # | 约束 | 出处 |
|---|---|---|
| 1 | **Python 无状态** —— 不连库、不存会话、不知道 `revision` | §3.2 |
| 2 | **模型永不直接写库** —— 提案 → 应用两段式 | §5.3 铁律 #1 |
| 3 | **无证据的 `done` 降级为 failed**（限 `assignee=agent`）| §7.3 |
| 4 | **无幂等键不许重试** —— `idempotency=none` 禁止自动重试 | §5.2 |
| 5 | **人工改过的 AI 不碰** —— `locked` 过滤 + 回报原因 | §5.3 铁律 #3 |
| 6 | **布局只在前端** —— 后端不存坐标 | ADR-6 |
| 7 | **并发冲突一律 `409`，不合并** —— 让人决定，不替人猜 | §5.3 |
| 8 | **坏数据显式显示，不静默丢弃**（下一条的一个特例）| §7.2 |
| 9 | **不静默失败** —— 任何回退 / 跳过 / 替换都要留下**用户看得见**的痕迹 | §14.2 #13 |

> **关于第 9 条**：它不是从哪条细则推出来的，是**撞出来的** ——
> 这个项目里已经以三种形式各撞过一次（丢弃 / 跳过 / 替换）。
> 共同点是**用户看到的是错的东西，却以为是对的**，而他能信任这张图，
> 才是这个产品的全部价值。详见 §14.2 #13 那张表。
>
> ⚠️ "留下痕迹"指的是 issue 条、角标、游离节点区这类**图上的**东西 ——
> **不是日志**。日志是给开发看的，用户不会翻。

### 三个正交的轴（最容易被压成一个字段）

节点上有三条**互不替代**的信息，详见 §4.2：

| 轴 | 回答 | 取值 |
|---|---|---|
| `assignee` | 这活**归谁** | `agent` / `user` / `blocked` |
| `status` | 这活**到哪一步** | `todo` / `running` / `done` / `failed` / `skipped` |
| `approval` | 这活**批没批** | `level` × `status` |

**视图需要 ≠ 存储需要**。前端可以算出一个展示态（`displayState()`），
但**不要把视图需求倒逼进存储模型**。

---

## 7. 三个最容易被误解的地方

**① 「Agent 会自己决定做什么」** ❌

| 决策 | 谁定 | 依据 |
|---|---|---|
| **做什么任务**（哪个节点、什么顺序）| **Java Host** | 拓扑排序 + `depends_on` |
| **怎么完成**（选哪个工具、传什么参数）| **Python 引擎** | 工具的 `description` |

Agent 不能自己决定"我要去下载个东西" —— 它只能对 Host 派给它的**那一个**节点，
选择用什么工具去完成。（ADR-5）

**② 「Agent 需要被通知状态变化」** ❌

不是通知，是**调用**。Java 改完状态立刻重新调度，
Agent 在请求体里拿到全部上下文（§3.4 的 `context` 字段）。
**Agent 不是"被通知"，而是"被调用"。**

**③ 「Java 层这么薄是偷懒」** ❌

Host 管治理、引擎管能力 —— 这是 MCP 的设计哲学。
而且它用**网络边界**物理性地保证了"模型不能写库"：
Python 容器里**没有 `DATABASE_URL`，也没装任何数据库驱动**，想连也连不上。

---

## 8. 阅读顺序建议

| 你是 | 读什么 |
|---|---|
| **第一次接触** | 本文 §0 → §1 → §2 |
| **要写代码** | 本文 §4 → §6，然后 `DEV_DOC.md` 的 §3 / §5 / §11 |
| **要改数据模型** | `DEV_DOC.md` §4（含 v0.3–v0.5 的字段演进）|
| **要动 Prompt** | `DEV_DOC.md` §7 / §8 —— **A1 评测必须先做完** |
| **面试准备** | `DEV_DOC.md` §6（ADR）→ 附录 B |
| **排查"为什么这么设计"** | `DEV_DOC.md` §6 ADR + §14.2 反模式 |

### 开工前的三个问题

1. **这个改动碰了 §6 的哪条约束吗？**
2. **它属于哪一层？**（放错层比写错代码更难改）
3. **§13 的「Vibe Coding 边界」说这部分该谁写？**

---

## 附：文档演进记录

| 版本 | 变更 |
|---|---|
| **DEV_DOC v0.3** | 前端 demo 设计评审：9 处裁决（三轴正交、`order` 约束、状态机重写、拖拽手势、并发 409、校验重排、`lib/outline.ts` 澄清）|
| **DEV_DOC v0.4** | §4.2 补 `result_summary`（引擎产出却无处可存）+ `assignee_reason` 枚举（界面上要显示的原因存储层无处可放）|
| **DEV_DOC v0.5** | §7.3 把 `E_MISSING_EVIDENCE` 限定为 `assignee=agent`（人勾的完成不该被误报）|
| **DEV_DOC v0.6** | §7.2 第 ③ 组补"在哪跑"与危害说明（**整组此前从未实现**）；§14.2 新增反模式 #13「静默失败」；§5.3 新增「删除节点」并修正附录 A 的一处**悬空引用** |
| **ARCHITECTURE v1.0** | 本文 —— 从 DEV_DOC 各章节抽取的全景与导航 |

**这些缺口都是"做 demo 时暴露出来的"** —— 写代码比读文档更容易发现矛盾。

> ⚑ v0.6 的 #13 是个**新类型**：前四处缺口（v0.3–v0.5）都是"文档里写的东西
> 互相矛盾或没写全"，而 #13 是**同一个错误在本项目里以三种不同面目各犯了一次**。
> 前四处靠仔细读文档能发现，#13 只能靠撞 —— 所以它值得单独列成一条约束（§6 第 9 条）。
