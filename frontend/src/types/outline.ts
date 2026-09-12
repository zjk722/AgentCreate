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

  assignee: Assignee
  status: NodeStatus

  /** 依赖的节点 id（DAG）。与 parent_id 是两回事：一个是执行顺序，一个是层级归属。 */
  depends_on: NodeId[]
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
 * 读取期校验的 issue code（§7.2 的第 ② 组）。
 *
 * ⚑ 生成期（对模型原始输出）的 code 不在这里 —— 那些跑在 Python 侧，
 *   输入是 level 表示，而前端拿到的是 parent_id 表示，两者不是同一批检查。
 */
export type IssueCode =
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
