/**
 * 详情面板里「调整位置」那一块。
 *
 * ⚑ 为什么单独测这个：
 *   它是**不用拖也能改结构**的唯一入口。无障碍规范（WCAG 2.2 AA 的
 *   "dragging-alternative"）要求凡能拖的都必须有替代路径 ——
 *   而"有替代路径"这件事**必须被断言**，不能只是写代码时想着了。
 *   这一块哪天被人顺手删掉或改坏，这里会红。
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { node } from '../../mocks/_helper'
import type { OutlineNode } from '../../types/outline'
import { DetailPanel } from './DetailPanel'

const noop = () => {}

/**
 *      根
 *         甲
 *            甲一   ← 第一个（上移应该禁用）
 *            甲二   ← 最后一个（下移应该禁用）
 *         乙
 *            乙一   ← 独生子（不该出上下移按钮）
 */
function base(): OutlineNode[] {
  return [
    node('r', null, 0, '根'),
    node('a', 'r', 0, '甲'),
    node('b', 'r', 1, '乙'),
    node('a1', 'a', 0, '甲一'),
    node('a2', 'a', 1, '甲二'),
    node('b1', 'b', 0, '乙一'),
  ]
}

function render(
  outline: OutlineNode[],
  nodeId: string,
  opts: { editable?: boolean; attachable?: string[] } = {},
): string {
  const target = outline.find((n) => n.id === nodeId)!
  return renderToString(
    <DetailPanel
      node={target}
      outline={outline}
      editable={opts.editable ?? true}
      // 默认：测试数据都是干净的，所有节点都连得到根
      attachable={new Set(opts.attachable ?? outline.map((n) => n.id))}
      onClose={noop}
      onAction={noop}
      onMove={noop}
      onDelete={noop}
    />,
  )
}

/**
 * 取出含指定文字的那个按钮标签。
 *
 * ⚠️ 为什么不用「整段 HTML 里找 disabled」：页面上按钮不止一个，
 *   那样断言分不清是哪个按钮禁用了 —— 看着很严格，其实什么都没验证。
 */
function buttonTag(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? ''
}

/**
 * 这个按钮是不是被禁用了？
 *
 * ⚠️⚠️ 必须查 `disabled=""` 这个【属性】，**不能**只查 'disabled' 这个词 ——
 *   按钮的 class 里就写着 `disabled:cursor-not-allowed`，
 *   查那个词的话每个按钮都"被禁用"，断言恒真、等于没测。
 *   这个坑我第一次就踩了。
 */
function isDisabled(html: string, label: string): boolean {
  return buttonTag(html, label).includes('disabled=""')
}

