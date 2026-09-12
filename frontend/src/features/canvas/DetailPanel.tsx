/**
 * 选中节点的详情面板 —— 本 demo 的"证据链"落地处。
 *
 * ⚑ 这个面板存在的原因，是 §1.3 的卖点 #3：
 *   **每个 `done` 必须挂可验证的执行证据，杜绝"自我报告式完成"。**
 *
 *   所以这里不是"显示一下模型说了什么"，而是显示【模型凭什么说做完了】：
 *   哪个工具、什么参数、耗时多久、原始调用记录在哪（result_ref 可回溯到审计日志）。
 *
 *   没有 evidence 的 done 在界面上是"可疑"的 —— §7.3 的
 *   `E_MISSING_EVIDENCE` 规定它该被降级为 failed。
 */
import type { OutlineNode } from '../../types/outline'
import { displayState } from '../../lib/outline'
import { ASSIGNEE_LABEL, STATUS_LABEL, approvalChip } from './styles'

export function DetailPanel({
  node,
  onClose,
}: {
  node: OutlineNode
  onClose: () => void
}) {
  const state = displayState(node)
  const chip = approvalChip(node.approval)

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
    // ⚑ 一个 done 却没有证据，是【必须显式暴露】的异常（§7.3 E_MISSING_EVIDENCE）
    if (node.status === 'done') {
      return (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-700">
            <span className="font-semibold">缺少证据链。</span>
            <br />
            这个节点标记为「已完成」却没有工具调用记录。按 §7.3 的
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
