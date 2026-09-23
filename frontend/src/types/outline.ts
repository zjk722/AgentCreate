/**
 * 任务图的数据契约 —— 前端与后端之间唯一的类型真相。
 *
 * 形状【严格】按 DEV_DOC §4.2 的 outline 定义，**不要在这里发明字段**。
 * 一旦前端自己加字段，mock 数据就开始偏离后端的真实返回；
 * 到 A6 接真接口时，这些偏离会变成一堆「为什么渲染不出来」。
 *
 * ⚑ 三类信息是【正交】的，不要把它们压进一个字段（§4.2）：
 *
 *     assignee  —— 这活【归谁】        agent | user | blocked
 *     status    —— 这活【到哪一步】    todo | running | done | failed | skipped
 *     approval  —— 这活【批没批】      level × status
 *
 *   为什么必须分开：如果把「待确认」塞进 status，那么每一处读 status 的代码
 *   （§5.3 的「executing 时拒绝编辑」、D4 的配色、A6 的调度）都被迫理解审批语义。
 *   存储模型保持干净，展示需求由前端自己算 —— 见 lib/outline.ts 的 displayState()。
 */

/* ── 基础枚举 ─────────────────────────────────────────────── */

/** 12 位 hex 字符串（§4.2）。TS 无法在类型层约束长度，靠断言与运行时校验兜底。 */
export type NodeId = string

/** 这活归谁做（§4.2）。注意：`blocked` 是 assignee，不是 status。 */
export type Assignee = 'agent' | 'user' | 'blocked'

/**
 * 为什么这么分 —— **枚举，不是自由文本**（§4.2）。
 *
 * ⚑ 每个取值都对应文档里一条【明确的规则】，所以界面上显示的每一句原因
 *   都能追到出处。若改成 `reason: string` 让模型自由写，它会产出
 *   「因为签证政策复杂」这种听着合理但无出处的句子 ——
 *   与「不存原始思维链」是同一条理由：自我报告不可验证。
 *
 * 界面上那句自然的说明（如「需本人办理」）由前端据枚举【翻译】，
 * 不由后端生成 —— 措辞可改而不动数据。
 */
export type AssigneeReason =
  /** user：只能人来（需本人办理 / 个人偏好）—— §1.2 的签证、出行日期 */
  | 'needs_human'
  /** blocked：工具清单里没有能做的工具 —— §9.2「无工具」 */
  | 'no_tool'
  /** user：Agent 尝试过但失败，转人工 —— §5.2 失败降级表 */
  | 'agent_failed'
  /** user：用户否决了 Agent 的方案 —— §5.2 的 rejected 转移 */
  | 'user_rejected'
  /** blocked：Policy 按规则拒绝 —— §9.2「Policy 拒绝」 */
  | 'policy_denied'

/** 任务生命周期（§4.2 / §5.2）。归谁是 assignee，别混。 */
export type NodeStatus = 'todo' | 'running' | 'done' | 'failed' | 'skipped'

/** 审批等级，由工具的 side_effect 决定（§4.4 → §9.2）。命名沿用 §4.1。 */
export type ApprovalLevel = 'confirm' | 'double_confirm'

/** 审批结果。`rejected` 是一等公民 —— 用户拒绝后转 assignee=user（§5.2）。 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

/* ── 复合结构 ─────────────────────────────────────────────── */

/** 审批状态。A6 时由 Java 从 approvals 表 join 拍平到节点上（§4.1）。 */
export interface Approval {
  level: ApprovalLevel
  status: ApprovalStatus
}

/**
 * 执行证据（§5.2）。
 *
 * ⚑ 铁律：**没有证据的 `done` 一律降级为 `failed`**（§7.3 的 E_MISSING_EVIDENCE）。
 *   理由是不信任模型的自我报告 ——「Agent 说做完了」不等于做完了，
 *   「Agent 拿出工具调用记录」才算。这就是这个字段存在的全部意义。
 */
export interface Evidence {
  tool: string
  args: Record<string, unknown>
  /** 指向审计日志里的原始调用，可回溯（§10.1） */
  result_ref: string
  elapsed_ms: number
  verified_at?: string
}

/**
 * 任务图的一个节点（§4.2）。
 *
 * 存储是【扁平数组】而不是嵌套树 —— 这是 ADR-4 的核心决策：
 *   · 规避 LLM 结构化输出不支持递归 schema 的问题（反模式 #2）
 *   · 天然可 diff（AI 改 vs 人改）
 *   · `depends_on` 本身就是图，嵌套树表达不了
 *   · 写入是"整批替换"语义，JSONB 更原子
 */
