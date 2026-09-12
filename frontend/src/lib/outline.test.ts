/**
 * buildTree / displayState 的单元测试。
 *
 * ⚑ 为什么这些测试值得写（附录 A 的 F2 模式）：
 *   buildTree 是纯函数 —— 不起 React、不起 DOM、不联网，毫秒级跑完。
 *   这类测试的性价比最高：写的时候便宜，跑的时候便宜，坏了的时候
 *   直接指到出问题的那一行。
 *
 * 测试分三组：
 *   ① 正常路径 —— 结构对不对
 *   ② 坏数据   —— 4 种坏法各自被抓住了吗
 *   ③ 视图模型 —— displayState 的优先级和那个护栏
 */
import { describe, expect, it } from 'vitest'
import { buildTree, displayState, hasBlockingIssue } from './outline'
import { node } from '../mocks/_helper'
import { datasets } from '../mocks'

/* ── ① 正常路径 ───────────────────────────────────────────── */

describe('buildTree · 正常路径', () => {
  it('空数组 → 没有根，也不报错', () => {
    const r = buildTree([])
    expect(r.roots).toEqual([])
    expect(r.detached).toEqual([])
    // ⚠️ 关键：空输入不是"根节点数 ≠ 1"的错误，应该安静返回
    expect(r.issues).toEqual([])
  })

  it('单节点 → 一个根，无子节点', () => {
    const r = buildTree([node('x', null, 0, '独苗')])
    expect(r.roots).toHaveLength(1)
    expect(r.roots[0].node.title).toBe('独苗')
    expect(r.roots[0].children).toEqual([])
    expect(r.issues).toEqual([])
  })

  it('三层结构 → 父子关系正确', () => {
    const r = buildTree([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('a1', 'a', 0, '甲一'),
    ])
    expect(r.roots).toHaveLength(1)
    expect(r.roots[0].children.map((c) => c.node.title)).toEqual(['甲', '乙'])
    expect(r.roots[0].children[0].children.map((c) => c.node.title)).toEqual(['甲一'])
    expect(r.issues).toEqual([])
  })

  it('数组顺序乱序 → 仍按 order 排列，不按数组下标', () => {
    // 故意把「乙」放在「甲」前面，且 order 写反
    const r = buildTree([
      node('r', null, 0, '根'),
      node('b', 'r', 1, '乙'),
      node('a', 'r', 0, '甲'),
    ])
    // ⚑ 这是最容易写错的一处：按数组下标会得到 [乙, 甲]
    expect(r.roots[0].children.map((c) => c.node.title)).toEqual(['甲', '乙'])
  })

  it('父节点在数组里后出现 → 依然能挂上', () => {
    // 扁平存储不保证拓扑序，实现不能假设"父一定先出现"
    const r = buildTree([node('a1', 'a', 0, '孩子'), node('a', null, 0, '父')])
    expect(r.roots).toHaveLength(1)
    expect(r.roots[0].children.map((c) => c.node.title)).toEqual(['孩子'])
  })
})

/* ── ② 坏数据 ─────────────────────────────────────────────── */

describe('buildTree · 坏数据', () => {
  it('重复 id → E_DUPLICATE_ID，且保留【先出现】的那条', () => {
    const r = buildTree([
      node('dup', null, 0, '先来的'),
      node('dup', null, 0, '后来的'),
    ])
    expect(r.roots).toHaveLength(1)
    // ⚑ Map 会静默覆盖，所以"保留第一个"是必须显式实现的行为
    expect(r.roots[0].node.title).toBe('先来的')
    expect(r.issues.map((i) => i.code)).toEqual(['E_DUPLICATE_ID'])
  })

  it('孤儿 → E_ORPHAN_PARENT，节点进 detached 而不是被丢弃', () => {
    const r = buildTree([
      node('r', null, 0, '根'),
      node('lost', 'nobody', 0, '孤儿'),
    ])
    expect(r.roots).toHaveLength(1)
    // ⚑ 原则：宁可显式显示异常，也不要静默丢弃用户数据
    expect(r.detached.map((n) => n.title)).toEqual(['孤儿'])
    expect(r.issues.map((i) => i.code)).toEqual(['E_ORPHAN_PARENT'])
    expect(hasBlockingIssue(r.issues)).toBe(true)
  })

  it('环 → E_CYCLE_PARENT，环上每个节点各报一条', () => {
    const r = buildTree([
      node('x', 'y', 0, 'X'),
      node('y', 'x', 0, 'Y'),
    ])
    expect(r.roots).toEqual([])
    expect(r.detached).toHaveLength(2)
    // 每个坏节点各一条 —— 因为 §7.1 的 issue 带 node_id，UI 要逐节点挂角标
    expect(r.issues.filter((i) => i.code === 'E_CYCLE_PARENT')).toHaveLength(2)
  })

  it('挂在环上的节点 → 也算 detached（它同样到不了根）', () => {
    const r = buildTree([
      node('x', 'y', 0, 'X'),
      node('y', 'x', 0, 'Y'),
      node('leaf', 'x', 0, '挂在环上的叶子'),
    ])
    // leaf 自己不在环里，但它到不了根，所以同样无法放进主树
    expect(r.detached.map((n) => n.title).sort()).toEqual(['X', 'Y', '挂在环上的叶子'])
    expect(r.roots).toEqual([])
  })

  it('order 有空洞 → W_ORDER_INVALID', () => {
    const r = buildTree([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 2, '乙'), // 缺 1
    ])
    expect(r.issues.map((i) => i.code)).toEqual(['W_ORDER_INVALID'])
    // warning 不阻断
    expect(hasBlockingIssue(r.issues)).toBe(false)
  })

  it('order 重复 → 同样触发 W_ORDER_INVALID（一行断言抓两种坏法）', () => {
    const r = buildTree([
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 0, '乙'), // 与甲重复
    ])
    expect(r.issues.map((i) => i.code)).toEqual(['W_ORDER_INVALID'])
  })

  it('order 从 1 开始（缺 0）→ 也触发 W_ORDER_INVALID', () => {
    const r = buildTree([
      node('r', null, 0, '根'),
      node('a', 'r', 1, '甲'),
    ])
    expect(r.issues.map((i) => i.code)).toEqual(['W_ORDER_INVALID'])
  })

  it('多根 → E_MULTIPLE_ROOTS，但两棵树都保留下来渲染', () => {
    const r = buildTree([
      node('r1', null, 0, '根一'),
      node('r2', null, 1, '根二'),
    ])
    // ⚑ 不丢数据：两棵都渲染，error 只作为提示
    expect(r.roots).toHaveLength(2)
    expect(r.issues.map((i) => i.code)).toEqual(['E_MULTIPLE_ROOTS'])
  })

  it('一个根不算多根（边界：1 是正常的）', () => {
    const r = buildTree([node('r', null, 0, '独根')])
    expect(r.issues).toEqual([])
  })
})

