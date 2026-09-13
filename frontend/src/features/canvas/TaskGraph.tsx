/**
 * 任务图画布 —— 把 D2 的树和 D3 的坐标渲染出来。
 *
 * 结构：
 *
 *   <main>  （可滚动容器）
 *     ├── 点阵背景
 *     ├── 问题提示条      ← 有 error 时置顶，因为它会阻断
 *     ├── 图（SVG 连线 + HTML 节点，同一坐标系叠放）
 *     ├── 游离节点区      ← ⚑ 坏数据不丢弃，单独显示
 *     ├── 图例
 *     └── 详情面板（选中时）
 */
import { useMemo, useState } from 'react'
import { DEFAULT_LAYOUT, dependencyPairs, layout } from '../../lib/layout'
import { buildTree } from '../../lib/outline'
import { moveNode, type DeleteMode, type DropPosition } from '../../lib/outlineEdit'
import type { NodeAction } from '../../lib/simulation'
import type { OutlineNode, StructureIssue } from '../../types/outline'
import { DependencyEdge } from './DependencyEdge'
import { DetailPanel } from './DetailPanel'
import { GraphEdge } from './GraphEdge'
import { GraphNode, type DragHandlers } from './GraphNode'
import { ASSIGNEE_BORDER_STYLE, ASSIGNEE_LABEL, STATUS_TEXT } from './styles'
import { StatusIcon } from './StatusIcon'
import type { Assignee, NodeStatus } from '../../types/outline'

const ALL_STATUSES: NodeStatus[] = ['todo', 'running', 'done', 'failed', 'skipped']
const ALL_ASSIGNEES: Assignee[] = ['agent', 'user', 'blocked']

