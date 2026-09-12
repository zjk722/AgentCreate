/**
 * 选中节点的详情面板 —— 证据链落地处 + 单节点操作入口。
 *
 * ⚑ 证据链为什么重要（§1.3 卖点 #3）：
 *   这里不是"显示一下模型说了什么"，而是显示【模型凭什么说做完了】：
 *   哪个工具、什么参数、耗时多久、原始调用记录在哪（result_ref 可回溯审计日志）。
 *
 * ⚑ 操作入口为什么放在这里：用户在图上看到的异常（紫色的被否决、
 *   灰色的待办），点一下就能就地处理 —— 不必回到对话框里找那一条。
 */
import { displayState } from '../../lib/outline'
import type { NodeAction } from '../../lib/simulation'
import type { OutlineNode } from '../../types/outline'
import { ASSIGNEE_LABEL, STATUS_LABEL, approvalChip } from './styles'

export function DetailPanel({
  node,
  onClose,
  onAction,
}: {
  node: OutlineNode
  onClose: () => void
  onAction: (nodeId: string, action: NodeAction) => void
}) {
  const state = displayState(node)
  const chip = approvalChip(node.approval)

  // 哪些操作对【这一个】节点可用。
  // ⚠️ 手动完成只开放给 user / blocked —— Agent 该做的任务不能被人顶掉，
  //   否则"Agent 有没有真做完"这个最关键的信息就被污染了。
  const canComplete = node.status !== 'done' && node.assignee !== 'agent'
  const canDecide = node.approval?.status === 'pending'

  return (
    <aside className="absolute top-4 right-4 z-10 w-80 rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
      <header className="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold break-words text-slate-800">{node.title}</h2>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{node.id}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="-mt-1 shrink-0 cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* ── 可执行的操作 ─────────────────────────────────── */}
      {(canDecide || canComplete) && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          {canDecide && (
            <>
              <button
                type="button"
                onClick={() => onAction(node.id, 'approve')}
                className="cursor-pointer rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-slate-700"
              >
                批准
              </button>
              <button
                type="button"
                onClick={() => onAction(node.id, 'reject')}
                className="cursor-pointer rounded border border-rejected/30 bg-white px-2.5 py-1 text-[11px] font-medium text-rejected transition-colors hover:bg-rejected-soft"
              >
                否决
              </button>
            </>
          )}
          {canComplete && (
            <button
              type="button"
              onClick={() => onAction(node.id, 'complete')}
              className="cursor-pointer rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              标记已完成
            </button>
          )}
        </div>
      )}

      {/* ── 产出 ──────────────────────────────────────────
       * ⚑ 放在最前面：用户点开一个节点，最想知道的是「它查到了什么」，
       *   而不是它的状态机处于哪一格。 */}
      {node.result_summary && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500">
            产出
          </h3>
          <p className="text-xs leading-relaxed text-slate-700">{node.result_summary}</p>
          <p className="mt-1.5 text-[10px] text-slate-400">
            完整输出见审计记录
            {node.evidence?.result_ref && (
              <code className="ml-1 rounded bg-slate-200/70 px-1 font-mono">
                {node.evidence.result_ref}
              </code>
            )}
          </p>
        </div>
      )}

      <dl className="space-y-2 px-4 py-3 text-xs">
        <Row label="状态">
          {STATUS_LABEL[node.status]}
          {state !== node.status && (
            <span className="ml-1 text-slate-400">
              （展示为 {state === 'awaiting_confirmation' ? '待确认' : '已被否决'}）
            </span>
          )}
        </Row>
        <Row label="归属">{ASSIGNEE_LABEL[node.assignee]}</Row>

        {node.assignee_reason && <Row label="原因">{node.assignee_reason}</Row>}

        {chip && <Row label="审批">{chip.label}</Row>}

        {node.approval?.status === 'approved' && <Row label="审批">已批准</Row>}

        {node.locked && <Row label="锁定">已被人工改过，AI 不会覆盖</Row>}

        {node.depends_on.length > 0 && (
          <Row label="依赖">
            <span className="font-mono text-[10px]">{node.depends_on.join(', ')}</span>
          </Row>
        )}

        {node.source_span && node.source_span.length > 0 && (
          <Row label="溯源">
            原文第 {node.source_span.map(([s, e]) => `${s}–${e}`).join('、')} 字符
          </Row>
        )}
      </dl>

      <EvidenceBlock node={node} />
    </aside>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-12 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-slate-700">{children}</dd>
    </div>
  )
}

/** 证据区块 —— 这是整个面板的重点。 */
function EvidenceBlock({ node }: { node: OutlineNode }) {
  if (!node.evidence) {
    // ⚑ 一个 done 却没有证据，是必须显式暴露的异常（§7.3 E_MISSING_EVIDENCE）。
    //
    //    ⚠️ 但只对【Agent 完成】的任务报警。这条规则的存在理由是
    //    「不信任模型的自我报告」（§5.2 证据链规则）—— 人勾的完成
    //    由人负责，不需要工具调用记录背书。不加这个限定，
    //    用户自己办完的事会被误报成"缺少证据链"。
    if (node.status === 'done' && node.assignee === 'agent') {
      return (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-700">
            <span className="font-semibold">缺少证据链。</span>
            <br />
            这个节点是 Agent 标记的「已完成」，却没有工具调用记录。按 §7.3 的
            <code className="mx-0.5 rounded bg-red-100 px-1">E_MISSING_EVIDENCE</code>
            规则，它应当被降级为 failed。
          </p>
        </div>
      )
    }
    return null
  }

  const e = node.evidence
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">执行证据</h3>
      <dl className="space-y-2 text-xs">
        <Row label="工具">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{e.tool}</code>
        </Row>
        <Row label="参数">
          <pre className="overflow-x-auto rounded bg-slate-50 p-1.5 font-mono text-[10px] leading-relaxed text-slate-600">
            {JSON.stringify(e.args, null, 2)}
          </pre>
        </Row>
        <Row label="耗时">
          <span className="tabular-nums">{e.elapsed_ms}ms</span>
        </Row>
        <Row label="记录">
          <span className="font-mono text-[10px] text-slate-500">{e.result_ref}</span>
        </Row>
        {e.verified_at && (
          <Row label="校验">
            <span className="tabular-nums text-slate-500">{e.verified_at}</span>
          </Row>
        )}
      </dl>
    </div>
  )
}