export interface OutlineNode {
  id: NodeId
  /** 父节点 id；`null` 即根。【层级由这个字段表达】 */
  parent_id: NodeId | null
  /**
   * 同级内的下标。
   * ⚑ 约束：同一父节点下必须【恰好】是 0..k-1（连续、不重复）。
   *   它是【派生值】不是创作值 —— 每次结构性改动都要重编号整个兄弟组。
   *   校验因此只有一条：排序后必须等于 [0,1,...,k-1]，一行断言同时抓重复和空洞。
   */
  order: number
  title: string
  /**
   * 产出摘要 —— 用户看图时最想知道的东西：「那个 Agent 到底查到了什么」。
   *
   * ⚑ 只存【摘要】，完整输出在审计日志里，由 `evidence.result_ref` 指向。
   *   理由：一次检索可能上千字，存进 JSONB 会把 outline 撑爆，
   *   而 §4.3 要求 outline 是「写入原子、整批替换」的字段。
   *
   * 长度：生成侧应截断到 ~40 字（与 W_TITLE_TOO_LONG 同理 ——
   * 界面上放不下的东西不该进存储）。
   */
  result_summary?: string | null

  assignee: Assignee
  /**
   * 为什么这么分。`assignee === 'agent'` 时为 null（归 Agent 无需解释）。
   * 枚举见 `AssigneeReason` 的说明。
   */
  assignee_reason?: AssigneeReason | null
  /**
   * 原因的短细节：缺的工具名、触发的规则名。
   *
   * ⚠️ 只放**短且机器可读优先**的内容（如 `restaurant_booking`）。
   *    **不要**在这里写叙述性句子 —— 一旦开口子，它就会退化成
   *    和自由文本一样不可验证的东西。
   */
  assignee_detail?: string | null

  status: NodeStatus

  /** 依赖的节点 id（DAG）。与 parent_id 是两回事：一个是执行顺序，一个是层级归属。 */
  depends_on: NodeId[]
  /**
   * 用户【认可跳过】的前置 —— 上游被放弃之后，用户说"这个我照做"。
   *
   * ⚑ 为什么需要它：上游变 `skipped` 之后，下游会停在「**待你决定**」，
   *   而**那个状态是算出来的**（`status === 'todo'` + 有上游 `skipped`），
   *   不是存下来的。所以用户点完"照做"，**必须往数据里写点什么** ——
   *   否则下一次算出来还是「待你决定」→ **点了没反应** ✗。
   *
   * ⚑ 为什么不干脆把它从 `depends_on` 里删掉（那样最省事）：
   *   那样**事后就查不出用户做过这个决定**了 —— 图上看，
   *   「打印行程单」和「买保险」之间像是什么都没发生过。
   *   而 `deleteNode` 的"清理引用"改的是**一模一样的数据**，
   *   两个完全不同的原因会**混成一种**。所以这里记一笔，不擦掉事实。
   *
   * ⚠️ **本字段允许过期**：被豁免的那个节点后来若被删掉，
   *   这个 id 在 `depends_on` 里已经没有了 —— **读取时忽略即可，不要报错**。
   *   这不是坏数据，是设计允许的。（和 `E_DANGLING_DEP` 正相反：
   *   那是意外，这是预期。）
   *
   * ⚠️ 它**只豁免点名的那些依赖**，不是把整个节点放行 ——
   *   而且必须是**用户点过的**。绝不能拿"上游是 skipped"当通用放行条件：
   *   那会把**硬前置**也一起放行（「决定出行日期」被放弃后，
   *   「预订酒店」照样被派发 ✗，而没有日期根本订不了）。
   */
  waived_deps: NodeId[]
  /** 人工改过 → AI 不许碰（§5.3 铁律 #3）。AI 改稿时被过滤掉并回报 discarded 原因。 */
  locked: boolean

  evidence?: Evidence | null
  /** RAG 溯源：对应原文的字符区间（§9.3 防幻觉） */
  source_span?: [number, number][]
  /** 审批状态（§4.1 / §9.2）；无审批需求时为 null */
  approval?: Approval | null
}

/* ── 质量门禁（§7.1） ─────────────────────────────────────── */

/**
 * 统一的 issue 形状（§7.1，附录 A 的 A1 模式）。
 * `error` 阻断，`warning` 提示但放行。
 */