/* ── ③ 视图模型 ───────────────────────────────────────────── */

describe('displayState', () => {
  const base = node('n', null, 0, '节点')

  it('无审批 → 直接返回 status', () => {
    expect(displayState({ ...base, status: 'running' })).toBe('running')
    expect(displayState({ ...base, status: 'done' })).toBe('done')
  })

  it('审批 pending → awaiting_confirmation（优先于 status）', () => {
    expect(
      displayState({ ...base, status: 'todo', approval: { level: 'confirm', status: 'pending' } }),
    ).toBe('awaiting_confirmation')
  })

  it('二次确认同样是 awaiting_confirmation，等级不影响这个判断', () => {
    // level 用于配色深浅（🟡 vs 🔴），但展示【状态】是同一个
    expect(
      displayState({
        ...base,
        status: 'todo',
        approval: { level: 'double_confirm', status: 'pending' },
      }),
    ).toBe('awaiting_confirmation')
  })

  it('审批被拒 + 还没动 → rejected', () => {
    expect(
      displayState({ ...base, status: 'todo', approval: { level: 'confirm', status: 'rejected' } }),
    ).toBe('rejected')
  })

  it('⚑ 护栏：审批被拒但用户后来自己办完了 → 显示 done，不是 rejected', () => {
    // 这是那个真 bug 的回归测试：approval.status 是审计事实、不会清空，
    // 没有 status==='todo' 护栏的话，已完成的任务会永远显示"被拒绝"。
    expect(
      displayState({ ...base, status: 'done', approval: { level: 'confirm', status: 'rejected' } }),
    ).toBe('done')
  })

  it('审批已通过 → 回到正常 status', () => {
    expect(
      displayState({ ...base, status: 'running', approval: { level: 'confirm', status: 'approved' } }),
    ).toBe('running')
  })
})

/* ── ④ 真实 mock 数据上跑一遍 ──────────────────────────────── */

describe('mock 数据集自身必须是干净的', () => {
  // 前 3 份来自 §8.3，是"模型可能产出的合理输出"，结构上必须无错。
  // 这条测试的价值：以后往数据集里加节点时，写错 order 或 id 会立刻被抓住。
  const clean = datasets.filter((d) => d.key !== 'corrupt-sample')

  for (const d of clean) {
    it(`「${d.goal || d.key}」无 error 级 issue`, () => {
      const r = buildTree(d.outline)
      const errors = r.issues.filter((i) => i.severity === 'error')
      expect(errors, JSON.stringify(errors, null, 2)).toEqual([])
      expect(r.roots).toHaveLength(1)
      expect(r.detached).toEqual([])
    })
  }

  it('bad-case 数据集「最近有点烦」确实只有一个节点', () => {
    // §8.3 种子 #10 的断言：只出根节点，不编造
    const mood = datasets.find((d) => d.key === 'vague-mood')!
    expect(mood.outline).toHaveLength(1)
  })

  it('坏数据样本确实触发了全部 4 类问题（否则它就是份没用的样本）', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const codes = new Set(buildTree(corrupt.outline).issues.map((i) => i.code))
    expect(codes).toEqual(
      new Set(['E_DUPLICATE_ID', 'E_ORPHAN_PARENT', 'E_CYCLE_PARENT', 'W_ORDER_INVALID']),
    )
  })
})
