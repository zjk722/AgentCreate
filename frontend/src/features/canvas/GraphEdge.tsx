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
import type { LayoutOptions, PositionedNode } from '../../lib/layout'

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
      className="stroke-slate-300"
      strokeWidth={1.5}
    />
  )
}
