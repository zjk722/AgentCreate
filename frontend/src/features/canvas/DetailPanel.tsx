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
import { useState } from 'react'
import { displayState } from '../../lib/outline'
import {
  nodePath,
  possibleParents,
  siblingsOf,
  type DeleteMode,
  type DropPosition,
} from '../../lib/outlineEdit'
import type { NodeAction } from '../../lib/simulation'
import type { OutlineNode } from '../../types/outline'
import { DeleteBlock } from './DeleteBlock'
import { ASSIGNEE_LABEL, STATUS_LABEL, approvalChip } from './styles'

export function DetailPanel({
  node,
  outline,
  editable,
  attachable,
  onClose,
  onAction,
  onMove,
  onDelete,
}: {
  node: OutlineNode
  /** 整张图 —— 算"能挂到谁下面""兄弟有谁""删了会波及什么"都要用 */
  outline: OutlineNode[]
  /** 能不能改结构。和拖拽同一个闸门（§5.3：执行中禁止） */
  editable: boolean
  /**
   * 有资格当"新父亲"的节点 id —— 也就是**真正挂在主树上的那些**。
   *
   * ⚑ 为什么必须在外面算好传进来：只有 TaskGraph 手里有树（`built`）。
   *   而这条约束很要紧 —— 挂到游离节点下面只会让游离变更多，
   *   用户以为修好了其实更糟。
   */
  attachable: Set<string>
  onClose: () => void
  onAction: (nodeId: string, action: NodeAction) => void
  onMove: (draggedId: string, targetId: string, position: DropPosition) => void
  onDelete: (nodeId: string, mode: DeleteMode) => void
}) {
  const state = displayState(node)
  const chip = approvalChip(node.approval)

  // 删除块【平时是折叠的】—— 点一下才展开，展开才显示后果。
  // ⚑ 为什么不做成面板上一个常驻的红按钮：删除不可逆，
  //   常驻的红色按钮在鼠标划来划去的地方，误触成本太高。
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // 哪些操作对【这一个】节点可用。
  // ⚠️ 手动完成只开放给 user / blocked —— Agent 该做的任务不能被人顶掉，
  //   否则"Agent 有没有真做完"这个最关键的信息就被污染了。
  const canComplete = node.status !== 'done' && node.assignee !== 'agent'
  const canDecide = node.approval?.status === 'pending'
  // Agent 失败了、还没被处置 —— 等用户决定"还做不做"（§5.2 的人工分支）
  const canResolveFailure = node.status === 'failed' && node.assignee === 'agent'

  // ── 调整位置（不用拖的那条路）─────────────────────────────
  //
  // ⚑ 为什么必须有：拖拽对一部分人是**做不到**的 —— 用键盘的人、
  //   手抖的人、用屏幕阅读器的人。无障碍规范（WCAG 2.2 AA 的
  //   "dragging-alternative"）要求：凡是能拖的，都必须另有一条
  //   不用拖也能走的路。这里就是那条路。
  //
  //   而且它不只是"给少数人的补丁"——两个一模一样的下拉选项里挑一个，
  //   比用鼠标把卡片拖到 16px 的缝里，对**所有人**都更好用。
  // ⚑ 两层过滤，各挡一种"越修越坏"：
  //   ① possibleParents 排除自己 + 自己的后代 —— 否则会成环
  //   ② attachable 排除游离节点 —— 否则挂上去还是游离（只是换了个地方游离）
  //      而且这条对正常节点同样重要：把好节点挂到孤儿下面 = 亲手造一个新孤儿
  const parents = possibleParents(outline, node.id).filter((p) => attachable.has(p.id))
  const siblings = siblingsOf(outline, node.parent_id)
  const myIndex = siblings.findIndex((s) => s.id === node.id)
  const canMoveUp = myIndex > 0
  const canMoveDown = myIndex >= 0 && myIndex < siblings.length - 1
  const canReorder = siblings.length > 1
  const showPlacement = editable && (parents.length > 0 || canReorder)

  return (
    /* ⚠️ 必须是 fixed 不能是 absolute。
       画布（<main>）是个滚动容器，absolute 的元素【跟着内容一起滚】——
       用户滚到最底下点一个游离节点，面板会出现在内容的最顶上，
       也就是屏幕外面。表现就是"点了没反应"。
       fixed 把它钉在视口上，不管滚到哪儿都看得见。 */
    <aside className="fixed top-4 right-4 z-20 w-80 rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
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
      {(canDecide || canComplete || canResolveFailure) && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          {canResolveFailure && (
            <>
              <button
                type="button"
                onClick={() => onAction(node.id, 'handle')}
                className="cursor-pointer rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-slate-700"
              >
                我来处理
              </button>
              <button
                type="button"
                onClick={() => onAction(node.id, 'discard')}
                className="cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                不处理
              </button>
            </>
          )}
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

      {/* ── 调整位置（不用拖的那条路）───────────────────── */}
      {showPlacement && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">
            调整位置
          </h3>

          {parents.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[10px] text-slate-400">挂在谁下面</span>
              <select
                value={node.parent_id ?? ''}
                onChange={(e) => onMove(node.id, e.target.value, 'child')}
                className="w-full cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-500 focus:outline-none"
              >
                {/* ⚑ 选项写完整路径而不是光写标题：图里出现两个「预订酒店」
                    是完全可能的，光看标题根本分不出哪个是哪个。
                    **让用户在两个一模一样的选择里猜，是界面在偷懒。** */}
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nodePath(outline, p.id)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {canReorder && (
            <div className="mt-2">
              <span className="mb-1 block text-[10px] text-slate-400">
                在同级里的位置（第 {myIndex + 1} / {siblings.length}）
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={!canMoveUp}
                  onClick={() => onMove(node.id, siblings[myIndex - 1].id, 'before')}
                  className="cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                >
                  上移
                </button>
                <button
                  type="button"
                  disabled={!canMoveDown}
                  onClick={() => onMove(node.id, siblings[myIndex + 1].id, 'after')}
                  className="cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                >
                  下移
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 删除 ────────────────────────────────────────────
       * 和「调整位置」共用同一个闸门（§5.3：执行中不许改结构）。 */}
      {editable &&
        (confirmingDelete ? (
          <DeleteBlock
            node={node}
            outline={outline}
            onDelete={onDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        ) : (
          <div className="border-b border-slate-100 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="w-full cursor-pointer rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50"
            >
              删除这个节点…
            </button>
          </div>
        ))}

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
