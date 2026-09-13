/**
 * layout() 的单元测试。
 *
 * ⚑ 为什么坐标必须用测试钉死：坐标算错【不会报错】，只是画得难看。
 *   没有断言的话，你只能靠肉眼盯着画布猜"是不是有点歪"——
 *   而 D5 加上缩放/平移之后，肉眼更不可靠。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, dependencyPairs, layout, type LayoutOptions } from './layout'
import { buildTree } from './outline'
import { datasets } from '../mocks'
import { node } from '../mocks/_helper'
import type { OutlineNode } from '../types/outline'

/** 固定的小尺寸参数，让断言里的数字可手算 */
const OPTS: LayoutOptions = {
  nodeWidth: 100,
  nodeHeight: 40,
  gapX: 50,
  gapY: 10,
  padding: 20,
}
const STEP_X = OPTS.nodeWidth + OPTS.gapX // 150：每深一层向右走的像素
const STEP_Y = OPTS.nodeHeight + OPTS.gapY // 50：每个兄弟向下走的像素

/** 从扁平数组一步到位拿到布局结果 */
function lay(flat: OutlineNode[], opts = OPTS) {
  return layout(buildTree(flat).roots, opts)
}

/* ── 退化与边界 ───────────────────────────────────────────── */

describe('layout · 退化情形', () => {
  it('空输入 → 不崩溃，且画布尺寸不为 0', () => {
    const r = layout([])
    expect(r.nodes).toEqual([])
    expect(r.edges).toEqual([])
    // ⚑ 关键：SVG 的 viewBox 拿到 0 宽高会整个消失
    expect(r.width).toBeGreaterThan(0)
    expect(r.height).toBeGreaterThan(0)
  })

  it('单节点 → 落在 padding 处，且宽高不塌成 0', () => {
    const r = lay([node('a', null, 0, '独苗')])
    expect(r.nodes).toHaveLength(1)
    expect(r.nodes[0].depth).toBe(0)
    // 存的是【中心】，所以要让出半个节点尺寸，盒子左边缘才正好在 padding 上
    expect(r.nodes[0].x).toBe(OPTS.padding + OPTS.nodeWidth / 2)
    expect(r.nodes[0].y).toBe(OPTS.padding + OPTS.nodeHeight / 2)
    // ⚑ 这是 D3 的经典坑：单节点时 d3 给 x=0,y=0，如果不加 padding
    //   和不预留节点尺寸，画布上什么都看不见
    expect(r.width).toBeGreaterThan(OPTS.nodeWidth)
    expect(r.height).toBeGreaterThan(OPTS.nodeHeight)
  })

  it('⚑ 回归：最外侧的节点盒子不能挂出画布', () => {
    // 这条断言守的是上面那个真 bug —— 曾经 x 的中心只加了 padding，
    // 导致深度 0 的节点左半边落在负坐标上（被裁掉一半）。
    const r = lay([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
    ])
    for (const n of r.nodes) {
      const left = n.x - OPTS.nodeWidth / 2
      const top = n.y - OPTS.nodeHeight / 2
      const right = n.x + OPTS.nodeWidth / 2
      const bottom = n.y + OPTS.nodeHeight / 2
      expect(left).toBeGreaterThanOrEqual(0)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(r.width)
      expect(bottom).toBeLessThanOrEqual(r.height)
    }
  })
})

/* ── 缩放：d3 的"节点单位" → 像素 ─────────────────────────── */

describe('layout · 坐标缩放', () => {
  it('同层兄弟 → x 相同，y 相差【节点高 + 兄弟间距】', () => {
    const r = lay([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('c', 'r', 2, '丙'),
    ])
    const [a, b, c] = ['a', 'b', 'c'].map((id) => r.nodes.find((n) => n.id === id)!)

    // 左右布局：同层 = 同一个 x
    expect(a.x).toBe(b.x)
    expect(b.x).toBe(c.x)

    // 兄弟间距 = stepY
    expect(b.y - a.y).toBe(STEP_Y)
    expect(c.y - b.y).toBe(STEP_Y)
  })

  it('每深一层 → x 相差【节点宽 + 层间距】', () => {
    const r = lay([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('a1', 'a', 0, '甲一'),
    ])
    const [root, a, a1] = ['r', 'a', 'a1'].map((id) => r.nodes.find((n) => n.id === id)!)

    expect(a.x - root.x).toBe(STEP_X)
    expect(a1.x - a.x).toBe(STEP_X)
    // 深度也要跟着涨 —— D4 用它决定字号/视觉重量
    expect([root.depth, a.depth, a1.depth]).toEqual([0, 1, 2])
  })

  it('depth 与 x 单调对应（左右布局的定义）', () => {
    const r = lay([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('a1', 'a', 0, '甲一'),
    ])
    const depth0 = r.nodes.filter((n) => n.depth === 0).map((n) => n.x)
    const depth1 = r.nodes.filter((n) => n.depth === 1).map((n) => n.x)
    const depth2 = r.nodes.filter((n) => n.depth === 2).map((n) => n.x)
    expect(Math.max(...depth0)).toBeLessThan(Math.min(...depth1))
    expect(Math.max(...depth1)).toBeLessThan(Math.min(...depth2))
  })
})

