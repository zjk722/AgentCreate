/**
 * 视觉映射表 —— 语义值 → Tailwind 类名。
 *
 * ⚠️ 为什么必须写成【字面量的完整类名字符串】：
 *   Tailwind 是【扫描源码文本】来决定生成哪些样式的。写 `text-${status}`
 *   这种拼接，扫描器看不到完整类名，那些样式根本不会被打包进去 ——
 *   而且不报错，只是颜色莫名失效。
 *
 * ⚑ 三条视觉通道的分工（这是本项目的核心视觉设计）：
 *
 *     status   →  颜色 + 图标形状     （两个通道，抗色盲）
 *     assignee →  边框【线型】        （实线 / 虚线 / 点线，与颜色无关）
 *     approval →  独立的文字 chip      （不占用上面两个通道）
 *
 *   为什么 assignee 不复用颜色：如果 status 用颜色、assignee 也用颜色，
 *   用户看到一张红色虚线的卡片，得先猜"红的是状态还是归属"。
 *   分到不同通道后，两者可以任意组合而互不干扰。
 */
import type { Assignee, Approval, NodeStatus } from '../../types/outline'

/* ── status：颜色 ─────────────────────────────────────────── */

export const STATUS_TEXT: Record<NodeStatus, string> = {
  todo: 'text-todo',
  running: 'text-running',
  done: 'text-done',
  failed: 'text-failed',
  skipped: 'text-skipped',
}

export const STATUS_BORDER: Record<NodeStatus, string> = {
  todo: 'border-todo/40',
  running: 'border-running/60',
  done: 'border-done/50',
  failed: 'border-failed/60',
  skipped: 'border-skipped/40',
}

export const STATUS_SOFT_BG: Record<NodeStatus, string> = {
  todo: 'bg-todo-soft',
  running: 'bg-running-soft',
  done: 'bg-done-soft',
  failed: 'bg-failed-soft',
  skipped: 'bg-skipped-soft',
}

/** 状态的中文名，直接显示在卡片上（颜色之外的第二条信息通道） */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  todo: '待办',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

/* ── assignee：边框线型 ───────────────────────────────────── */

/**
 * ⚑ 只用【线型】区分归属，不用颜色。
 *
 *   实线 = Agent 自己干（数字世界的默认）
 *   虚线 = 该你动手了（人介入的标记）
 *   点线 = 卡住了，谁都推不动
 */
export const ASSIGNEE_BORDER_STYLE: Record<Assignee, string> = {
  agent: 'border-solid',
  user: 'border-dashed',
  blocked: 'border-dotted',
}

export const ASSIGNEE_LABEL: Record<Assignee, string> = {
  agent: 'Agent',
  user: '你来做',
  blocked: '卡住了',
}

/* ── approval：独立 chip ──────────────────────────────────── */

export interface ApprovalChip {
  label: string
  className: string
}

/**
 * 审批 chip。⚠️ 这几档【不复用】status 的颜色 ——
 * 审批的"需二次确认"和执行的"失败"是完全不同的两件事，
 * 都用红色会让人以为节点执行出错了。
 */
/* ── 入场动画的节奏 ───────────────────────────────────────── */

/**
 * 每深一层，晚多久出场（毫秒）。
 *
 * 一层 = Agent 的一次思考。所以"层与层之间隔一会儿"读起来是
 * 「想一步 → 出一批 → 再想一步 → 再出一批」。
 *
 * ⚠️ 90ms 这个数：太短（比如 20ms）看着还是一坨一起冒出来，
 *    太长（比如 300ms）等得人心焦，四层就要等一秒多。
 *
 * ⚑ 这里只放【等待时间】。动画本身演多久、怎么演、以及
 *   "减弱动效"怎么降级，都在 index.css 里 —— 只有等待时间
 *   需要参与计算（第几层 × 90ms），所以只有它必须住在 JS 这边。
 */
export const ENTER_STAGGER_MS = 90

export function approvalChip(approval: Approval | null | undefined): ApprovalChip | null {
  if (!approval) return null

  if (approval.status === 'pending') {
    return approval.level === 'double_confirm'
      ? { label: '需二次确认', className: 'bg-approve-twice-soft text-approve-twice' }
      : { label: '待确认', className: 'bg-approve-once-soft text-approve-once' }
  }
  if (approval.status === 'rejected') {
    return { label: '已被否决', className: 'bg-rejected-soft text-rejected' }
  }
  // approved：批准是"通过"而非"需要注意"，不占视觉重量，不显示 chip
  return null
}
