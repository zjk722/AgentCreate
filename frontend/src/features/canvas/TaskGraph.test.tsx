/**
 * 渲染冒烟测试。
 *
 * ⚑ 为什么需要它：`npm run build` 只做【类型检查】，类型对不代表运行时不会崩。
 *   "访问了 undefined 的属性""数组越界"这类错误 `tsc` 抓不到，
 *   但会在浏览器里白屏。
 *
 *   用 `react-dom/server` 的 renderToString 把整棵组件树真跑一遍，
 *   **不需要装 jsdom**（不测事件和副作用，只验证"能渲染出来"）。
 *
 * 每个 mock 数据集都要过一遍 —— 因为它们是不同形态的图：
 * 深树、单节点、多根、坏数据。任何一种让渲染崩掉，这里就会红。
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { datasets } from '../../mocks'
import { node } from '../../mocks/_helper'
import { TaskGraph } from './TaskGraph'

describe('TaskGraph · 渲染冒烟', () => {
  for (const d of datasets) {
    it(`「${d.label}」能渲染出 HTML`, () => {
      let html = ''
      expect(() => {
        html = renderToString(<TaskGraph outline={d.outline} />)
      }, `数据集 ${d.key} 渲染时抛异常`).not.toThrow()

      expect(html.length).toBeGreaterThan(0)
      // 根节点的标题必须出现在输出里 —— 否则说明布局/渲染某一步悄悄丢了节点
      const rootTitle = d.outline.find((n) => n.parent_id === null)?.title
      if (rootTitle) {
        expect(html).toContain(rootTitle)
      }
    })
  }

  it('空 outline 不崩溃', () => {
    expect(() => renderToString(<TaskGraph outline={[]} />)).not.toThrow()
  })

  it('坏数据样本会在输出里显示游离节点区', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const html = renderToString(<TaskGraph outline={corrupt.outline} />)
    // ⚑ 这条断言守的是那个原则：坏数据要【显式显示】而不是静默丢弃
    expect(html).toContain('游离节点')
    expect(html).toContain('孤儿节点')
    expect(html).toContain('环上的节点 X')
  })

  it('⚑ 游离节点是【可以点的】—— 告示牌立了，路也得给', () => {
    // ⚑ 这条守的是 #13 的一个变种：**出口不存在**和**出口不告诉你在哪**，
    //   对用户是同一件事 —— 都是"告诉我坏了，但我没法办"。
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const html = renderToString(<TaskGraph outline={corrupt.outline} />)
    const strip = html.slice(html.indexOf('游离节点'))

    // 每一项是个 button，不是光秃秃的 li
    expect(strip).toContain('<button')
    // 而且明说了点它能干什么
    expect(strip).toContain('点一下可以改它挂在哪')
  })

  it('有 error 的数据集会显示阻断提示条', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const html = renderToString(<TaskGraph outline={corrupt.outline} />)
    expect(html).toContain('E_CYCLE_PARENT')
    expect(html).toContain('E_ORPHAN_PARENT')
  })

  it('⚑ 依赖图那两个 code 也真的显示出来了（校验出来 ≠ 用户看得见）', () => {
    // ⚑ 这条补的是最后一环：buildTree 报出来了，但提示条没渲染的话，
    //   用户那边依然是"什么都没发生" —— 而静默正是这两个错误最坏的地方。
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const html = renderToString(<TaskGraph outline={corrupt.outline} />)
    expect(html).toContain('E_DANGLING_DEP')
    expect(html).toContain('E_CYCLE_DEP')
    expect(html).toContain('永远等下去')
  })

  it('干净的数据集不显示任何问题提示条', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    expect(html).not.toContain('个错误')
    expect(html).not.toContain('游离节点')
  })

  it('⚑ result_summary 会渲染到卡片上（不能只进类型定义不落地）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    const withSummary = japan.outline.filter((n) => n.result_summary)
    expect(withSummary.length).toBeGreaterThan(0)
    for (const n of withSummary) {
      expect(html, `节点「${n.title}」的产出摘要没渲染出来`).toContain(n.result_summary!)
    }
  })

  it('没有 result_summary 的节点不会渲染出空行', () => {
    // 未执行完的节点不该有产出摘要；有了会是脏数据
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const running = japan.outline.find((n) => n.status === 'running')
    expect(running?.result_summary).toBeUndefined()
  })

  it('japan 数据集里每个节点标题都出现在输出中（没被截断丢失）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    for (const n of japan.outline) {
      expect(html, `节点「${n.title}」没渲染出来`).toContain(n.title)
    }
  })
})

/**
 * 入场动画。
 *
 * ⚑ 为什么这些值得测：动画是【纯 CSS 类 + 内联等待时间】驱动的，
 *   写错了不会有任何报错 —— 只会"看起来不对"。而"看起来不对"
 *   恰恰是最难在 code review 里发现的那类问题。
 *   这两条最容易写反：根节点用了会位移的变体、连线的等待时间跟错了节点。
 */
