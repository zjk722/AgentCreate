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
import { DEFAULT_LAYOUT, layout } from '../../lib/layout'
import { buildTree } from '../../lib/outline'
import type { OutlineNode, StructureIssue } from '../../types/outline'
import { DetailPanel } from './DetailPanel'
import { GraphEdge } from './GraphEdge'
import { GraphNode } from './GraphNode'
import { ASSIGNEE_BORDER_STYLE, ASSIGNEE_LABEL, STATUS_TEXT } from './styles'
import { StatusIcon } from './StatusIcon'
import type { Assignee, NodeStatus } from '../../types/outline'

const ALL_STATUSES: NodeStatus[] = ['todo', 'running', 'done', 'failed', 'skipped']
const ALL_ASSIGNEES: Assignee[] = ['agent', 'user', 'blocked']

export function TaskGraph({ outline }: { outline: OutlineNode[] }) {
  const [selected, setSelected] = useState<string | null>(null)

  // 结构重建（D2）→ 坐标计算（D3）。两者都是纯函数，用 useMemo 缓存，
  // 免得每次 hover/选中都重算一遍布局。
  const built = useMemo(() => buildTree(outline), [outline])
  const positioned = useMemo(() => layout(built.roots, DEFAULT_LAYOUT), [built.roots])

  const selectedNode = selected
    ? (outline.find((n) => n.id === selected) ?? null)
    : null

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
          {positioned.edges.map((e) => (
            <GraphEdge key={`${e.from.id}-${e.to.id}`} from={e.from} to={e.to} opts={DEFAULT_LAYOUT} />
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
          />
        ))}
      </div>

      {built.detached.length > 0 && <DetachedStrip nodes={built.detached} />}

      <Legend />

      {selectedNode && (
        <DetailPanel node={selectedNode} onClose={() => setSelected(null)} />
      )}
    </main>
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
function DetachedStrip({ nodes }: { nodes: OutlineNode[] }) {
  return (
    <section className="mx-4 mb-4 rounded-lg border-2 border-dashed border-red-200 bg-red-50/50 p-3">
      <h2 className="mb-2 text-xs font-semibold text-red-700">
        游离节点 · {nodes.length} 个（未能挂到主树上，已保留而非丢弃）
      </h2>
      <ul className="flex flex-wrap gap-2">
        {nodes.map((n) => (
          <li
            key={n.id}
            className="flex items-center gap-2 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <StatusIcon status={n.status} className={STATUS_TEXT[n.status]} />
            <span className="text-slate-700">{n.title}</span>
            <code className="font-mono text-[10px] text-red-400">{n.id}</code>
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
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {ALL_ASSIGNEES.map((a) => (
          <li key={a} className="flex items-center gap-1">
            <span
              className={`inline-block h-3 w-4 rounded-sm border-2 border-slate-500 ${ASSIGNEE_BORDER_STYLE[a]}`}
            />
            <span className="text-slate-600">{ASSIGNEE_LABEL[a]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