describe('DetailPanel · 调整位置（不用拖的那条路）', () => {
  it('⚑ 出「挂在谁下面」的下拉框', () => {
    expect(render(base(), 'a1')).toContain('挂在谁下面')
  })

  it('⚑ 下拉选项写的是【完整路径】，不是光标题', () => {
    const html = render(base(), 'a1')
    // 图里出现两个同名节点是完全可能的；光写标题就分不出哪个是哪个
    expect(html).toContain('根 / 甲')
    expect(html).toContain('根 / 乙')
  })

  it('⚑ 下拉框里【不会】出现它自己，也不会出现自己的后代', () => {
    const html = render(base(), 'a')
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])

    // 自己 → 挂了会成环
    expect(options).not.toContain('根 / 甲')
    // 后代 → 同样是成环（而且是更隐蔽的那种）
    expect(options).not.toContain('根 / 甲 / 甲一')
    expect(options).not.toContain('根 / 甲 / 甲二')
    // ⚑ 但【兄弟】是可以挂的：把自己降一级挂到兄弟下面，完全合法。
    //   一次想清楚"祖先/后代"的方向很重要 —— 危险的只有"往下钻"。
    expect(options).toContain('根 / 乙')
  })

  it('出「上移 / 下移」按钮，并标出当前是第几个', () => {
    const html = render(base(), 'a1')
    expect(buttonTag(html, '上移')).not.toBe('')
    expect(buttonTag(html, '下移')).not.toBe('')
    // 甲一 是甲的第一个孩子（renderToString 会在文本插值之间插 <!-- --> 注释）
    expect(html).toContain('第 <!-- -->1<!-- --> / <!-- -->2<!-- -->')
  })

  it('⚑ 第一个的「上移」禁用、最后一个的「下移」禁用', () => {
    const first = render(base(), 'a1')
    expect(isDisabled(first, '上移'), '第一个不该能上移').toBe(true)
    expect(isDisabled(first, '下移'), '第一个应该能下移').toBe(false)

    const last = render(base(), 'a2')
    expect(isDisabled(last, '上移'), '最后一个应该能上移').toBe(false)
    expect(isDisabled(last, '下移'), '最后一个不该能下移').toBe(true)
  })

  it('⚑ editable=false 时整块消失 —— 和拖拽同一个闸门，不留后门', () => {
    // 否则会出现"拖不动，但能用下拉框改"的漏洞
    expect(render(base(), 'a1', { editable: false })).not.toContain('挂在谁下面')
    expect(render(base(), 'a1', { editable: false })).not.toContain('>上移<')
  })

  it('独生子不出上下移按钮（同级只有它一个，移动没有意义）', () => {
    const html = render(base(), 'b1')
    expect(html).not.toContain('>上移<')
    // 但仍然可以改挂在谁下面
    expect(html).toContain('挂在谁下面')
  })

  it('⚑ 游离节点【不会】出现在"能挂到谁下面"的选项里', () => {
    // ⚑ 挂到游离节点下面只会让游离变更多 —— 用户以为修好了，其实更糟。
    //   而且这条对正常节点同样成立：把好节点挂到孤儿下面 = 亲手造一个新孤儿。
    const html = render(base(), 'a1', { attachable: ['r', 'a', 'b'] })
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])

    // 连得到根的可以挂
    expect(options).toContain('根 / 乙')
    // 连不到根的不给挂（这里把 甲一/甲二/乙一 当作"游离的"）
    expect(options).not.toContain('根 / 甲 / 甲二')
    expect(options).not.toContain('根 / 乙 / 乙一')
  })

  it('⚑ 游离节点本身仍然能打开面板（不然用户没地方修它）', () => {
    // 一份"父节点不存在"的数据 —— 界面上的游离节点就是这样
    const broken = [
      node('r', null, 0, '根'),
      node('lost', '没人', 0, '孤儿'),
    ]
    const html = render(broken, 'lost', { attachable: ['r'] })
    // ⚑ 这是"能修好它"的前提：面板得打得开，下拉框得在
    expect(html).toContain('挂在谁下面')
    // 而且选项里只有真正连得到根的
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])
    expect(options).toEqual(['根'])
  })
})

describe('DetailPanel · 删除入口', () => {
  it('⚑ 有「删除这个节点…」的按钮（FR-6 要的"增删"，之前只有拖拽）', () => {
    // ⚑ 省略号不是装饰：它表示"点了还有下一步"。
    //   直接写「删除」会让人以为点下去就删了，反而不敢点。
    expect(render(base(), 'a1')).toContain('删除这个节点')
  })

  it('⚑ editable=false 时删除入口也消失 —— 和拖拽同一个闸门，不留后门', () => {
    // 否则会出现"拖不动，但能把节点删掉"的漏洞，比拖不动严重得多
    expect(render(base(), 'a1', { editable: false })).not.toContain('删除这个节点')
  })

  it('⚑ 平时【不】展开确认块 —— 点一下才展开', () => {
    // 红色确认块常驻在面板上太容易误触了
    expect(render(base(), 'a1')).not.toContain('确认删除')
  })

  it('根节点没有「挂在谁下面」—— 它无处可挂', () => {
    const html = render(base(), 'r')
    expect(html).not.toContain('挂在谁下面')
  })
})
