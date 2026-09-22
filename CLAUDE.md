# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 这个项目是什么

自然语言目标 → **可执行任务图** → 自主执行 → 带证据和状态的结果。

它**不是**"自然语言转结构化产物"的生成器（那是 LLM 应用）。差别在于：这张导图是
**任务的状态面板**，不是展示图 —— 图上必须能看出"哪些 Agent 做完了、哪些要你自己做、哪些卡住了"。

目标架构是三层（`DEV_DOC.md` §3.1，MCP 的 Host/Server 模型）：

```
React 前端   ── /api/v1/** (JWT) ──→  Java Host 层  ── 内部 HTTP ──→  Python 引擎
渲染 + 编辑 + 对话                     鉴权/持久化/Policy/审批/调度/SSE    规划/执行/工具/证据
布局算法只在前端跑                      唯一持有 Postgres 的服务            无状态，不连库
```

**一句话**：Java 管治理（谁、能不能、什么时候），Python 管能力（怎么做）。

---

## ⚠️ 当前真实状态（先读这段，再读文档）

**`DEV_DOC.md` 描述的是一张完整的蓝图，而仓库里只实现了其中一部分。** 两者别搞混。

| 层 | 状态 |
|---|---|
| `python_agent/` | **A0 已完成**：目标 → DeepSeek → 栈组装成树 → §7.2 ① 的 7 条校验 → `depends_on` 解析 |
| `python_agent/evals/` | **A1 进行中**：`corpus.json` 只有 **3 条**种子（计划 12 条），无 `judges.py`，无 `baseline.json` |
| `frontend/` | **提前做出来的 demo**（本属 A7），数据全来自 `src/mocks/`。布局算法、§7.2 ②③ 组校验、状态机、闸门都是真的 |
| `java_backend/` | ❌ **不存在**。`docker-compose.yml` 也不存在 |

**因此仓库里找不到这些**（不是遗漏，是排期）：`app/api/v1/execute_task.py`、`revise.py`、
`llm/edit_tools.py`、`executor/`、`rag/`、`mcp/`、`frontend/src/api/`、`frontend/src/hooks/`。

### ⚠️ `ARCHITECTURE.md` 已经过时

它在开头自称"导航层，不是权威"，而它现在**比代码更旧**：目录树里画着 `java_backend/`、
`docker-compose.yml`、`frontend/src/api/client.ts`（全都不存在），`evals/` 的位置也画错了。
**冲突时以 `DEV_DOC.md` 为准**（它自己开头就这么说的）—— 但要知道它的现状描述可能也是旧的，
**以仓库里的代码为准**。

---

## 常用命令

**根目录的 `Makefile` 是唯一入口**（附录 A 的 F1 模式）。它**只放已经能用的目标** ——
空的 target 比没有更糟（会让人以为那件事做过了），所以 `migrate` / `gen-api` 故意不在里面。

```bash
make help                          # 先看这个
make plan GOAL="准备一次日本关西七日游"    # 目标 → 任务图骨架（⚠️ 调真模型，花钱）
make prompt GOAL="..."             # 只打印【将要发出去】的内容，不调模型、零成本
make test                          # Python 测试
make eval                          # A1 评测跑批（⚠️ 调模型；退化时非零退出码）
make eval ARGS="--only seed-03"    # 只跑一条种子
make serve                         # 后端 /v1/plan，端口 8000
make web                           # 前端 Vite，端口 5173（首次先 cd frontend && npm install）
```

**改 Prompt 后先用 `make prompt` 看一眼，再跑真模型。** 这不是省钱，是因为 Prompt 的格式错误
是隐形的（相邻字面量会自动拼接、多行 f-string 会把源码缩进带进正文，读源码都看不出来）。

`make serve` 和 `make web` 是**两个终端各跑一条**，故意不合成一条（日志混在一起就没法排查）。
**更不要改成后台起一个** —— `&` / `start` 在 cmd 和 sh 里写法不同。

### 单条测试

```bash
cd python_agent && uv run pytest tests/test_outline.py            # 单个文件
cd python_agent && uv run pytest tests/test_outline.py::test_函数名 # 单个用例
cd python_agent && uv run pytest -k "level_skip"                  # 按名字筛

cd frontend && npx vitest run src/lib/layout.test.ts   # 单个文件
cd frontend && npx vitest run -t "某个用例名"           # 按名字筛
```

### 前端

```bash
cd frontend
npx tsc -b          # ⚑ 类型检查必须是这个：根 tsconfig 只有 references、files 为空，
                    #   所以 `tsc --noEmit` 在这里【检查 0 个文件】却是成功的（假绿灯）
npm test            # = vitest run（全部 335 个）
npm run lint        # oxlint
npm run build       # tsc -b && vite build
```

