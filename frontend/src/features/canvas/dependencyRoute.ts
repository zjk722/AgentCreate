/**
 * 依赖连线的几何 —— 纯函数，不依赖 React。
 *
 * ⚑ 为什么和组件分开放：
 *   一是**能被测试直接验**。这里做的判断（绕道要绕到卡片外面去）
 *   光看渲染结果很难发现错 —— 线从卡片背后穿过去，画面上只是"少了半截"，
 *   不报错也不崩。
 *   二是**热更新**：一个文件里既导出组件又导出普通函数的话，
 *   开发时改一下就要整页刷新，没法只换那一个组件。
 */
import type { LayoutOptions, PositionedNode } from '../../lib/layout'

/** 直线走法往旁边拱多少（取两点距离的一部分） */
const BOW_RATIO = 0.18
const BOW_MAX = 48

/** 绕道走法里，转角画多圆 */
const CORNER_R = 8

/** 绕道时离卡片左边缘多远（按层间隙的比例算，保证落在走廊中间） */
const DETOUR_GAP_RATIO = 0.75

export interface Point {
  x: number
  y: number
}

export type DependencyRoute =
  /** 直连：稍微拱一下的两点曲线 */
  | { kind: 'direct'; a: Point; b: Point; bow: number }
  /** 绕道：从卡片左边的空隙兜一圈 */
  | { kind: 'bracket'; a: Point; b: Point; bend: number }

/**
 * 算出这条线怎么走。
 *
 * ── 两种走法 ────────────────────────────────────────────────
 *
 *   直线（`direct`）：两点之间没有别的东西挡着，直接连过去，稍微拱一点。
 *
 *   绕道（`bracket`）：两点在**同一列**、中间还夹着别的卡片时，直线会从
 *   那张卡片【身上穿过去】—— 而"拱一下"最多只能拱半个卡片宽（84px），
 *   绕不开。所以改成从卡片【左边的空隙】绕：那里是层与层之间天然留着的
 *   走廊，永远没有卡片。形状像一个方括号。
 */
export function dependencyRoute(
  from: PositionedNode,
  to: PositionedNode,
  detour: boolean,
  opts: LayoutOptions,
): DependencyRoute {
  if (!detour) {
    const a = edgePoint(from, to, opts)
    const b = edgePoint(to, from, opts)
    const bow = Math.min(Math.hypot(b.x - a.x, b.y - a.y) * BOW_RATIO, BOW_MAX)
    return { kind: 'direct', a, b, bow }
  }

  // 绕道：从两张卡片的【左边缘】出发，走到左边的走廊再折回来。
  // 两端都取左边缘，方括号才是正的、不会歪。
  const a = { x: from.x - opts.nodeWidth / 2, y: from.y }
  const b = { x: to.x - opts.nodeWidth / 2, y: to.y }

  // ⚠️ 夹一个下限：最左边那一列（深度 0）的左边已经没有走廊了，
  //    再往外就跑到画布外面去。宁可绕得窄一点，也不要画到看不到的地方。
  const bend = Math.max(a.x - opts.gapX * DETOUR_GAP_RATIO, CORNER_R)

  return { kind: 'bracket', a, b, bend }
}

/**
 * 把走法变成 SVG 的路径字符串。
 *
 * ⚑ 绕道那段是【先横着走出去，再竖着走，再横着走回来】，不是一条斜线 ——
 *   斜线会从中间那些卡片身上穿过去。而且最后一段一定是【水平向右】
 *   进入目标卡片，所以箭头指得也对。
 */
export function pathOf(r: DependencyRoute): string {
  if (r.kind === 'direct') {
    const { a, b, bow } = r
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    // 垂直于连线方向的单位向量 —— 用它把中间两个控制点推出去，形成弧线
    const nx = -dy / len
    const ny = dx / len

    return [
      `M ${a.x} ${a.y}`,
      `C ${a.x + dx * 0.25 + nx * bow} ${a.y + dy * 0.25 + ny * bow},`,
      `${a.x + dx * 0.75 + nx * bow} ${a.y + dy * 0.75 + ny * bow},`,
      `${b.x} ${b.y}`,
    ].join(' ')
  }

  const { a, b, bend } = r
  const dir = b.y >= a.y ? 1 : -1

  // 转角半径要夹住：两点挨得太近时，半径超过一半就会把线段"吃掉"，
  // 曲线会翻过头、看起来像打了个结。
  const rad = Math.min(CORNER_R, Math.abs(b.y - a.y) / 2, Math.abs(a.x - bend) / 2)

  return [
    `M ${a.x} ${a.y}`,
    `L ${bend + rad} ${a.y}`,
    `Q ${bend} ${a.y} ${bend} ${a.y + rad * dir}`,
    `L ${bend} ${b.y - rad * dir}`,
    `Q ${bend} ${b.y} ${bend + rad} ${b.y}`,
    `L ${b.x} ${b.y}`,
  ].join(' ')
}

/**
 * 从节点中心朝目标方向走，看先撞到卡片的哪条边。
 *
 * ⚑ 为什么要算这个，不直接从中心连到中心：
 *   那样线会从卡片【里面】穿过去，箭头扎在标题上。
 *   得让线停在卡片的边缘。
 *
 * 做法：把"中心 → 中心"这个方向拉长，看什么时候刚好碰到盒子的边。
 * 左右两边能拉到 `半个宽 / 横向分量`，上下能拉到 `半个高 / 纵向分量`，
 * 谁先到就用谁 —— 那个方向就是先撞上的那条边。
 */
function edgePoint(n: PositionedNode, towards: PositionedNode, opts: LayoutOptions): Point {
  const dx = towards.x - n.x
  const dy = towards.y - n.y

  const t = Math.min(
    dx === 0 ? Infinity : opts.nodeWidth / 2 / Math.abs(dx),
    dy === 0 ? Infinity : opts.nodeHeight / 2 / Math.abs(dy),
  )

  // 两个中心重合的退化情况（理论上不会发生）—— 直接返回中心，别算出 NaN
  if (!Number.isFinite(t)) return { x: n.x, y: n.y }

  return { x: n.x + dx * t, y: n.y + dy * t }
}
