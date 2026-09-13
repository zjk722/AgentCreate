/**
 * 依赖连线的几何。
 *
 * ⚑ 为什么这些测试非写不可：
 *
 *   一条线从卡片【背后穿过去】，画面上只是"少了半截"——
 *   不报错、不崩溃、控制台干干净净。**光看渲染结果几乎发现不了。**
 *
 * ⚑ 而且这里有个测试写法上的坑，我第一版就踩了：
 *
 *   断言"转折点的坐标出现在路径字符串里"是**没用的** ——
 *   贝塞尔的控制点也会出现在路径字符串里，
 *   所以就算曲线根本没拐到位，那条断言照样绿。
 *
 *   真正要验的是【曲线本身走到了哪里】。所以下面写了个路径采样器：
 *   把 M / L / Q / C 都展开成一条点列，再去问"这些点有没有落进某张卡片"。
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, dependencyPairs, layout, type PositionedNode } from '../../lib/layout'
import { buildTree } from '../../lib/outline'
import { datasets } from '../../mocks'
import { node } from '../../mocks/_helper'
import { DependencyEdge } from './DependencyEdge'
import { dependencyRoute } from './dependencyRoute'

const W = DEFAULT_LAYOUT.nodeWidth
const H = DEFAULT_LAYOUT.nodeHeight

interface Point {
  x: number
  y: number
}

/** 手工造一个定位好的节点 —— 不经过 layout，坐标一眼可读 */
function at(id: string, x: number, y: number, depth = 0): PositionedNode {
  return { id, x, y, depth, data: node(id, null, 0, id) }
}

/** 渲染出来，把 path 的 d 属性抠出来 */
function pathD(from: PositionedNode, to: PositionedNode, detour: boolean): string {
  const html = renderToString(
    <svg>
      <DependencyEdge from={from} to={to} detour={detour} opts={DEFAULT_LAYOUT} />
    </svg>,
  )
  return html.match(/ d="([^"]+)"/)?.[1] ?? ''
}

/* ── 路径采样器 ─────────────────────────────────────────────
 *
 * ⚑ 把 SVG 路径展开成一串点，才能问出"这条线到底经过了哪里"。
 *   只支持这个项目用到的那几种指令（M / L / Q / C）。
 */
const PER_SEGMENT = 24

function samplePath(d: string): Point[] {
  const pts: Point[] = []
  let cur: Point = { x: 0, y: 0 }

  const re = /([MLQC])([^MLQC]*)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(d)) !== null) {
    const op = m[1]
    const nums = m[2].split(/[\s,]+/).filter(Boolean).map(Number)

    if (op === 'M' || op === 'L') {
      for (let i = 0; i < nums.length; i += 2) {
        cur = { x: nums[i], y: nums[i + 1] }
        pts.push(cur)
      }
      continue
    }

    const a = cur
    const c1 = { x: nums[0], y: nums[1] }
    const end = op === 'Q' ? { x: nums[2], y: nums[3] } : { x: nums[4], y: nums[5] }
    const c2 = op === 'Q' ? c1 : { x: nums[2], y: nums[3] }

    for (let i = 1; i <= PER_SEGMENT; i++) {
      const t = i / PER_SEGMENT
      const u = 1 - t
      pts.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
      })
    }
    cur = end
  }

  return pts
}

/** 这条线有没有从这张卡片身上压过去？ */
function passesThrough(pts: Point[], card: PositionedNode): boolean {
  return pts.some(
    (p) => Math.abs(p.x - card.x) < W / 2 && Math.abs(p.y - card.y) < H / 2,
  )
}

describe('dependencyRoute · 直连', () => {
  const from = at('a', 300, 100)
  const to = at('b', 300, 300)

  it('两端都停在卡片【边缘】上，不是中心 —— 否则线会从卡片里面穿过去', () => {
    const route = dependencyRoute(from, to, false, DEFAULT_LAYOUT)
    expect(route.kind).toBe('direct')
    if (route.kind !== 'direct') return
    // 同 x 的一上一下：起点应该在上卡片的下边缘，终点在下卡片的上边缘
    expect(route.a.y).toBeCloseTo(100 + H / 2)
    expect(route.b.y).toBeCloseTo(300 - H / 2)
    expect(route.a.x).toBe(300)
  })

  it('不穿过源卡片和目标卡片本身', () => {
    const pts = samplePath(pathD(from, to, false))
    expect(passesThrough(pts, from)).toBe(false)
    expect(passesThrough(pts, to)).toBe(false)
  })
})

