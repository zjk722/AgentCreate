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
import { datasets, noteFor, pickDataset } from './index'

describe('pickDataset', () => {
  it('⚑⚑ 每份数据都能被"它自己对应的输入"选中 —— 这条能防住"点了没反应"', () => {
    for (const d of datasets) {
      // 用户直接点按钮时，等效于提交这个 key —— ⚑ key 是唯一的，这条永远成立
      expect(pickDataset(d.key), `数据集 ${d.key} 选不中自己`).toBe(d)

      // 手打目标原文时走的是 goal。
      //
      // ⚠️ 这里**不能**再断言"选到的一定是它自己"：`goal` 允许撞车 ——
      //    手写样本和它的"真跑版"共用同一个目标原文，而 pickDataset 取**第一个**匹配。
      //    撞车时"没选到自己"是**确定行为**，不是那个 bug。
      //
      // ⚑ 但也不能干脆不测 —— 那等于放掉"文字匹配跑到无关数据上"这个风险。
      //    改成断言**命中的那份讲的是同一件事**（goal 一致）：
      //    既容得下撞车，又守住了"不会匹配到别的目标"。
      if (d.goal) {
        expect(pickDataset(d.goal).goal, `打「${d.goal}」匹配到了别的目标`).toBe(d.goal)
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

  it('⚑ 每份都有非空 note —— 它是唯一能挡住"把手造数据当成真数据"的东西', () => {
    // 这条和 label 那条不一样：label 是给人点，note 是给人**判断真假**的。
    // 少了它，看到的图会被默认当成"产品真跑出来的"。
    for (const d of datasets) {
      expect(d.note.trim(), `数据集 ${d.key} 没有 note`).not.toBe('')
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

describe('noteFor', () => {
  it('选中的那份 → 显示它自己的 note', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    expect(noteFor('japan-trip').text).toBe(japan.note)
  })

  it('⚑ 没选数据集时不给空串 —— 给空串那一行会时有时无，布局跟着跳', () => {
    expect(noteFor(null).text.trim()).not.toBe('')
  })

  it('⚑ 任何 key 都有话可说 —— 写成对【所有】数据集成立的性质，以后加数据也不会出现空白', () => {
    for (const d of datasets) {
      expect(noteFor(d.key).text.trim(), `数据集 ${d.key} 显示不出说明`).not.toBe('')
    }
  })

  it('key 不认识（比如刚清空 / URL 里带了个旧的）也不会变成空白', () => {
    expect(noteFor('not-a-dataset').text.trim()).not.toBe('')
  })

  it('note 以 ⚠️ 开头 → warning 为真（界面会标红）', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    // 先确认【约定本身】成立 —— 不然下面那条断言是空转的
    expect(corrupt.note.startsWith('⚠️')).toBe(true)
    expect(noteFor('corrupt-sample').warning).toBe(true)
  })

  it('普通 note 不标红 —— 满屏红字等于没有红字', () => {
    expect(noteFor('japan-trip').warning).toBe(false)
  })
})
