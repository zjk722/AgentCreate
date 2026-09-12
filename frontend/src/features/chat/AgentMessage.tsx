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
import type { NodeAction } from '../../lib/simulation'
import type { Assignee, StructureIssue } from '../../types/outline'
import { reasonText } from '../../lib/reasons'
import type { MapSummary, PendingTodo } from '../../lib/summary'
import { ASSIGNEE_BORDER_STYLE } from '../canvas/styles'

/**
 * 四种待办的语气。与画布共用同一套线型语言，让"虚线 = 归你"在这里也成立。
 *
 * ⚑ `failed` 排在第一位，因为它是唯一一个【需要人做判断】的组 ——
 *   其余三组都是"知道该干什么，只是还没干"。这组是"还没人决定要不要干"。
 */
type Tone = 'failed' | 'approval' | 'user' | 'blocked'

const TONE: Record<Tone, { border: Assignee | null; title: string; dot: string }> = {
  failed: { border: 'agent', title: '需要你决定', dot: 'border-red-500' },
  approval: { border: null, title: '等你点头', dot: 'border-amber-400' },
  user: { border: 'user', title: '需要你做', dot: 'border-slate-500' },
  blocked: { border: 'blocked', title: '卡住了', dot: 'border-red-400' },
}

export function AgentMessage({
  summary,
  onConfirm,
  onApproveAll,
  onMarkUserDone,
  onItemAction,
  canConfirm,
}: {
  summary: MapSummary
  onConfirm: () => void
  onApproveAll: () => void
  onMarkUserDone: () => void
  /** 对【单条】待办的操作。与画布详情面板共用同一套语义。 */
  onItemAction: (nodeId: string, action: NodeAction) => void
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
        <TodoGroup tone="failed" todos={summary.failedTasks} onItemAction={onItemAction} />
        <TodoGroup tone="approval" todos={summary.awaitingApproval} onItemAction={onItemAction} />
        <TodoGroup tone="user" todos={summary.userTodos} onItemAction={onItemAction} />
        <TodoGroup tone="blocked" todos={summary.blockers} onItemAction={onItemAction} />
        <ProblemList issues={summary.problems} />
      </div>

      {/* ── 可执行的下一步 ──────────────────────────────────
       * 逐项操作在上面每一条上了（那才是主路径）。
       * 这里只保留"一次处理多条"的快捷方式，且仅在确实多于一条时才出现 ——
       * 只有一条时它是冗余的，会让人以为两种操作有什么不同。 */}
      <footer className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2.5">
        {canConfirm && (
          <Action onClick={onConfirm} primary>
            确认并开始执行
          </Action>
        )}
        {summary.awaitingApproval.length > 1 && (
          <Action onClick={onApproveAll}>全部批准（{summary.awaitingApproval.length}）</Action>
        )}
        {summary.userTodos.length > 1 && (
          <Action onClick={onMarkUserDone}>全部标记完成（{summary.userTodos.length}）</Action>
        )}
      </footer>
    </div>
  )
}

/* ── 分组列表 ─────────────────────────────────────────────── */

function TodoGroup({
  tone,
  todos,
  onItemAction,
}: {
  tone: Tone
  todos: PendingTodo[]
  onItemAction: (nodeId: string, action: NodeAction) => void
}) {
  if (todos.length === 0) return null
  const t = TONE[tone]

  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500">
        {t.title} · {todos.length}
      </h3>
      <ul className="space-y-1">
        {todos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} tone={tone} onAction={onItemAction} />
        ))}
      </ul>
    </section>
  )
}

function TodoItem({
  todo,
  tone,
  onAction,
}: {
  todo: PendingTodo
  tone: Tone
  onAction: (nodeId: string, action: NodeAction) => void
}) {
  const t = TONE[tone]
  const rt = reasonText(todo.reason)

  return (
    <li className="flex items-start gap-1.5 text-[11px] leading-snug">
      {/* 用画布上同一套线型标记归属 —— 虚线=归你、点线=卡住、实线=Agent 的活 */}
      <span
        className={`mt-[3px] h-2.5 w-3 shrink-0 rounded-[2px] border-[1.5px] ${
          t.border ? ASSIGNEE_BORDER_STYLE[t.border] : 'border-dashed'
        } ${t.dot}`}
        aria-hidden
      />

      <span className="min-w-0 flex-1">
        <span className="text-slate-700">{todo.title}</span>
        {/* 原因由枚举翻译而来 —— 每句话都可追溯到文档里的一条规则 */}
        {rt && <span className="text-slate-400"> — {rt.why}</span>}
        {todo.detail && (
          <code className="ml-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">
            {todo.detail}
          </code>
        )}
      </span>

      {/* 逐条操作。
       *  ⚑ 三组各有各的两条路，而且【都必须给两条】：
       *    · 审批：批准 / 否决 —— "只能同意"不是审批，是通知
       *    · 失败：我来处理 / 不处理 —— 系统不替用户判断还值不值得做
       *    · 其余：完成 */}
      <span className="flex shrink-0 gap-1">
        {tone === 'approval' && (
          <>
            <Mini onClick={() => onAction(todo.id, 'approve')}>批准</Mini>
            <Mini onClick={() => onAction(todo.id, 'reject')} danger>
              否决
            </Mini>
          </>
        )}
        {tone === 'failed' && (
          <>
            <Mini onClick={() => onAction(todo.id, 'handle')}>我来处理</Mini>
            <Mini onClick={() => onAction(todo.id, 'discard')} danger>
              不处理
            </Mini>
          </>
        )}
        {(tone === 'user' || tone === 'blocked') && (
          <Mini onClick={() => onAction(todo.id, 'complete')}>完成</Mini>
        )}
      </span>
    </li>
  )
}

/** 行内小按钮。样式刻意低调 —— 它是"就地处事"，不该抢正文的注意力。 */
function Mini({
  onClick,
  children,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'cursor-pointer rounded border px-1.5 py-0.5 text-[10px] transition-colors',
        danger
          ? 'border-rejected/30 text-rejected hover:bg-rejected-soft'
          : 'border-slate-200 text-slate-500 hover:bg-slate-100',
      ].join(' ')}
    >
      {children}
    </button>
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