describe('TaskGraph · 入场动画', () => {
  it('⚑ 根节点不位移（用 node-enter-root），其余节点才从左边滑进来', () => {
    const html = renderToString(
      <TaskGraph outline={[node('r', null, 0, '根'), node('a', 'r', 0, '子')]} />,
    )

    // ⚠️ 不能用 toContain('node-enter') 判断普通节点 ——
    //    'node-enter-root' 本身就【包含】'node-enter' 这段文字，
    //    那个断言永远为真，等于没测。所以改成数数量。
    const rootVariant = (html.match(/node-enter-root/g) ?? []).length
    const bothVariants = (html.match(/node-enter/g) ?? []).length

    expect(rootVariant, '根节点应该用不位移的那套动画').toBe(1)
    // 根 + 子 一共两个节点：一个用 root 变体，另一个用普通变体
    expect(bothVariants - rootVariant, '普通节点应该用会位移的那套动画').toBe(1)
  })

  it('⚑ 等待时间 = 第几层 × 90ms（一层一层往外长）', () => {
    const html = renderToString(
      <TaskGraph
        outline={[
          node('r', null, 0, '第一层'),
          node('a', 'r', 0, '第二层'),
          node('b', 'a', 0, '第三层'),
        ]}
      />,
    )

    expect(html).toContain('--enter-delay:0ms') // 根，立刻出场
    expect(html).toContain('--enter-delay:90ms') // 第二层
    expect(html).toContain('--enter-delay:180ms') // 第三层
  })

  it('⚑ 连线的等待时间跟【子】节点走，不是跟父节点', () => {
    const html = renderToString(
      <TaskGraph outline={[node('r', null, 0, '根'), node('a', 'r', 0, '子')]} />,
    )

    // 一棵"根 + 一个孩子"的树：根 0ms、孩子 90ms。
    // 中间那条线也应该是 90ms —— 线跟孩子同步出场。
    // 写反成父节点的 0ms 的话，线会比它连着的节点早一层冒出来，
    // 看上去就是"一根线连着一片空气"。
    const at90 = (html.match(/--enter-delay:90ms/g) ?? []).length
    expect(at90, '孩子节点 + 连着它的线，一共两处应该是 90ms').toBe(2)
  })

  it('⚑ 连线长度被归一化成 1 —— 少了这个，"描线"动画会变成一串小点', () => {
    const html = renderToString(
      <TaskGraph outline={[node('r', null, 0, '根'), node('a', 'r', 0, '子')]} />,
    )

    // pathLength="1" 把这条曲线的长度重新定义为 1，
    // stroke-dasharray="1" 才是"画满整条"。
    // ⚠️ 少了 pathLength，dasharray=1 的含义就变成"1 个像素长的实线"，
    //    曲线会变成一条点线 —— 而且不报错，只是难看。
    expect(html).toContain('pathLength="1"')
    expect(html).toContain('stroke-dasharray="1"')
  })
})

/**
 * 拖拽的开关。
 *
 * ⚑ 为什么值得测这几条：`dragEnabled` 默认是 false（**默认锁上**）。
 *   这个默认值是有意的 —— 忘了传参数时应该是"改不了"，
 *   而不是"能改但没人管"。而"锁住了"必须**说出来**，
 *   否则用户只会以为程序坏了。
 */
describe('TaskGraph · 拖拽开关', () => {
  const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '子')]
  const noop = () => {}

  it('默认锁住：出提示，且节点不可拖', () => {
    const html = renderToString(<TaskGraph outline={outline} />)
    expect(html).toContain('结构暂时锁住了')
    expect(html).toContain('draggable="false"')
    expect(html).not.toContain('draggable="true"')
  })

  it('dragEnabled + onMove 时解锁：提示消失，节点可拖', () => {
    const html = renderToString(<TaskGraph outline={outline} dragEnabled onMove={noop} />)
    expect(html).not.toContain('结构暂时锁住了')
    expect(html).toContain('draggable="true"')
  })

  it('⚑ 只给 dragEnabled 没给 onMove → 仍然锁住（拖了也没地方去）', () => {
    const html = renderToString(<TaskGraph outline={outline} dragEnabled />)
    expect(html).toContain('结构暂时锁住了')
    expect(html).not.toContain('draggable="true"')
  })

  it('空图不出锁定提示（还没有东西可改，说了反而莫名其妙）', () => {
    expect(renderToString(<TaskGraph outline={[]} />)).not.toContain('结构暂时锁住了')
  })
})

/**
 * 依赖连线 —— 「谁必须先做完」。
 *
 * ⚑ 这几条守的是一个**很容易被悄悄破坏**的性质：
 *   用户很自然地会以为"排在上面的先做"，但执行顺序由 `depends_on` 决定，
 *   跟位置无关（§5.2）。依赖线是唯一能把这件事说清楚的东西。
 *   它哪天不画了、画错方向了、或者图例不解释了，用户就会照位置理解，然后理解错。
 */
describe('TaskGraph · 依赖连线', () => {
  it('⚑ japan 数据集的 3 条依赖都画了出来', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    expect((html.match(/dep-edge-enter/g) ?? []).length).toBe(3)
  })

  it('没有依赖的数据集一条都不画', () => {
    const ml = datasets.find((d) => d.key === 'ml-knowledge')!
    const html = renderToString(<TaskGraph outline={ml.outline} />)
    expect(html).not.toContain('dep-edge-enter')
  })

  it('⚑ 每条依赖线都带箭头（否则看不出方向，等于只说了"这两个有关"）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    expect((html.match(/marker-end="url\(#dep-arrow\)"/g) ?? []).length).toBe(3)
    // 箭头形状本身只定义一次，由所有线共用
    expect((html.match(/id="dep-arrow"/g) ?? []).length).toBe(1)
  })

  it('⚑ 依赖线是【虚线】—— 和父子线的实线区分开', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    expect(html).toContain('stroke-dasharray="5 4"')
  })

  it('⚑ 图例解释了两种连线的区别（加了通道就必须解释它）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    expect(html).toContain('父子 · 归在哪一类')
    expect(html).toContain('依赖 · 必须先做完')
  })
})