export interface StructureIssue {
  severity: 'error' | 'warning'
  /** 出问题的节点；与具体节点无关时为 null（如 E_MULTIPLE_ROOTS） */
  node_id: NodeId | null
  code: IssueCode
  message: string
}

/**
 * issue code 的全集 —— §7.2 的三组都在这里。
 *
 * ⚑ 第 ② 组（层级树，看 `parent_id` / `order`）和第 ③ 组（依赖图，看
 *   `depends_on`）是**两张不同的图**，检测算法也不同 ——
 *   前者是单指针可以"往上走"，后者是任意有向图需要 DFS 三色标记。
 *   但它们都在同一个入口 buildTree() 里跑，因为读数据的地方只有那一个。
 *
 * ⚑ 第 ① 组（生成期）**有一部分也在这里**（2026-09-22 加的）。
 *   这段原来写的是「生成期的 code 不在这里 —— 那些跑在 Python 侧」，
 *   那句话把【谁产出】和【谁能算】当成了同一件事。真相是：
 *
 *     · ① 组跑在 Python 侧，是因为生成期能**最早**抓到（组装成树之前）
 *     · 但组里 6 条有 5 条**根本不依赖 `level` 表示** —— 用 `parent_id`
 *       就能算（§4.2 自己就写着"前端需要深度时自己遍历算"）
 *     · 唯一真正绑在 `level` 上的是 `E_LEVEL_SKIP`，而它**永远不需要**
 *       出现在这里 —— 见下面 ① 组那段
 *
 * ⚑ 前端**自己算**的额外好处：这些 issue **永远新鲜**。用户把长标题改短，
 *   警告当场消失。若改成读后端存的那一份（`DEV_DOC` §4.1 的 `maps.issues`），
 *   还得先定"编辑之后谁刷新它" —— 而那条规矩文档里**没有**。
 */
