/**
 * 父子连线。
 *
 * 因为选了【左右布局】，边是水平的：从父节点的【右边缘】连到子节点的【左边缘】。
 *
 * 为什么用三次贝塞尔而不是直线：
 *   直线在"父节点有多个孩子、且孩子纵向跨度很大"时会斜得很陡，
 *   视觉上和别的边交叉成一团。贝塞尔的控制点都放在水平方向上
 *   （`C x1+d y1, x2-d y2`），曲线就永远是"先平着出去、再平着进来"，
 *   这是树形图最常见的观感，也最不容易误读成别的连接关系。
 */
import type { CSSProperties } from 'react'
import type { LayoutOptions, PositionedNode } from '../../lib/layout'
import { ENTER_STAGGER_MS } from './styles'

export function GraphEdge({
  from,
  to,
  opts,
}: {
  from: PositionedNode
  to: PositionedNode
  opts: LayoutOptions
}) {
  const x1 = from.x + opts.nodeWidth / 2
  const y1 = from.y
  const x2 = to.x - opts.nodeWidth / 2
  const y2 = to.y

  // 控制点水平偏移取两点水平距离的一半 —— 保证曲线在两端都是水平的
  const d = (x2 - x1) / 2
  const path = `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`

  return (
    <path
      d={path}
      fill="none"
      // 线条颜色保持中性：它表达的是"结构连接"，
      // 不该去抢节点边框（status/assignee）的信息
      className="edge-enter stroke-slate-300"
      strokeWidth={1.5}
      // ⚑ pathLength={1} 是这里的关键：它把这条线的"长度"重新定义为 1。
      //   于是下面做"描线"动画时可以直接用 1 和 0，
      //   不必去问浏览器"这条曲线到底有多长"。
      //
      //   ⚠️ 为什么不能去问：问长度得读真实页面上的元素，
      //      浏览器为了给出准确答案，会【立刻停下手上所有活，
      //      先把整页位置重新算一遍】。十几个节点各问一次，
      //      就是十几次强制重算 —— 这是前端卡顿最常见的来源之一。
      pathLength={1}
      // 一段实线画满整条（1），后面接同样长的一段空白（1）。
      // 配合 pathLength 归一化，就等于"整条线"。
      strokeDasharray={1}
      // 平时偏移 0 = 整条线都在。动画会从偏移 1（全空）拉回到 0（全满），
      // 看上去就是有人一路把线描了出来。
      strokeDashoffset={0}
      // 连线跟它的【子】节点同时出场、路上更快（240ms 对 320ms），
      // 所以线先到位、节点再落上去。
      // 反过来的话，会看到卡片悬在一根还没连到它的线前面。
      style={{ '--enter-delay': `${to.depth * ENTER_STAGGER_MS}ms` } as CSSProperties}
    />
  )
}