export function TaskGraph({
  outline,
  onNodeAction,
  onMove,
  onDelete,
  dragEnabled = false,
}: {
  outline: OutlineNode[]
  /** 用户在详情面板里对单个节点执行的操作。不传则面板只读。 */
  onNodeAction?: (nodeId: string, action: NodeAction) => void
  /** 用户把节点拖到了新位置（改层级或改顺序） */
  onMove?: (draggedId: string, targetId: string, position: DropPosition) => void
  /** 用户删掉了一个节点。`mode` 决定它的子树是跟着走还是上移一层 */
  onDelete?: (nodeId: string, mode: DeleteMode) => void
  /**
   * 能不能改结构。§5.3：`executing` 时禁止结构性编辑。
   * 默认 false —— **默认锁上**，忘了传参数时是"改不了"，
   * 而不是"能改但没人管"。
   */
  dragEnabled?: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [over, setOver] = useState<{ targetId: string; position: DropPosition } | null>(null)

  // 结构重建（D2）→ 坐标计算（D3）。两者都是纯函数，用 useMemo 缓存，
  // 免得每次 hover/选中都重算一遍布局。
  const built = useMemo(() => buildTree(outline), [outline])
  const positioned = useMemo(() => layout(built.roots, DEFAULT_LAYOUT), [built.roots])

  // 依赖线**不走** buildTree —— 因为层级树和依赖图是两张不同的图。
  // `depends_on` 可以横跨整个树连到任意节点，树里表达不了。
  const depPairs = useMemo(
    () => dependencyPairs(outline, positioned.nodes),
    [outline, positioned.nodes],
  )

  /**
   * 真正挂在主树上的节点 id。
   *
   * ⚑ 为什么要有它：**只有这些能当"新父亲"。**
   *
   *   对游离节点来说，这是"修好它"的唯一出路 —— 挂到另一个游离节点下面
   *   只会让游离变更多，用户以为修好了其实更糟。
   *
   *   ⚠️ 而且这条对【正常节点】同样成立：把一个好节点挂到一个孤儿下面，
   *      等于亲手制造一个新的孤儿。所以这不是"坏数据的特例处理"，
   *      是"只有连得到根的东西才有资格当父亲"这么一条通例。
   *
   *   `positioned.nodes` 正好就是"能连到根的那些"—— 它是从 built.roots
   *   展开来的（见 lib/layout.ts），游离节点根本进不去。所以这里直接复用它，
   *   不用再遍历一次树。
   */
  const attachable = useMemo(
    () => new Set(positioned.nodes.map((p) => p.id)),
    [positioned.nodes],
  )

  const selectedNode = selected
    ? (outline.find((n) => n.id === selected) ?? null)
    : null

  /**
   * 判断"鼠标底下这个位置能不能放"。
   *
   * ⚑ 关键设计：这里**直接调用真正的移动逻辑**，而不是另写一套"能不能放"的判断。
   *
   *   如果高亮用一套规则、真正移动用另一套，两者迟早会不一致 ——
   *   用户看到"可以放"的高亮，松手却什么都没发生，而且无从知道为什么。
   *   用同一个函数算，就永远不可能对不上。
   *
   *   代价是每次鼠标移动都跑一次 moveNode —— O(n)，二十个节点是纳秒级，
   *   换来的是"不可能不一致"。这笔账很划算。
   */
  function handleOver(targetId: string, position: DropPosition) {
    if (!draggingId) return
    const r = moveNode(outline, draggingId, targetId, position)
    setOver(r.ok ? { targetId, position } : null)
  }

  const clearDrag = () => {
    setDraggingId(null)
    setOver(null)
  }

  const drag: DragHandlers = {
    enabled: dragEnabled && Boolean(onMove),
    draggingId,
    over,
    onStart: setDraggingId,
    onOver: handleOver,
    onDrop: () => {
      if (draggingId && over) onMove?.(draggingId, over.targetId, over.position)
      clearDrag()
    },
    // onDragEnd 一定会触发（不管有没有成功放下），所以清场放这儿最保险 ——
    // 只靠 onDrop 清的话，用户中途按 Esc 取消就会留下一张半透明的卡。
    onEnd: clearDrag,
  }

  return (
    <main className="relative flex-1 overflow-auto bg-slate-100">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(203 213 225) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {built.issues.length > 0 && <IssueBar issues={built.issues} />}

      {/* ⚑ 锁上时必须说明【为什么】。最糟的做法是"拖不动但不告诉你原因"——
          那比没做这个功能更伤：用户会以为程序坏了，然后反复重试。 */}
      {!drag.enabled && outline.length > 0 && <DragLockedNote />}

      <div
        className="relative m-4"
        style={{ width: positioned.width, height: positioned.height }}
      >
        {/* 连线层。aria-hidden：结构信息已经由节点本身的父子关系表达，
            让屏幕阅读器逐条读边只会制造噪声 */}
        <svg
          className="absolute inset-0 overflow-visible"
          width={positioned.width}
          height={positioned.height}
          aria-hidden
        >
          {/* 箭头形状。SVG 的箭头不能直接画在线旁边，得先在这儿定义一次，
              再由每条线用 markerEnd 引用它（顺便也省下了每条线各画一个三角形） */}
          <defs>
            <marker
              id="dep-arrow"
              viewBox="0 0 10 10"
              // refX/refY = 箭头上的哪一个点对准线的终点。
              // 取 9（而不是 10）是让箭尖略微越过终点一点，正好贴在卡片边上
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              // 跟着线的方向自动转，所以不用为每个方向各画一个箭头
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-500" />
            </marker>
          </defs>

          {/* 父子线先画（在下层）：它表达的是"这张图怎么分组的" */}
          {positioned.edges.map((e) => (
            <GraphEdge key={`${e.from.id}-${e.to.id}`} from={e.from} to={e.to} opts={DEFAULT_LAYOUT} />
          ))}

          {/* ⚑ 依赖线后画（在上层）。顺序是有意的 ——
              层级线表达"分类"，依赖线表达"执行顺序"，后者是会直接影响
              用户判断"Agent 会不会做错"的信息，不该被前者盖住。 */}
          {depPairs.map((e) => (
            <DependencyEdge
              key={`dep-${e.from.id}-${e.to.id}`}
              from={e.from}
              to={e.to}
              detour={e.detour}
              opts={DEFAULT_LAYOUT}
            />
          ))}
        </svg>

        {/* 节点层 */}
        {positioned.nodes.map((p) => (
          <GraphNode
            key={p.id}
            p={p}
            opts={DEFAULT_LAYOUT}
            selected={selected === p.id}
            onSelect={setSelected}
            drag={drag}
          />
        ))}
      </div>

      {built.detached.length > 0 && (
        <DetachedStrip nodes={built.detached} selected={selected} onSelect={setSelected} />
      )}

      <Legend />

      {selectedNode && (
        <DetailPanel
          node={selectedNode}
          outline={outline}
          editable={drag.enabled}
          attachable={attachable}
          onClose={() => setSelected(null)}
          onAction={onNodeAction ?? (() => {})}
          onMove={onMove ?? (() => {})}
          onDelete={(id, mode) => {
            onDelete?.(id, mode)
            // ⚑ 删完之后面板必须收起 —— 它显示的那个节点已经不存在了。
            //   留着的话面板会显示一个"幽灵节点"，而且下拉框、依赖、
            //   删除按钮全都指向一个已经没了的 id。
            setSelected((cur) => (cur === id ? null : cur))
          }}
        />
      )}
    </main>
  )
}

/* ── 结构锁定提示 ─────────────────────────────────────────── */

/**
 * ⚑ §5.3：`executing` 时禁止结构性编辑 —— 调度器正在跑，
 *   改结构会让它和实际状态对不上（它按 `order` 决定"下一步该谁"）。
 *
 * ⚠️ 这条提示不是装饰，是**必需品**。禁用了却不说话，
 *   用户只会得出"这功能是坏的"这个结论，然后反复重试。
 *   **"不能用但不告诉你为什么"，比"没做这个功能"更伤。**
 */
function DragLockedNote() {
  return (
    <div className="sticky top-0 z-10 mx-4 mt-4">
      <p className="rounded-md border border-slate-300 bg-white/95 px-3 py-2 text-[11px] leading-relaxed text-slate-600 shadow-sm backdrop-blur">
        <span className="font-semibold">正在执行，结构暂时锁住了。</span>
        这会儿改层级或顺序，会让正在跑的任务跟图上对不上（§5.3）。
        等它停下来就能拖。
      </p>
    </div>
  )
}

/* ── 问题提示条 ───────────────────────────────────────────── */

/**
 * ⚑ `error` 阻断、`warning` 提示但放行（§7.1）。
 *   这里只是【展示】—— 真正的闸门是 `hasBlockingIssue()`，
 *   调用它的地方（A0 的生成流程、A6 的审批流）才做决定。
 */
function IssueBar({ issues }: { issues: StructureIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <div className="sticky top-0 z-10 mx-4 mt-4 space-y-1.5">
      {errors.length > 0 && (
        <Banner tone="error" title={`${errors.length} 个错误（阻断）`} items={errors} />
      )}
      {warnings.length > 0 && (
        <Banner tone="warning" title={`${warnings.length} 个警告（放行）`} items={warnings} />
      )}
    </div>
  )
}

function Banner({
  tone,
  title,
  items,
}: {
  tone: 'error' | 'warning'
  title: string
  items: StructureIssue[]
}) {
  const style =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-800'

  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${style}`}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i, idx) => (
          <li key={idx} className="flex gap-2">
            <code className="shrink-0 font-mono text-[10px] opacity-70">{i.code}</code>
            <span className="min-w-0">{i.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── 游离节点区 ───────────────────────────────────────────── */

/**
 * 挂不上主树的节点（父节点不存在 / 身处环中）。
 *
 * ⚑ 为什么单独列出来而不是 `filter` 掉 —— 本项目的核心原则之一：
 *
 *     【对用户数据，宁可显式显示异常，也不要静默丢弃。】
 *
 *   静默丢弃会让用户看到"内容凭空消失"，而且无从知道发生过什么。
 *   摆在这里，用户立刻明白"这部分出了问题，需要处理"。
 */
function DetachedStrip({
  nodes,
  selected,
  onSelect,
}: {
  nodes: OutlineNode[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="mx-4 mb-4 rounded-lg border-2 border-dashed border-red-200 bg-red-50/50 p-3">
      <h2 className="mb-2 text-xs font-semibold text-red-700">
        游离节点 · {nodes.length} 个（未能挂到主树上，已保留而非丢弃）
        {/* ⚑ 这句提示是【必须】的，不是装饰。
            光说"这些坏了"却不告诉用户能怎么办，等于立了块告示牌却不给路 ——
            而这正是 #13（静默失败）要防的东西，只不过这次是"有出口但不说"。
            ⚠️ 出口不存在和出口不告诉你在哪，对用户是同一件事。 */}
        <span className="ml-1 font-normal text-red-600">— 点一下可以改它挂在哪</span>
      </h2>
      <ul className="flex flex-wrap gap-2">
        {nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              className={[
                'flex cursor-pointer items-center gap-2 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs',
                'transition-colors hover:bg-red-50',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1',
                selected === n.id ? 'ring-2 ring-slate-900 ring-offset-1' : '',
              ].join(' ')}
            >
              <StatusIcon status={n.status} className={STATUS_TEXT[n.status]} />
              <span className="text-slate-700">{n.title}</span>
              <code className="font-mono text-[10px] text-red-400">{n.id}</code>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── 图例 ─────────────────────────────────────────────────── */

/**
 * 图例。⚠️ 不是装饰 —— 这套视觉系统有【三条独立通道】，
 * 不解释的话用户看不出"虚线边框"和"点线边框"的区别。
 */
function Legend() {
  return (
    <div className="sticky bottom-4 left-4 z-10 ml-4 mb-4 w-fit rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 text-[10px] shadow-sm backdrop-blur">
      <p className="mb-1.5 font-semibold text-slate-500">状态 · 颜色 + 形状</p>
      <ul className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {ALL_STATUSES.map((s) => (
          <li key={s} className="flex items-center gap-1">
            <StatusIcon status={s} className={STATUS_TEXT[s]} />
            <span className="text-slate-600">{s}</span>
          </li>
        ))}
      </ul>

      <p className="mb-1.5 font-semibold text-slate-500">归属 · 边框线型</p>
      <ul className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {ALL_ASSIGNEES.map((a) => (
          <li key={a} className="flex items-center gap-1">
            <span
              className={`inline-block h-3 w-4 rounded-sm border-2 border-slate-500 ${ASSIGNEE_BORDER_STYLE[a]}`}
            />
            <span className="text-slate-600">{ASSIGNEE_LABEL[a]}</span>
          </li>
        ))}
      </ul>

      {/* ⚑ 这一条是【必须】的，不是补充说明。
          用户很自然地会以为"排在上面的先做"，但那是错的 ——
          执行顺序由依赖线决定，跟位置无关。
          不解释这两种线，用户就会照位置去理解，然后理解错。 */}
      <p className="mb-1.5 font-semibold text-slate-500">连线 · 两种含义</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        <li className="flex items-center gap-1">
          <LineSwatch />
          <span className="text-slate-600">父子 · 归在哪一类</span>
        </li>
        <li className="flex items-center gap-1">
          <LineSwatch dashed />
          <span className="text-slate-600">依赖 · 必须先做完</span>
        </li>
      </ul>
    </div>
  )
}

/**
 * 图例里的小线段。
 *
 * ⚑ 图例不是装饰 —— 这套视觉系统现在有【四条独立通道】
 *   （颜色+形状、边框线型、审批 chip、连线线型），
 *   少解释一条，那条通道就等于白设计了。
 */
function LineSwatch({ dashed = false }: { dashed?: boolean }) {
  return (
    <svg width="22" height="8" aria-hidden className="shrink-0">
      <path
        d="M 0 4 H 22"
        fill="none"
        strokeWidth={1.5}
        className={dashed ? 'stroke-slate-500' : 'stroke-slate-300'}
        strokeDasharray={dashed ? '5 4' : undefined}
      />
    </svg>
  )
}
