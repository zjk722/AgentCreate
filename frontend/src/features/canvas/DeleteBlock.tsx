/**
 * 删除确认块。
 *
 * ⚑ 为什么不是弹个「确定吗？」就完事 —— **那等于没确认**。
 *   用户点"确定"的时候并不知道自己在删什么：可能只删 1 个，
 *   也可能连坐 10 个；可能没人受影响，也可能有 3 个任务从此**不再等它**。
 *
 *   §5.3 给 AI 改稿定的规矩是「提案 / 应用分离」：
 *   先把「将新增 3 个节点，删除 1 个」摆出来，人点了头才应用。
 *   **人自己动手删的时候，凭什么不用看后果。**
 *
 * ⚑ 单独一个文件而不是塞在 DetailPanel 里，有个很实际的理由：
 *   它是【折叠展开】的，不点开就不渲染 —— 塞在面板里的话
 *   渲染测试根本够不着它，那上面这些警告文案就没人守着了。
 */
import { useState } from 'react'
import { deleteImpact, type DeleteMode } from '../../lib/outlineEdit'
import type { OutlineNode } from '../../types/outline'

export function DeleteBlock({
  node,
  outline,
  onDelete,
  onCancel,
}: {
  node: OutlineNode
  outline: OutlineNode[]
  onDelete: (nodeId: string, mode: DeleteMode) => void
  onCancel: () => void
}) {
  const [chosen, setChosen] = useState<DeleteMode>('promote')

  // 先探一次：能不能"上移"这件事和模式无关，探出来就够了
  const probe = deleteImpact(outline, node.id, chosen)
  if (!probe) return null

  // ⚑ 不能上移时（根节点 + 多个孩子），那个选项【根本不出现】，
  //   模式直接定死成"一起删掉"。少一个选项就少一次选错，
  //   比"灰着让你看着"干净。
  const mode: DeleteMode = probe.canPromote ? chosen : 'cascade'

  // ⚠️ 必须按【真正会执行的那个模式】重算影响 ——
  //   否则那句"有 N 个节点依赖它"是假的，用户会被误导着按下去。
  const impact = deleteImpact(outline, node.id, mode)
  if (!impact) return null

  const { descendants, children, dependents, canPromote } = impact
  const hasChildren = children.length > 0

  return (
    <div className="border-b border-slate-100 bg-red-50/50 px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold text-red-700">删除这个节点？</h3>

      {hasChildren ? (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-slate-600">
            它下面还有 <b className="tabular-nums">{descendants.length}</b> 个节点。
          </p>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-start gap-1.5 text-[11px] text-slate-700">
              <input
                type="radio"
                name={`del-${node.id}`}
                checked={mode === 'cascade'}
                onChange={() => setChosen('cascade')}
                className="mt-0.5"
              />
              <span>
                一起删掉
                <span className="text-slate-400">（共 {descendants.length + 1} 个）</span>
              </span>
            </label>

            {canPromote && (
              <label className="flex cursor-pointer items-start gap-1.5 text-[11px] text-slate-700">
                <input
                  type="radio"
                  name={`del-${node.id}`}
                  checked={mode === 'promote'}
                  onChange={() => setChosen('promote')}
                  className="mt-0.5"
                />
                <span>把它们上移一层</span>
              </label>
            )}
          </div>
        </>
      ) : (
        <p className="mb-2 text-[11px] text-slate-600">它下面没有别的节点。</p>
      )}

      {/* ⚑ 这条警告是【必须】的，不是补充说明。
          删掉一个依赖 = **在改执行顺序**。用户得知道有谁从此不再等谁 ——
          否则他下次看到那个任务先跑了，会以为 Agent 出错了。 */}
      {dependents.length > 0 && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
          有 <b className="tabular-nums">{dependents.length}</b> 个节点依赖它，删掉之后它们
          <b>不再等它</b>：
          <span className="mt-0.5 block text-amber-700">
            {dependents.map((d) => d.node.title).join('、')}
          </span>
        </p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => onDelete(node.id, mode)}
          className="cursor-pointer rounded bg-red-700 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-800"
        >
          确认删除
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          取消
        </button>
      </div>
    </div>
  )
}
