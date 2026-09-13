/**
 * 单个任务节点的卡片。
 *
 * 信息分层（从上到下、从重到轻）：
 *
 *   ┌────────────────────────────────────┐
 *   │ ✓  预订大阪酒店              🔒 📋 │  ← 状态图标(色) + 标题 + 标记
 *   │ [待办] Agent · 待确认              │  ← 状态标签 + 归属 + 审批 chip
 *   └────────────────────────────────────┘
 *      ↑边框色 = status   ↑边框线型 = assignee
 *
 * ⚑ 背景色只被【审批】占用：待确认/被否决时染成琥珀/紫，
 *   其余恒为白。这样背景、边框色、边框线型、图标形状是四条互不打架的通道。
 */
import type { CSSProperties } from 'react'
import type { LayoutOptions, PositionedNode } from '../../lib/layout'
import { displayState } from '../../lib/outline'
import { EvidenceIcon, LockIcon, StatusIcon } from './StatusIcon'
import {
  ASSIGNEE_BORDER_STYLE,
  ASSIGNEE_LABEL,
  ENTER_STAGGER_MS,
  STATUS_BORDER,
  STATUS_LABEL,
  STATUS_SOFT_BG,
  STATUS_TEXT,
  approvalChip,
} from './styles'

export function GraphNode({
  p,
  opts,
  selected,
  onSelect,
}: {
  p: PositionedNode
  opts: LayoutOptions
  selected: boolean
  onSelect: (id: string) => void
}) {
  const n = p.data
  const state = displayState(n)
  const chip = approvalChip(n.approval)
  const hasEvidence = Boolean(n.evidence)

  // 入场：根节点（第 0 层）没有爸爸，所以不往哪个方向偏，只做淡入 + 放大；
  // 其余的从左滑进来。第几层就等几个 90ms —— 于是整张图是一层层长出来的。
  // ⚠️ 动画的完整说明（为什么只能动 transform、怎么降级）在 index.css 里。
  const isRoot = p.depth === 0

  // 背景只表达审批状态，不表达生命周期
  const background =
    state === 'awaiting_confirmation'
      ? n.approval?.level === 'double_confirm'
        ? 'bg-approve-twice-soft'
        : 'bg-approve-once-soft'
      : state === 'rejected'
        ? 'bg-rejected-soft'
        : 'bg-white'

  return (
    <button
      type="button"
      onClick={() => onSelect(n.id)}
      // 键盘可聚焦 —— 画布上的节点是交互元素，必须能 Tab 到
      className={[
        'absolute flex flex-col justify-center gap-1 rounded-lg border-2 px-2.5 text-left',
        'transition-shadow duration-150 hover:shadow-md',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1',
        // 入场动画。根节点用另一套 keyframes（不位移），所以这里要分两种
        isRoot ? 'node-enter-root' : 'node-enter',
        STATUS_BORDER[n.status],
        ASSIGNEE_BORDER_STYLE[n.assignee],
        background,
        selected ? 'shadow-md ring-2 ring-slate-900 ring-offset-1' : 'shadow-sm',
      ].join(' ')}
      style={
        {
          left: p.x - opts.nodeWidth / 2,
          top: p.y - opts.nodeHeight / 2,
          width: opts.nodeWidth,
          height: opts.nodeHeight,
          // 等待时间由"第几层"算出来，只能走内联样式。
          // ⚠️ 用自定义属性而不是 animation-delay —— 因为"减弱动效"降级
          //    要靠改写 animation-delay 来清零，而内联样式优先级更高会盖掉它。
          //    详见 index.css 里的说明。
          '--enter-delay': `${p.depth * ENTER_STAGGER_MS}ms`,
        } as CSSProperties
      }
      // 屏幕阅读器需要一句话说清这张卡片是什么
      aria-label={`${n.title}，${STATUS_LABEL[n.status]}，${ASSIGNEE_LABEL[n.assignee]}${
        chip ? `，${chip.label}` : ''
      }`}
    >
      {/* ── 标题行 ─────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <StatusIcon status={n.status} className={`shrink-0 ${STATUS_TEXT[n.status]}`} />
        <span className="truncate text-[13px] leading-tight font-medium text-slate-800">
          {n.title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-slate-400">
          {hasEvidence && <EvidenceIcon />}
          {n.locked && <LockIcon />}
        </span>
      </div>

      {/* ── 元信息行 ───────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[10px] leading-none">
        <span className={`rounded px-1 py-0.5 font-medium ${STATUS_SOFT_BG[n.status]} ${STATUS_TEXT[n.status]}`}>
          {STATUS_LABEL[n.status]}
        </span>

        <span className="text-slate-500">{ASSIGNEE_LABEL[n.assignee]}</span>

        {chip && (
          <span className={`rounded px-1 py-0.5 font-medium ${chip.className}`}>
            {chip.label}
          </span>
        )}

        {n.evidence && (
          <span className="ml-auto shrink-0 tabular-nums text-slate-400">
            {n.evidence.elapsed_ms}ms
          </span>
        )}
      </div>

      {/* ── 产出摘要行 ───────────────────────────────────
       * ⚑ 这一行是整个卡片的"为什么值得看"：用户盯着任务图时，
       *   最想知道的就是 Agent 到底查到了什么，而不是它花了多久。
       *   这里只放得下十来个字，完整内容在详情面板。 */}
      {n.result_summary && (
        <p className="truncate text-[10px] leading-tight text-slate-500">
          {n.result_summary}
        </p>
      )}
    </button>
  )
}
