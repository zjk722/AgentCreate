/**
 * 从任务图算出「Agent 该怎么向用户汇报」。
 *
 * ⚑ 这是 §5.2「部分成功的呈现」的落地：
 *
 *     "summary": {"total": 10, "done": 6, "failed": 2, "user": 2, "status": "partial"}
 *
 *   也是 §5.1 第 ③ 步的落地：
 *
 *     「我将执行 3 项，5 项需要你」← 可调整
 *
 * ⚑ 为什么必须是【从 outline 算】而不是手写一段文案：
 *   这样 A0/A6 真做起来时这个面板不用重写 —— 它消费的就是后端将来会返回的
 *   那个 summary。手写文案则会变成一个和真实数据脱节的假零件。
 *
 * 纯函数，不依赖 React。输入 outline + issues，输出可直接渲染的结构。
 * 注意它【不产出自然语言句子】—— 枚举到人话的翻译在 lib/reasons.ts，
 * 因为那是产品措辞，该可改而不动数据（§4.2）。
 */
import type {
  Assignee,
  AssigneeReason,
  NodeStatus,
  OutlineNode,
  StructureIssue,
} from '../types/outline'
import { hasBlockingIssue } from './outline'

/** 整张图的处境。用于决定界面上说话的语气和重点。 */
export type Verdict =
  /** 还没有节点 */
  | 'empty'
  /** 全部待办，还没开始 */
  | 'pending'
  /** 有任务正在跑 */
  | 'running'
  /** 部分完成（有失败的、卡住的、或待人处理的） */
  | 'partial'
  /** 全部完成 */
  | 'complete'
  /** 有阻断性问题，先处理它 */
  | 'blocked'

/** 一条"需要人管"的待办：谁做、做什么、为什么 */
export interface PendingTodo {
  id: string
  title: string
  reason: AssigneeReason | null
  detail: string | null
}

export interface MapSummary {
  total: number
  byStatus: Record<NodeStatus, number>
  byAssignee: Record<Assignee, number>

  /** 已完成占比 0–1。空图记 0。 */
  progress: number
  verdict: Verdict

  /** 需要用户自己做的（assignee=user 且还没完成） */
  userTodos: PendingTodo[]
  /** 卡住的（assignee=blocked） */
  blockers: PendingTodo[]
  /** 等用户点头的（approval=pending） */
  awaitingApproval: PendingTodo[]

  /** 未解决的问题（§7.1 的 issue），已按严重度排好序 */
  problems: StructureIssue[]

  /** 一句可直接显示的结论。只由计数拼出，不含任何模型生成的文字。 */
  headline: string
}

const EMPTY_STATUS: Record<NodeStatus, number> = {
  todo: 0,
  running: 0,
  done: 0,
  failed: 0,
  skipped: 0,
}

const EMPTY_ASSIGNEE: Record<Assignee, number> = {
  agent: 0,
  user: 0,
  blocked: 0,
}

export function summarize(outline: OutlineNode[], issues: StructureIssue[]): MapSummary {
  const byStatus = { ...EMPTY_STATUS }
  const byAssignee = { ...EMPTY_ASSIGNEE }
  const userTodos: PendingTodo[] = []
  const blockers: PendingTodo[] = []
  const awaitingApproval: PendingTodo[] = []

  for (const n of outline) {
    byStatus[n.status]++
    byAssignee[n.assignee]++

    const todo: PendingTodo = {
      id: n.id,
      title: n.title,
      reason: n.assignee_reason ?? null,
      detail: n.assignee_detail ?? null,
    }

    // "需要人管"的三个口径是【互相独立】的：
    //   · userTodos         —— 归属是人（可能还没轮到审批）
    //   · awaitingApproval  —— 归属是 Agent，但卡在等点头
    //   · blockers          —— 谁都做不了
    // 一个节点可以同时出现在前两类里（先审批、批完仍归你），这是对的。
    if (n.assignee === 'user' && n.status !== 'done') userTodos.push(todo)
    if (n.assignee === 'blocked' && n.status !== 'done') blockers.push(todo)
    if (n.approval?.status === 'pending') awaitingApproval.push(todo)
  }

  const total = outline.length
  const done = byStatus.done
  const progress = total === 0 ? 0 : done / total

  // issue 排序：error 在前。界面上读者最该先看到阻断项。
  const problems = [...issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  )

  const verdict = decideVerdict({ total, byStatus, issues })

  return {
    total,
    byStatus,
    byAssignee,
    progress,
    verdict,
    userTodos,
    blockers,
    awaitingApproval,
    problems,
    headline: headlineOf({ verdict, total, byStatus, userTodos, blockers, problems }),
  }
}

/**
 * 判断整张图的处境。
 *
 * ⚠️ 判断顺序就是优先级 —— blocked 压过一切，因为再往下说"完成了 6 项"
 *    也没意义：用户得先处理那个阻断问题。界面上说话的顺序也是这个理。
 */
function decideVerdict({
  total,
  byStatus,
  issues,
}: {
  total: number
  byStatus: Record<NodeStatus, number>
  issues: StructureIssue[]
}): Verdict {
  if (total === 0) return 'empty'
  if (hasBlockingIssue(issues)) return 'blocked'
  if (byStatus.running > 0) return 'running'
  if (byStatus.done === total) return 'complete'
  // failed / skipped 也算"不是干净的待办"，因为它们需要人来收尾
  if (byStatus.done > 0 || byStatus.failed > 0 || byStatus.skipped > 0) return 'partial'
  return 'pending'
}

/** 结论句。⚠️ 全部由计数拼装 —— 没有任何模型生成的文字参与。 */
function headlineOf({
  verdict,
  total,
  byStatus,
  userTodos,
  blockers,
  problems,
}: {
  verdict: Verdict
  total: number
  byStatus: Record<NodeStatus, number>
  userTodos: PendingTodo[]
  blockers: PendingTodo[]
  problems: StructureIssue[]
}): string {
  switch (verdict) {
    case 'empty':
      return '还没有任务。说说你想做什么。'

    case 'blocked': {
      const errors = problems.filter((p) => p.severity === 'error').length
      return `有 ${errors} 个阻断性问题，需要先处理才能继续。`
    }

    case 'pending':
      return `我拆出了 ${total} 项任务，其中 ${userTodos.length} 项需要你自己做。确认后开始执行。`

    case 'running':
      return `进行中：已完成 ${byStatus.done}/${total}。`

    case 'complete':
      return `全部 ${total} 项已完成。`

    case 'partial': {
      const parts = [`已完成 ${byStatus.done}/${total}`]
      if (byStatus.failed > 0) parts.push(`${byStatus.failed} 项失败`)
      if (blockers.length > 0) parts.push(`${blockers.length} 项卡住`)
      if (userTodos.length > 0) parts.push(`${userTodos.length} 项需要你`)
      return parts.join('，') + '。'
    }
  }
}