/* ── 不重叠（Reingold–Tilford 要保证的约束之一）───────────── */

describe('layout · 不重叠', () => {
  it('12 个兄弟 → y 两两不同，且相邻间距都等于 stepY', () => {
    const kids = Array.from({ length: 12 }, (_, i) => node(`k${i}`, 'r', i, `子 ${i}`))
    const r = lay([node('r', null, 0, '根'), ...kids])

    const ys = r.nodes
      .filter((n) => n.depth === 1)
      .map((n) => n.y)
      .sort((a, b) => a - b)

    expect(ys).toHaveLength(12)
    expect(new Set(ys).size).toBe(12) // 两两不同 = 没重叠
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBe(STEP_Y)
    }
  })

  it('不平衡的树（左 1 个叶子、右 3 个叶子）→ 两个子树不重叠', () => {
    const r = lay([
      node('r', null, 0, '根'),
      node('L', 'r', 0, '左'),
      node('R', 'r', 1, '右'),
      node('L1', 'L', 0, '左一'),
      node('R1', 'R', 0, '右一'),
      node('R2', 'R', 1, '右二'),
      node('R3', 'R', 2, '右三'),
    ])

    // 左子树占一个叶子位，"右"子树占三个 —— 它们必须在纵向分开
    const lSub = r.nodes.filter((n) => n.id === 'L' || n.id === 'L1').map((n) => n.y)
    const rSub = r.nodes
      .filter((n) => n.id.startsWith('R'))
      .map((n) => n.y)

    expect(Math.max(...lSub)).toBeLessThan(Math.min(...rSub))
  })
})

/* ── 连线 ─────────────────────────────────────────────────── */

describe('layout · 连线', () => {
  it('边数 = 节点数 − 根数', () => {
    const r = lay([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('a1', 'a', 0, '甲一'),
    ])
    expect(r.nodes).toHaveLength(4)
    expect(r.edges).toHaveLength(3) // 4 − 1 个根
  })

  it('每条边的坐标是【已平移过】的最终坐标，不是相对坐标', () => {
    const r = lay([node('r', null, 0, '根'), node('a', 'r', 0, '甲')])
    const edge = r.edges[0]
    const root = r.nodes.find((n) => n.id === 'r')!
    const a = r.nodes.find((n) => n.id === 'a')!
    // 用 toBe 比引用，确认连线用的是同一批对象（否则 D4 画出来会错位）
    expect(edge.from).toBe(root)
    expect(edge.to).toBe(a)
  })
})

/* ── 多根（坏数据） ───────────────────────────────────────── */

describe('layout · 多根', () => {
  it('两个根 → 都布局出来，且纵向不重叠', () => {
    const r = lay([
      node('r1', null, 0, '根一'),
      node('r2', null, 0, '根二'),
      node('r2a', 'r2', 0, '根二的孩子'),
    ])
    expect(r.nodes).toHaveLength(3)

    const tree1 = r.nodes.filter((n) => n.id === 'r1').map((n) => n.y)
    const tree2 = r.nodes.filter((n) => n.id.startsWith('r2')).map((n) => n.y)
    expect(Math.max(...tree1)).toBeLessThan(Math.min(...tree2))
  })
})

/* ── 默认参数下的真实性检查 ───────────────────────────────── */

describe('layout · 默认参数', () => {
  it('默认参数下每个节点都有有限的坐标（没有 NaN）', () => {
    const flat: OutlineNode[] = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('a1', 'a', 0, '甲一'),
    ]
    const r = layout(buildTree(flat).roots, DEFAULT_LAYOUT)
    for (const n of r.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
    // 单根时：宽度应当能容下最右节点 + 半个节点宽 + padding
    const maxX = Math.max(...r.nodes.map((n) => n.x))
    expect(r.width).toBeGreaterThanOrEqual(maxX)
  })

  it('节点盒子够大，能容下 12 字标题（§7.2 的 E_TITLE_TOO_LONG 上限）', () => {
    // 12 个中文字按 14px 字号约 168px 宽，加上内边距 —— 默认宽度必须 ≥ 这个数
    expect(DEFAULT_LAYOUT.nodeWidth).toBeGreaterThanOrEqual(168)
  })
})

/* ── 依赖连线 ─────────────────────────────────────────────── */

/**
 * ⚑ 这些测试守的是那件事：**`depends_on` 和 `parent_id` 是两张不同的图**。
 *
 *   拖拽只改 `parent_id` / `order`，执行顺序由 `depends_on` 决定（§5.2）。
 *   如果哪天有人"顺手"把依赖线的数据源改成层级树，这些测试会红 ——
 *   而那个改动的后果是：图看起来正常，但显示的"顺序"是假的。
 */