环境变量放 `python_agent/.env`（`DEEPSEEK_API_KEY`，可选 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`）。
`.env` 由 `app/llm/client.py` 里的 `load_dotenv()` 加载 —— **故意挂在"用 key 的地方"而不是某个入口**，
这样 CLI、FastAPI、evals、临时脚本行为一致。

---

## 文档地图与权威顺序

```
DEV_DOC.md         ⚑ 权威。带编号的章节 + ADR，唯一的真相源
ARCHITECTURE.md    导航层：全景/数据流/进度。⚠️ 现状部分已过时（见上）
INTEGRATION.md     前端 ↔ Java 的接口契约：前端每处交互对应哪个接口
CHANGELOG.md       每次推送的批次记录（含每个决定的【理由】）—— 想知道"为什么这样"先翻它
shared/README.md   tools.json 里 DEV_DOC 没写、而这份文件自己产生的决定
python_agent/evals/README.md   corpus.json 每格什么意思、为什么这么定
```

**冲突时一律以 `DEV_DOC.md` 为准。** 这些文档刻意**不互相复制细节** ——
因为复制必然漂移（§14.2 的"镜像双后端"，同一个道理发生在文档层）。
所以 CLAUDE.md 也**不复制**规矩，只指出该去哪儿读。

**开工前先问三个问题**（§8 结尾）：

1. 这个改动碰了下面「不可违反的约束」里的哪条吗？
2. 它属于哪一层？（放错层比写错代码更难改）
3. §13 的「Vibe Coding 边界」说这部分该谁写？

---

## 不可违反的约束

| # | 约束 | 出处 |
|---|---|---|
| 1 | **Python 无状态** —— 不连库、不存会话、不知道 `revision` 是什么 | §3.2 |
| 2 | **模型永不直接写库** —— 提案 → 应用两段式 | §5.3 铁律 #1 |
| 3 | **无证据的 `done` 降级为 failed**（限 `assignee=agent`）| §7.3 |
| 4 | **无幂等键不许重试** —— `idempotency=none` 禁止自动重试 | §5.2 |
| 5 | **人工改过的 AI 不碰** —— `locked` 过滤 + 回报原因 | §5.3 铁律 #3 |
| 6 | **布局只在前端** —— 后端不存坐标 | ADR-6 |
| 7 | **并发冲突一律 `409`，不合并** —— 让人决定，不替人猜 | §5.3 |
| 8 | **坏数据显式显示，不静默丢弃** | §7.2 |
| 9 | **不静默失败** —— 任何回退/跳过/替换都要留下**用户看得见**的痕迹 | §14.2 #13 |

### 第 9 条是这个仓库的头号原则

它不是从哪条细则推出来的，是**撞出来的** —— 同一个错误在这里已经以三种面目各犯过一次
（丢弃 / 跳过 / 替换）。共同点是**用户看到的是错的东西，却以为是对的**，
而"他能信任这张图"才是这个产品的全部价值。

**"留下痕迹"指的是 issue 条、角标、游离节点区这类【图上的】东西 —— 不是日志。**
日志是给开发看的，用户不会翻。

这条原则会出现在很具体的地方，见一个就照着一个的样子做：

- `PlanResult.check_implemented` —— 因为"issues 为空"有两种可能：**查过了没问题** / **还没查**
- `runner.py` 顶层打印"语义层还没做" —— 而不是静默少跑一层
- `cli.py` 打印"校验未实现" —— 否则"0 个 issue"会被读成"校验通过"
- 拖拽遇到的坏结构**不自己修**，摆出来让人看见
- 报错信息要能把人引向**对的方向**（`/health` 端点的存在就是为了区分"后端没起来"和"模型调用失败"）

### 三个正交的轴（最容易被压成一个字段）

`assignee`（归谁）· `status`（到哪一步）· `approval`（批没批）—— 详见 `frontend/src/types/outline.ts`。
**视图需要 ≠ 存储需要**：展示态由前端 `displayState()` 算，不要把视图需求倒逼进存储模型。

---

## 代码风格：这个仓库的注释规矩

**这里的注释几乎全在讲「为什么」，而且密度远高于普通项目。** 写代码时要照着这个风格来。

- **注释用中文**，与整个仓库一致。
- 每一个非显然的决定都要写清**为什么这么定**、**否掉了哪条别的路**、以及**踩过什么坑**。
  例：`pyproject.toml` 里解释 `package = false` 和 `python-preference = "only-system"` 各是干什么的；
  `planner/outline.py` 的 `new_id()` 解释为什么 id 是随机生成而不是按内容 hash。
- **能给出章节号的地方一律给章节号**（`§7.2` / `ADR-2` / 附录 A 的 A1 模式），不要复述内容。
- 注释里会写**日期**和"实测过"（如"2026-09-16 改过来的"）—— 这是这个仓库的记录方式。
- ⚠️ **`prompts.py`、`shared/tools.json`、`corpus.json` 里的正文会被原样发给模型**，
  那里**不能写注释**（别用 jsonc，别把 TS 风格的注释塞进 Prompt 字符串）。

### 结构性规矩（写了就别绕开）

| 规矩 | 为什么 |
|---|---|
| **`level_parents()` / `level_breaks()` 是"谁是谁的爹"的唯一实现** | 组装器和校验器必须用同一份。两份必然漂移，而漂移的形状是"校验说没问题、组装却抛异常"，两边都不报错 |
| **CLI 和 FastAPI 路由调同一个 `plan_goal()`** | 各写一遍就是 §14.2 的镜像双实现，只不过发生在同一侧 |
| **`coverage_hits()` 是"哪个方向中了"的唯一实现** | 否则判定和报告会不一致 |
| **`planner/outline.py`（Python）和 `lib/outline.ts`（前端）不是同一个算法，别合并** | 一个是 `level → 树`（写时栈组装），一个是 `parent_id → 树`（读时挂载）|
| **前端"容器"的判据要和 CLI 里 `_containers()` 一致**（谁被人当过 `parent_id`）| 否则会出现"前端不当任务、后端当任务"的错位 |

---

## 不要做的事

### §13 划归「必须人自己写」的部分 —— 不要替他写

§13 的边界是：**你已经想清楚怎么做的** → 交给 AI 是纯赚；**还没想清楚的** → 用 AI 是埋雷。

| 🔴 不要主动写 | 为什么 |
|---|---|
| `llm/prompts.py` 的 Prompt 正文 | §13 第 8 条 —— 这是项目**唯一的真差异化**。当前 `SYSTEM_PROMPT` / `build_user_prompt` 是**用户自己填的**，别"顺手优化" |
| `evals/corpus.json` 的种子 + 三层断言的判定标准 | §13 第 7 条 —— "AI 不知道什么叫**做对了**" |
| `revision` 乐观锁 / 幂等键 / 状态机 / 证据链校验 / `locked` 过滤 | §13 第 1–6 条 |

（管子可以写：`runner.py` / `judges.py` / `make eval` / 基线机制。）

### ⚑ 没有评测集之前，不要调 Prompt

§14.2 #10：改 Prompt 是**改 A 坏 B**。A0 真跑时已经攒下四条待量的信号
（结构平铺撞 `W_FANOUT_EXCEEDED`、模型绕过 Policy 的判据自己判 user、13.9 秒贴近 NFR-1 上限）——
它们**被有意留下来交给 A1 去量**，不要现在动。

### 不要用假数据兜底

- Prompt 或 schema 没写 → `PromptNotWritten` **报错**，不退回假数据
- 模型返回不是合法 json → 把**原始返回**打出来
- 调模型失败 → **抛错，绝不返回半个结果**（半个结果看着像成功，比报错危险得多）
- `--only` 给了不存在的 id → 报错，不能"跑 0 条然后全绿"

⚠️ **只在用户明确要求、或仓库已有的测试/脚本需要时**才跑 `make plan` / `make eval` ——
它们每次都真花钱调模型。先用 `make prompt`。

---

## 这台机器上的环境事实

| 事实 | 影响 |
|---|---|
| **Windows + Git Bash**，控制台的默认代码页不是 UTF-8 | `Makefile` 里 `export PYTHONIOENCODING = utf-8`、`cli.py` / `runner.py` 里 `sys.stdout.reconfigure()` —— 都是为这个。**报错时最需要读的就是那几行中文** |
| `github.com` **直连不通** | 仓库级 `http.proxy = http://127.0.0.1:7897`。代理没开时 `git` / `winget` 全失败 |
| `uv` 被限定 `python-preference = "only-system"` | uv 默认从 **github** 下载它自己管版的 Python。限定用系统 Python（cpython-3.12.6）绕开这个和本项目无关的网络请求 |
| `make` 只从 **Git Bash** 验证过 | cmd / PowerShell 下**未验证** —— "没验证"不等于"不能用"，但也不能记成"通过" |
| 前端**没装 jsdom / testing-library** | 组件测试用 `react-dom/server` 的 `renderToString`。它会在相邻文本插值间插 `<!-- -->` 注释、并转义 `& < "` —— 整句断言会失败而界面其实是对的 |

---

## 前端要点

`frontend/` 的数据**全来自 `src/mocks/`**（seed 数据 + 真模型跑出来的两份方案 + 一份故意坏掉的数据样本）。
`vite.config.ts` 里的 `/v1` 与 `/health` 代理是**开发脚手架，只存在于 `test-frontend` 分支** ——
目标架构里前端**只跟 Java 说话**，A6 之后这两条代理和 `test.html` 要一起撤掉。

**`src/lib/` 全是纯函数、可单测**（`layout` / `outline` / `outlineEdit` / `simulation` / `summary` / `reasons`）。
新增业务逻辑优先放这里，别写进组件。

**`src/types/outline.ts` 是前端与后端唯一的数据契约** —— 形状严格按 §4.2，**不要在这里发明字段**。
一旦前端自己加字段，mock 就开始偏离后端真实返回，到 A6 接真接口时会变成一堆"为什么渲染不出来"。

**Tailwind v4 是 CSS-first**（没有 `tailwind.config.js`，主题变量在 `src/index.css`）。
⚠️ 类名必须是**字面量**：`text-${x}` 这种拼接 Tailwind 扫不到，**而且不报错**，只是颜色静默失效。

**`frontend/README.md` 是 Vite 模板的默认文件，不是本项目的说明。**
