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
import { TaskGraph } from './TaskGraph'

describe('TaskGraph · 渲染冒烟', () => {
  for (const d of datasets) {
    it(`「${d.goal || d.key}」能渲染出 HTML`, () => {
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

  it('有 error 的数据集会显示阻断提示条', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const html = renderToString(<TaskGraph outline={corrupt.outline} />)
    expect(html).toContain('E_CYCLE_PARENT')
    expect(html).toContain('E_ORPHAN_PARENT')
  })

  it('干净的数据集不显示任何问题提示条', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    expect(html).not.toContain('个错误')
    expect(html).not.toContain('游离节点')
  })

  it('japan 数据集里每个节点标题都出现在输出中（没被截断丢失）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = renderToString(<TaskGraph outline={japan.outline} />)
    for (const n of japan.outline) {
      expect(html, `节点「${n.title}」没渲染出来`).toContain(n.title)
    }
  })
})