describe('dependencyRoute · 绕道', () => {
  const from = at('a', 300, 100)
  const to = at('b', 300, 400)
  /** 夹在中间的那张卡片 */
  const mid = at('mid', 300, 250)

  it('⚑ 转折点落在卡片【左边缘之外】—— 这才是"绕开"的含义', () => {
    const route = dependencyRoute(from, to, true, DEFAULT_LAYOUT)
    expect(route.kind).toBe('bracket')
    if (route.kind !== 'bracket') return
    expect(route.bend).toBeLessThan(300 - W / 2)
  })

  it('⚑⚑ 绕道之后，线确实不再压到中间那张卡片上', () => {
    const pts = samplePath(pathD(from, to, true))
    expect(
      passesThrough(pts, mid),
      '线还是从中间卡片身上穿过去了 —— 这正是绕道要解决的问题',
    ).toBe(false)
  })

  it('⚑ 最后一段是【水平向右】进入目标卡片，箭头才指得对', () => {
    const route = dependencyRoute(from, to, true, DEFAULT_LAYOUT)
    if (route.kind !== 'bracket') return
    // 路径以 "L <目标左边缘x> <目标y>" 结尾
    expect(pathD(from, to, true).endsWith(`L ${route.b.x} ${route.b.y}`)).toBe(true)
    // 而且是从左边过来的
    expect(route.b.x).toBeGreaterThan(route.bend)
  })

  it('方向朝上时同样成立（不能只处理"从上往下"）', () => {
    const pts = samplePath(pathD(to, from, true))
    expect(passesThrough(pts, mid)).toBe(false)
  })

  it('两点挨得很近时不会把曲线绕成结', () => {
    const near = at('c', 300, 100)
    const nearTo = at('d', 300, 104)
    const d = pathD(near, nearTo, true)
    // NaN 会让整条线凭空消失，而且不报错
    expect(d).not.toContain('NaN')
    expect(samplePath(d).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('⚑ 最左边那一列不会把线绕到画布外面去', () => {
    const leftmost = at('e', W / 2 + 32, 100, 0)
    const leftmostTo = at('f', W / 2 + 32, 300, 0)
    const route = dependencyRoute(leftmost, leftmostTo, true, DEFAULT_LAYOUT)
    if (route.kind !== 'bracket') return
    expect(route.bend).toBeGreaterThan(0)
  })
})

/* ── 在真实数据上验：所有依赖线都不能穿过任何卡片 ──────────── */

/**
 * ⚑ 这是这个文件里最值钱的一条。
 *
 *   前面那些用手工坐标的用例，只能覆盖我想得到的情况。
 *   而"哪两个节点之间正好夹着卡片"完全取决于真实布局 ——
 *   是实测（不是猜）发现 japan 数据集 3 条依赖里有 2 条穿卡。
 *
 *   所以这里把所有 mock 数据集的所有依赖线都采样一遍，
 *   逐条问："你有没有从任何一张卡片身上压过去？"
 */
describe('依赖线 · 真实数据集上不允许穿卡', () => {
  for (const d of datasets) {
    it(`「${d.label}」的每条依赖线都不穿过任何卡片`, () => {
      const positioned = layout(buildTree(d.outline).roots, DEFAULT_LAYOUT)
      const pairs = dependencyPairs(d.outline, positioned.nodes)

      for (const pair of pairs) {
        const pts = samplePath(pathD(pair.from, pair.to, pair.detour))
        const label = `${pair.from.data.title} → ${pair.to.data.title}`

        // 除了两端自己，其他卡片一张都不能压到
        for (const card of positioned.nodes) {
          if (card.id === pair.from.id || card.id === pair.to.id) continue
          expect(
            passesThrough(pts, card),
            `「${label}」从卡片「${card.data.title}」身上穿过去了`,
          ).toBe(false)
        }
      }
    })
  }
})