export type IssueCode =
  /* ── ② 层级树 ─────────────────────────────────────────── */
  /** parent_id 成环。生成器不会产生，但 §5.3 的人工拖拽会 */
  | 'E_CYCLE_PARENT'
  /** parent_id 指向不存在的节点。拖拽半途失败 / AI 操作列表没落全 */
  | 'E_ORPHAN_PARENT'
  /** id 重复。Map 建索引会静默覆盖 —— 不报错，只是莫名少一个节点 */
  | 'E_DUPLICATE_ID'
  /** 根节点数 ≠ 1 */
  | 'E_MULTIPLE_ROOTS'
  /** 兄弟 order 序列 ≠ [0..k-1] */
  | 'W_ORDER_INVALID'

  /* ── ③ 依赖图 ─────────────────────────────────────────── */
  /** depends_on 成环。调度器永远等不到一个自相依赖的任务，会静默停住 */
  | 'E_CYCLE_DEP'
  /**
   * depends_on 指向不存在的节点。
   *
   * ⚠️ 这个比 E_CYCLE_DEP 更隐蔽：环至少还能从"任务不动了"看出来，
   *    而悬空依赖只是让**那一个**任务永远静静等着 ——
   *    界面上它就是一个普通的 todo，看不出任何异常。
   */
  | 'E_DANGLING_DEP'
  /**
   * depends_on 指向了一个【容器】（不执行的分组）。
   *
   * ⚠️ **后果和 `E_DANGLING_DEP` 一模一样** —— 那个任务永远等着，
   *    界面上看不出任何异常。但【病因和修法都不同】，所以必须是两个 code：
   *
   *      `E_DANGLING_DEP`    那个 id **不在图里** —— 人去找它是【找不到】的
   *      `E_DEP_ON_CONTAINER` 那个节点**就在图里**、有标题有孩子 ——
   *                           人去找它【找得到】，只是它【不是个任务】
   *
   * ⚑ 合并成一个名字的代价是**报的话会撒谎**：报"不存在"时人会去图里找，
   *   而它明明好端端地画在树上 ✓。两个来源也不同 ——
   *   悬空依赖在生成期就被 `planner/deps.py` 拦掉了（找不到的标题当场报错），
   *   现实中只剩"人删节点忘了清引用"一个来源；而依赖容器是**模型自己在犯**，
   *   它看得见那个标题，只是把"一组"当成了"一件事"。
   *
   * ⚑ 这一条**同时覆盖**「依赖别的分组」和「依赖自己的父/祖辈」——
   *   后者是前者的特例（有孩子就是容器），而它是"**等自己**"，后果最重。
   */
  | 'E_DEP_ON_CONTAINER'
  /**
   * **容器（分组）自己**写了 `depends_on`，但没有任何代码读它。
   *
   * ⚠️ 这一条和上面那个**方向正好相反**，命名上必须一眼分得开：
   *
   *     `E_DEP_ON_CONTAINER`       **依赖指向**了一个容器  ← 谁指向了别人
   *     `W_CONTAINER_DEPS_UNREAD`  **容器自己**有依赖      ← 谁不该有依赖
   *
   *   所以前者首词是 `DEP_`、后者首词是 `CONTAINER_` —— 不靠后缀区分。
   *   （名字长得像而意思相反，就是我们刚花一整轮修的那个病：**报的话会撒谎**。）
   *
   * ⚑ 为什么是 **warning** 不是 error：它**不制造死锁** —— 容器不被派发，
   *   孩子们有自己的依赖。丢的是**一条约束**，不是**一个任务**，所以不该拦住整张图。
   *
   * ⚠️ 但丢的方式是**静默的**（#13）：模型写下的"整组要等 X"从此不存在，
   *   而图上看不出任何异常，控制台干干净净。
   */
  | 'W_CONTAINER_DEPS_UNREAD'

  /* ── ① 生成期（§7.2 ①）—— 前端也算得出的那几条 ──────────────
   *
   * ⚑ `E_LEVEL_SKIP` **故意不在这里**：它判的是 `level` 表示，而那是
   *   组装成 `parent_id` 之后就丢弃的中间产物。更关键的是它**不需要**：
   *   跳级 → Python 的 `assemble()` 直接抛错、树根本装不出来 ⇒ 进不了存储；
   *   而在 `parent_id` 表示里深度是**派生值**，"跳一级"这种状态压根表达不出来。
   *
   * ⚠️ `W_DEPTH_EXCEEDED` / `W_FANOUT_EXCEEDED` **也还没进来** ——
   *   它们要 `max_depth` / `max_children`，那是**每张图不同的请求参数**
   *   （`evals/corpus.json` 里就有 6 和 9 两种），而 `maps` 表（§4.1）和
   *   `INTEGRATION.md` 里都没有它们。编个默认 3/6 会**撒谎**，所以宁可不查。
   *   等 A6 把参数落库再补 —— 那之前，前端对这两条是"没查"，不是"没问题"。
   */
  /**
   * 标题为空（或只有空白）。🔴 阻断。
   *
   * ⚑ 和超长不同，这个是**真坏**：用户看到的是一格**空白**，
   *   他不知道自己该在那里填什么 —— 所以拦住开工是对的。
   */
  | 'E_EMPTY_TITLE'
  /**
   * 标题超长（> 12 字）。🟡 提示。
   *
   * ⚑ 2026-09-22 从 🔴 降成 🟡（完整理由见 `DEV_DOC` §7.2 ①）。
   *   一句话：它和 `W_DEPTH_EXCEEDED` / `W_FANOUT_EXCEEDED` 是**同一类东西**
   *   （某个尺寸超了），而那两条一直是 🟡 —— 这张表原来就自相矛盾。
   *   内容完整、只是**宽了一点**的节点，不该拦住整张图开工。
   */
  | 'W_TITLE_TOO_LONG'
  /**
   * 同一父节点下有同名兄弟。🟡 提示。
   *
   * ⚑ `node_id` 是 **`null`** —— 一对重名兄弟**没有单一的归属**，
   *   挂给谁都是偏心（Python 那边同样给 null）。点名靠 message：
   *   父节点是谁、两个兄弟各自的 `order`。
   */
  | 'W_DUPLICATE_SIBLING'

/* ── 视图模型 ─────────────────────────────────────────────── */

/**
 * 展示状态 —— **只用于渲染，不进存储**。
 *
 * 它是 `status` 与 `approval` 的合成结果：
 *   · `awaiting_confirmation` 来自 approval.status === 'pending'
 *   · `rejected`              来自 approval.status === 'rejected'
 *
 * 这样做的好处：存储层保持正交干净，而 UI 仍能一眼区分
 * 「Agent 干完了」(done)、「等你点头」(awaiting_confirmation)、
 * 「你拒绝了，现在归你」(rejected) —— 三种完全不同的处境。
 */
export type DisplayState = NodeStatus | 'awaiting_confirmation' | 'rejected'