describe('dependencyPairs', () => {
  /** 从扁平数组一步到位拿到依赖连线 */
  function deps(flat: OutlineNode[], opts = OPTS) {
    const positioned = layout(buildTree(flat).roots, opts)
    return { pairs: dependencyPairs(flat, positioned.nodes), positioned }
  }

  it('没有 depends_on 时，一条线都不画', () => {
    expect(deps([node('r', null, 0, '根'), node('a', 'r', 0, '甲')]).pairs).toEqual([])
  })

  it('⚑ 依赖关系【横跨树枝】也能连上 —— 这正是层级树表达不了的东西', () => {
    // 甲一 挂在 甲 下面，乙一 挂在 乙 下面，两者是"表亲"。
    // 依赖图可以不管这个，直接把它们连起来。
    const flat = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('a1', 'a', 0, '甲一'),
      node('b1', 'b', 0, '乙一', { depends_on: ['a1'] }),
    ]
    const { pairs } = deps(flat)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].from.id).toBe('a1')
    expect(pairs[0].to.id).toBe('b1')
  })

  it('方向是【先做的 → 要等的】（箭头指向要等的那一方）', () => {
    // 支付.depends_on = ['下订单']  →  画成 下订单 ──▶ 支付
    const flat = [
      node('r', null, 0, '根'),
      node('order', 'r', 0, '下订单'),
      node('pay', 'r', 1, '支付', { depends_on: ['order'] }),
    ]
    const { pairs } = deps(flat)
    expect(pairs[0].from.data.title).toBe('下订单')
    expect(pairs[0].to.data.title).toBe('支付')
  })

  it('一个节点依赖多个 → 画出多条', () => {
    const flat = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('c', 'r', 2, '丙', { depends_on: ['a', 'b'] }),
    ]
    expect(deps(flat).pairs).toHaveLength(2)
  })

  it('⚑ 依赖指向不存在的节点时不崩，只是那条画不出来', () => {
    // ⚠️ 这是【已知缺口】：§7.2 没有为"依赖悬空"定义 issue code，
    //    所以界面上报不出来。而 simulation.ts 里找不到的 id 会求值成 false，
    //    于是那个任务会永远静静等着。这里只保证不崩。
    const flat = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲', { depends_on: ['根本没这个节点', 'r'] }),
    ]
    const { pairs } = deps(flat)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].from.id).toBe('r')
  })

  it('⚑ japan 数据集：3 条依赖全部连上（目标 id 都存在）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const { pairs } = deps(japan.outline, DEFAULT_LAYOUT)
    // 两条指向「决定出行日期」，一条指向「购买旅行保险」
    expect(pairs).toHaveLength(3)
    expect(pairs.filter((p) => p.from.data.title === '决定出行日期')).toHaveLength(2)
    expect(pairs.filter((p) => p.from.data.title === '购买旅行保险')).toHaveLength(1)
  })

  it('⚑ 每条依赖的两个端点都有真实坐标（否则线会画到 NaN 上去）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const { pairs } = deps(japan.outline, DEFAULT_LAYOUT)
    for (const p of pairs) {
      expect(Number.isFinite(p.from.x) && Number.isFinite(p.from.y)).toBe(true)
      expect(Number.isFinite(p.to.x) && Number.isFinite(p.to.y)).toBe(true)
    }
  })

  it('所有 mock 数据集上都不崩', () => {
    for (const d of datasets) {
      expect(() => deps(d.outline, DEFAULT_LAYOUT), `数据集 ${d.key} 崩了`).not.toThrow()
    }
  })

  /* ── 要不要绕道 ──────────────────────────────────────────
   *
   * ⚑ 这一段是实测抓出来的：依赖经常连的是【同一列的兄弟】，
   *   而中间可能还夹着别的卡片。直线会从那张卡片身上穿过去 ——
   *   而"拱一下"最多只能拱半个卡片宽（84px），绕不开。
   *   所以这种情况得标记成绕道，改走卡片左边的空隙。
   */
  it('⚑ 同列且中间夹着别的卡片 → 要绕道', () => {
    const flat = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('a1', 'a', 0, '甲一'),
      node('a2', 'a', 1, '甲二'), // ← 夹在中间
      node('a3', 'a', 2, '甲三', { depends_on: ['a1'] }),
    ]
    expect(deps(flat).pairs[0].detour).toBe(true)
  })

  it('中间没有东西 → 直连就够，不用绕', () => {
    const flat = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('a1', 'a', 0, '甲一'),
      node('a2', 'a', 1, '甲二', { depends_on: ['a1'] }),
    ]
    expect(deps(flat).pairs[0].detour).toBe(false)
  })

  it('不同列 → 不绕道（斜着走过去，本来也不会压住正中间）', () => {
    const flat = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('a1', 'a', 0, '甲一', { depends_on: ['r'] }),
    ]
    expect(deps(flat).pairs[0].detour).toBe(false)
  })

  it('⚑ japan 数据集：3 条里正好 2 条要绕道 —— 和实测的穿卡结果一致', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const { pairs } = deps(japan.outline, DEFAULT_LAYOUT)
    const detours = pairs
      .filter((p) => p.detour)
      .map((p) => `${p.from.data.title}→${p.to.data.title}`)
    expect(detours).toEqual(['决定出行日期→预订大阪酒店', '决定出行日期→预订京都民宿'])
  })
})
