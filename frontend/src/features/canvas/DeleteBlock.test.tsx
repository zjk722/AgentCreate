/**
 * 删除确认块。
 *
 * ⚑ 为什么这块值得单独测：
 *   它是**删除这个不可逆操作前面唯一的刹车**。而刹车的价值全在
 *   "把后果说清楚"上 —— 只说「确定吗？」的确认框等于没有。
 *
 *   所以这里测的不是"按钮画出来了没有"，而是**那几句后果说明算对了没有**：
 *   会连坐几个、有谁的依赖会断。
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { node } from '../../mocks/_helper'
import type { OutlineNode } from '../../types/outline'
import { DeleteBlock } from './DeleteBlock'

const noop = () => {}

/**
 * 剥掉注释和所有标签，只留文字。
 *
 * ⚠️ 为什么不能只剥 `<!-- -->`：句子里的数字是包在 `<b>` 里的
 *   （`它下面还有 <b>2</b> 个节点`），只剥注释的话那句话仍然不是连续子串，
 *   断言会失败 —— 但界面其实是对的。这类"测试写错了却看着像代码错了"
 *   最费时间，所以这里直接连标签一起剥掉。
 */
function text(html: string): string {
  return html.replace(/<!--.*?-->/g, '').replace(/<[^>]*>/g, '')
}

/**
 *      根
 *         甲        ← 要删的
 *            甲一
 *            甲二
 *         Y（依赖 甲）
 *         Z（依赖 甲一）
 */
function base(): OutlineNode[] {
  return [
    node('r', null, 0, '根'),
    node('a', 'r', 0, '甲'),
    node('a1', 'a', 0, '甲一'),
    node('a2', 'a', 1, '甲二'),
    node('y', 'r', 1, 'Y', { depends_on: ['a'] }),
    node('z', 'r', 2, 'Z', { depends_on: ['a1'] }),
  ]
}

function render(outline: OutlineNode[], nodeId: string): string {
  const target = outline.find((n) => n.id === nodeId)!
  return text(
    renderToString(
      <DeleteBlock node={target} outline={outline} onDelete={noop} onCancel={noop} />,
    ),
  )
}

describe('DeleteBlock · 把后果摆出来', () => {
  it('⚑ 报出会连坐几个节点', () => {
    // 甲下面有 甲一、甲二 两个
    expect(render(base(), 'a')).toContain('它下面还有 2 个节点')
  })

  it('⚑ 报出有几个节点的依赖会断，并且【点名】', () => {
    // 默认是「上移一层」—— 那时只有 Y（依赖甲）会断；
    // Z 依赖的是甲一，甲一活下来了，所以不受影响。
    const html = render(base(), 'a')
    expect(html).toContain('有 1 个节点依赖它')
    expect(html).toContain('不再等它')
    expect(html).toContain('Y')
  })

  it('⚑ 没有子节点时明说"它下面没有别的节点"（而不是留一片空白）', () => {
    expect(render(base(), 'a1')).toContain('它下面没有别的节点')
  })

  it('两个选项都在（有子节点时）', () => {
    const html = render(base(), 'a')
    expect(html).toContain('一起删掉')
    expect(html).toContain('把它们上移一层')
  })

  it('「一起删掉」后面标出总数，用户不用自己加', () => {
    // 甲 + 甲一 + 甲二 = 3
    expect(render(base(), 'a')).toContain('共 3 个')
  })

  it('确认和取消都有 —— 只能确认的框不是确认框', () => {
    const html = render(base(), 'a')
    expect(html).toContain('确认删除')
    expect(html).toContain('取消')
  })
})

describe('DeleteBlock · 选项不能给会出事的那种', () => {
  it('⚑ 根节点 + 多个孩子时，「上移」选项【根本不出现】', () => {
    // ⚠️ 不是"灰着"—— 是根本不画出来。
    //   上移之后那几个孩子都会变成根，图裂成两棵（E_MULTIPLE_ROOTS）。
    //   灰着的选项用户会反复点，想着"为什么不能"。
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲'), node('b', 'r', 1, '乙')]
    const html = render(outline, 'r')
    expect(html).not.toContain('把它们上移一层')
    // 但还是能删（只是没得选）
    expect(html).toContain('确认删除')
  })

  it('根节点只有一个孩子时，「上移」可以选 —— 那个孩子接任根', () => {
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲')]
    expect(render(outline, 'r')).toContain('把它们上移一层')
  })

  it('非根节点永远可以选上移', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('p', 'r', 0, '父'),
      node('c1', 'p', 0, '子一'),
      node('c2', 'p', 1, '子二'),
    ]
    expect(render(outline, 'p')).toContain('把它们上移一层')
  })
})
