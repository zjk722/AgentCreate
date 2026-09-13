/**
 * 依赖连线 —— 「谁必须先做完，谁才能开始」。
 *
 * ⚑ 它和父子连线是**两件完全不同的事**，所以长得也不一样：
 *
 *     父子线（实线、无箭头）  图**长什么样** —— 归到哪一类
 *     依赖线（虚线、带箭头）  谁**必须先做** —— 执行顺序
 *
 *   ⚠️ 这个区分是这张图能不能信的关键。用户很自然地会以为"排在上面的先做"，
 *      但那是错的 —— 调度器只看 `depends_on`（§5.2 的拓扑排序）。
 *      不把依赖画出来，图就在骗人。
 *
 * ── 箭头指向哪边 ────────────────────────────────────────────
 *
 *   从【先做的】指向【要等的】。
 *
 *   `支付.depends_on = ['下订单']` 画成： 下订单 ───▶ 支付
 *
 *   读作「下订单必须先完成，支付才能开始」—— 和说人话的顺序一致。
 *
 * ⚑ 几何计算在 ./dependencyRoute.ts，不在这个文件里 ——
 *   一是为了能被测试直接验，二是那个文件只导出普通函数，
 *   这个文件只导出组件（混在一起会让热更新失效）。
 */
import type { CSSProperties } from 'react'
import type { LayoutOptions, PositionedNode } from '../../lib/layout'
import { dependencyRoute, pathOf } from './dependencyRoute'
import { ENTER_STAGGER_MS } from './styles'

export function DependencyEdge({
  from,
  to,
  detour,
  opts,
}: {
  from: PositionedNode
  to: PositionedNode
  /** 中间夹着别的卡片吗？夹着的话得从旁边绕（见 ./dependencyRoute.ts） */
  detour: boolean
  opts: LayoutOptions
}) {
  return (
    <path
      d={pathOf(dependencyRoute(from, to, detour, opts))}
      fill="none"
      // ⚠️ 虚线用的是 stroke-dasharray，而父子线的"生长"动画也用这个属性 ——
      //    两者会打架，所以依赖线【不能】用那套描线动画，改成淡入。
      //    （见 index.css 里 .dep-edge-enter 的说明）
      className="dep-edge-enter stroke-slate-500"
      strokeWidth={1.5}
      strokeDasharray="5 4"
      markerEnd="url(#dep-arrow)"
      // 和"要等的那个节点"同时出场 —— 它出现的时候，说明约束出现了
      style={{ '--enter-delay': `${to.depth * ENTER_STAGGER_MS}ms` } as CSSProperties}
    />
  )
}
