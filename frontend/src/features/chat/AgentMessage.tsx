/**
 * Agent 的汇报卡片 —— 对话区里 Agent 说的"话"。
 *
 * ⚑ 这张卡片里【没有一个字是手写的文案】，全部来自 `summarize(outline)`。
 *   这样 A0/A6 真做起来时它不用重写：数据换真了，卡片照旧。
 *
 * ⚑ 它承担 §5.1 第 ③ 步「用户确认」和 §5.2「部分成功的呈现」：
 *
 *     我将执行 3 项，5 项需要你  ← 可调整
 *
 *   注意它【不显示思考过程】。显示的是三件可验证的事：
 *     · 完成度 —— 数出来的
 *     · 主要问题 —— §7.1 的 issue，带 code
 *     · 需要你做的 + 原因 —— assignee_reason 枚举翻译来的
 */
import type { Assignee, StructureIssue } from '../../types/outline'
import { reasonText } from '../../lib/reasons'
import type { MapSummary, PendingTodo } from '../../lib/summary'
import { ASSIGNEE_BORDER_STYLE } from '../canvas/styles'

/** 与画布共用同一套线型语言，让"虚线 = 归你"在这里也成立 */
const TONE: Record<
  'user' | 'blocked' | 'approval',
  { border: Assignee | null; title: string; dot: string }
> = {
  user: { border: 'user', title: '需要你做', dot: 'border-slate-500' },
  blocked: { border: 'blocked', title: '卡住了', dot: 'border-red-400' },
  approval: { border: null, title: '等你点头', dot: 'border-amber-400' },
}

export function AgentMessage({
  summary,
  onConfirm,
  onApproveAll,
  onMarkUserDone,
  canConfirm,
}: {
  summary: MapSummary
  onConfirm: () => void
  onApproveAll: () => void
  onMarkUserDone: () => void
  canConfirm: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* ── 结论 + 完成度 ────────────────────────────────── */}
      <header className="border-b border-slate-100 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-slate-700">{summary.headline}</p>
        {summary.total > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  summary.verdict === 'blocked' ? 'bg-red-400' : 'bg-done'
                }`}
                style={{ width: `${Math.round(summary.progress * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
              {summary.byStatus.done}/{summary.total}
            </span>
          </div>
        )}
      </header>

      <div className="space-y-2.5 px-3 py-2.5">
        <TodoGroup tone="user" todos={summary.userTodos} />
        <TodoGroup tone="blocked" todos={summary.blockers} />
        <TodoGroup tone="approval" todos={summary.awaitingApproval} />
        <ProblemList issues={summary.problems} />
      </div>

      {/* ── 可执行的下一步 ────────────────────────────────── */}
      <footer className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2.5">
        {canConfirm && (
          <Action onClick={onConfirm} primary>
            确认并开始执行
          </Action>
        )}
        {summary.awaitingApproval.length > 0 && (
          <Action onClick={onApproveAll}>
            批准 {summary.awaitingApproval.length} 项待确认
          </Action>
        )}
        {summary.userTodos.length > 0 && (
          <Action onClick={onMarkUserDone}>
            标记「需要你做」已完成
          </Action>
        )}
      </footer>
    </div>
  )
}

/* ── 分组列表 ─────────────────────────────────────────────── */

function TodoGroup({ tone, todos }: { tone: 'user' | 'blocked' | 'approval'; todos: PendingTodo[] }) {
  if (todos.length === 0) return null
  const t = TONE[tone]

  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500">
        {t.title} · {todos.length}
      </h3>
      <ul className="space-y-1">
        {todos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} tone={tone} />
        ))}
      </ul>
    </section>
  )
}

function TodoItem({ todo, tone }: { todo: PendingTodo; tone: 'user' | 'blocked' | 'approval' }) {
  const t = TONE[tone]
  const rt = reasonText(todo.reason)

  return (
    <li className="flex gap-1.5 text-[11px] leading-snug">
      {/* 用画布上同一套线型标记归属 —— 虚线=归你、点线=卡住 */}
      <span
        className={`mt-[3px] h-2.5 w-3 shrink-0 rounded-[2px] border-[1.5px] ${
          t.border ? ASSIGNEE_BORDER_STYLE[t.border] : 'border-dashed'
        } ${t.dot}`}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="text-slate-700">{todo.title}</span>
        {/* 原因由枚举翻译而来，顺带带上出处 —— 每句话都可追溯 */}
        {rt && <span className="text-slate-400"> — {rt.why}</span>}
        {todo.detail && (
          <code className="ml-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">
            {todo.detail}
          </code>
        )}
      </span>
    </li>
  )
}

/* ── 问题列表 ─────────────────────────────────────────────── */

function ProblemList({ issues }: { issues: StructureIssue[] }) {
  if (issues.length === 0) return null
  const errors = issues.filter((i) => i.severity === 'error')

  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500">
        主要问题 · {issues.length}
        {errors.length > 0 && <span className="ml-1 text-red-500">（{errors.length} 个阻断）</span>}
      </h3>
      <ul className="space-y-1">
        {issues.map((issue, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] leading-snug">
            <code
              className={`shrink-0 rounded px-1 font-mono text-[10px] ${
                issue.severity === 'error'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {issue.code}
            </code>
            <span className="min-w-0 text-slate-600">{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── 按钮 ─────────────────────────────────────────────────── */

function Action({
  onClick,
  children,
  primary,
}: {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
        primary
          ? 'bg-slate-900 text-white hover:bg-slate-700'
          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
