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
import type { CSSProperties, DragEvent } from 'react'
import type { LayoutOptions, PositionedNode } from '../../lib/layout'
import { displayState } from '../../lib/outline'
import type { DropPosition } from '../../lib/outlineEdit'
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

/**
 * 上/下段各占卡片高度的多少。
 *
 * 0.25 意味着：上 25% 是"插到前面"、下 25% 是"插到后面"、中间 50% 是"当孩子"。
 */
const BAND_EDGE = 0.25

/**
 * 拖拽相关的状态与回调。
 *
 * ⚑ 打成一个包传进来，而不是散成七个 prop —— 拖拽状态是**一整套**东西，
 *   散开之后调用方很容易漏传其中一个（比如忘了传 draggingId，
 *   于是正在拖的那张卡不会变半透明，看起来像拖了个寂寞）。
 */
export interface DragHandlers {
  /** 能不能拖。§5.3：执行中禁止结构性编辑 */
  enabled: boolean
  /** 正在被拖的是谁（用来把它画成半透明） */
  draggingId: string | null
  /** 当前悬停在哪个位置。null = 没有有效落点 */
  over: { targetId: string; position: DropPosition } | null
  onStart: (id: string) => void
  onOver: (targetId: string, position: DropPosition) => void
  onDrop: () => void
  onEnd: () => void
}

export function GraphNode({
  p,
  opts,
  selected,
  onSelect,
  drag,
}: {
  p: PositionedNode
  opts: LayoutOptions
  selected: boolean
  onSelect: (id: string) => void
  drag: DragHandlers
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

  const isDragging = drag.draggingId === n.id
  const dropHere = drag.over?.targetId === n.id ? drag.over.position : null

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
        // 正在被拖的这张：变淡，表示"它要被搬走了"
        isDragging && 'opacity-40',
        // 落点是"当孩子"时，整张卡亮起一圈 —— 看着像被"套住"
        dropHere === 'child' && 'ring-4 ring-slate-900/25',
        drag.enabled && 'cursor-grab active:cursor-grabbing',
        selected ? 'shadow-md ring-2 ring-slate-900 ring-offset-1' : 'shadow-sm',
      ]
        .filter(Boolean)
        .join(' ')}
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
      /* ── 拖拽 ────────────────────────────────────────── */
      draggable={drag.enabled}
      onDragStart={(e) => {
        // ⚠️ Firefox 不在 dataTransfer 里放点东西就不肯开始拖拽 ——
        //    这行看着没用，删掉的话在 Firefox 上拖不动。
        e.dataTransfer.setData('text/plain', n.id)
        e.dataTransfer.effectAllowed = 'move'
        drag.onStart(n.id)
      }}
      onDragOver={(e) => {
        if (!drag.enabled || !drag.draggingId || drag.draggingId === n.id) return
        // ⚠️ 不调这句 preventDefault，浏览器就认为这里不接收拖拽，
        //    drop 事件永远不会来（表现为"松手没反应，也不报错"）。
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // ⚑ 根节点的上/下两段是【死区】：插到根的前面或后面，
        //   等于挂到"没有爸爸"下面，自己也变成根，图就裂成两棵树了
        //   （见 outlineEdit.ts 的 multiple_roots 护栏）。
        //   所以整张根卡片都算"当孩子"。
        drag.onOver(n.id, n.parent_id === null ? 'child' : bandAt(e))
      }}
      onDrop={(e) => {
        e.preventDefault()
        drag.onDrop()
      }}
      onDragEnd={() => drag.onEnd()}
      // 屏幕阅读器需要一句话说清这张卡片是什么
      aria-label={`${n.title}，${STATUS_LABEL[n.status]}，${ASSIGNEE_LABEL[n.assignee]}${
        chip ? `，${chip.label}` : ''
      }`}
    >
      {/* 插入位置指示线。纯装饰，且必须 pointer-events-none ——
          否则它会挡住底下卡片的拖拽判定，指示线自己变成落点 */}
      {dropHere === 'before' && <InsertLine where="before" />}
      {dropHere === 'after' && <InsertLine where="after" />}

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

/* ── 落点判定 ─────────────────────────────────────────────── */

/**
 * 鼠标停在卡片的哪一段？
 *
 * ⚑ 为什么把一张卡切成三段，而不是去找文档说的那个"缝隙"：
 *   缝隙只有 16px（DEFAULT_LAYOUT.gapY），鼠标根本瞄不准 ——
 *   而不远处的另一条规范（WCAG 2.2 的 target-size）要求指针目标
 *   至少 24×24 像素。切成上中下三段之后，可落点从一条 16px 的缝
 *   扩大到整张卡的四分之一，**而语义完全一样**：
 *   上段/下段就是文档说的"缝隙"，只是可点区域变大了。
 */
function bandAt(e: DragEvent<HTMLElement>): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / rect.height

  if (ratio < BAND_EDGE) return 'before'
  if (ratio > 1 - BAND_EDGE) return 'after'
  return 'child'
}

/**
 * 插入位置指示线 —— 告诉用户"会掉在这儿"。
 *
 * ⚑ 为什么"当孩子"没有指示线、而是整张卡亮一圈（见上面的 ring）：
 *   这两种落点【性质不同】—— 一个是"插进这一排"，一个是"挂到它下面"。
 *   如果都用线表示，用户分不清这两件事。
 */
function InsertLine({ where }: { where: 'before' | 'after' }) {
  return (
    <span
      aria-hidden
      className={[
        'pointer-events-none absolute right-0 left-0 h-1 rounded-full bg-slate-900',
        where === 'before' ? '-top-1.5' : '-bottom-1.5',
      ].join(' ')}
    />
  )
}
