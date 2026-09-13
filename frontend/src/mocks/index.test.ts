/**
 * mock 数据集注册表。
 *
 * ⚑ 为什么这个文件是"事后补的"：
 *   原来没有它的任何测试，于是漏掉了一个很典型的 bug ——
 *   点「坏数据样本」按钮，出来的却是日本旅游，**而且什么都不说**。
 *
 *   根因是**按钮和匹配函数对"选哪份"这件事的约定不一致**：
 *   按钮把数据集转成文字（`goal || key`）再交给 pickDataset，
 *   而 pickDataset 只认 `goal`。坏数据样本的 goal 是空的，于是永远选不中，
 *   静默回退到第一份。
 *
 *   ⚑ 下面第一条测试就是那个约定本身 ——
 *     「每份数据都能被它自己的按钮选中」。
 *     写成对**所有**数据集都成立的性质，以后加数据集也不会再漏。
 */
import { describe, expect, it } from 'vitest'
import { datasets, pickDataset } from './index'

describe('pickDataset', () => {
  it('⚑⚑ 每份数据都能被"它自己对应的输入"选中 —— 这条能防住"点了没反应"', () => {
    for (const d of datasets) {
      // 用户直接点按钮时，等效于提交这个 key
      expect(pickDataset(d.key), `数据集 ${d.key} 选不中自己`).toBe(d)
      // 手打目标原文时，走的是 goal
      if (d.goal) {
        expect(pickDataset(d.goal), `打「${d.goal}」选不到 ${d.key}`).toBe(d)
      }
    }
  })

  it('输入里【包含】目标原文也算命中（用户不会一字不差地打）', () => {
    expect(pickDataset('那个，帮我规划一次日本关西七日游好吗').key).toBe('japan-trip')
  })

  it('匹配不上 → 回退第一份，不抛异常（demo 不该让人卡住）', () => {
    expect(pickDataset('随便写点什么').key).toBe(datasets[0].key)
    expect(pickDataset('').key).toBe(datasets[0].key)
  })

  it('⚑ goal 为空的数据集也能靠 key 选中 —— 这就是那个 bug 的回归测试', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    // 它本来就不该有 goal：坏数据不是"用户会输入的目标"，
    // 给它编一个等于暗示模型可能产出这种东西。
    expect(corrupt.goal).toBe('')
    expect(pickDataset('corrupt-sample')).toBe(corrupt)
  })

  it('两边都是空 goal 时不会互相误命中', () => {
    // ⚠️ 匹配条件里那句 `d.goal !== ''` 不是多余的：
    //    空字符串是任何字符串的子串，不加判断的话空 goal 会匹配一切。
    expect(pickDataset('随便什么').key).toBe(datasets[0].key)
  })
})

describe('MockDataset 自身的不变量', () => {
  it('每份都有非空 label（按钮上不能是空白）', () => {
    for (const d of datasets) {
      expect(d.label.trim(), `数据集 ${d.key} 没有 label`).not.toBe('')
    }
  })

  it('label 要短 —— 长了那一排按钮会挤成横向滚动条', () => {
    for (const d of datasets) {
      expect(d.label.length, `「${d.label}」太长了，按钮会挤`).toBeLessThanOrEqual(12)
    }
  })

  it('key 不重复', () => {
    expect(new Set(datasets.map((d) => d.key)).size).toBe(datasets.length)
  })

  it('label 不重复（两个同名的按钮等于没有按钮）', () => {
    expect(new Set(datasets.map((d) => d.label)).size).toBe(datasets.length)
  })
})
