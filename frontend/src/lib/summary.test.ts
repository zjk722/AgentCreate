/**
 * summarize() 的单元测试。
 *
 * ⚑ 这个函数决定「Agent 对用户说的第一句话」。算错了，用户看到的就是
 *   一句误导性的汇报 —— 比渲染错位严重得多。所以判定优先级、
 *   三个"需要人管"口径的边界，都要钉死。
 */
import { describe, expect, it } from 'vitest'
import type { OutlineNode, StructureIssue } from '../types/outline'
import { node } from '../mocks/_helper'
import { datasets } from '../mocks'
import { reasonText } from './reasons'
import { summarize, type Verdict } from './summary'

/** 便捷：只拿 verdict */
function verdictOf(outline: OutlineNode[], issues: StructureIssue[] = []): Verdict {
  return summarize(outline, issues).verdict
}

const ERR: StructureIssue = {
  severity: 'error',
  node_id: null,
  code: 'E_MULTIPLE_ROOTS',
  message: '根节点有 2 个',
}
const WARN: StructureIssue = {
  severity: 'warning',
  node_id: 'x',
  code: 'W_ORDER_INVALID',
  message: 'order 不对',
}

/* ── 处境判定 ─────────────────────────────────────────────── */

describe('summarize · 处境判定', () => {
  it('空图 → empty', () => {
    const s = summarize([], [])
    expect(s.verdict).toBe('empty')
    expect(s.progress).toBe(0)
    expect(s.headline).toContain('还没有任务')
  })

  it('全是待办 → pending', () => {
    expect(
      verdictOf([node('a', null, 0, '甲', { status: 'todo' }), node('b', 'a', 0, '乙', { status: 'todo' })]),
    ).toBe('pending')
  })

  it('有任务在跑 → running', () => {
    expect(
      verdictOf([
        node('a', null, 0, '甲', { status: 'done' }),
        node('b', 'a', 0, '乙', { status: 'running' }),
      ]),
    ).toBe('running')
  })

  it('全部完成 → complete，progress = 1', () => {
    const s = summarize(
      [node('a', null, 0, '甲', { status: 'done' }), node('b', 'a', 0, '乙', { status: 'done' })],
      [],
    )
    expect(s.verdict).toBe('complete')
    expect(s.progress).toBe(1)
    expect(s.headline).toContain('全部 2 项已完成')
  })

  it('部分完成（有 failed）→ partial', () => {
    expect(
      verdictOf([
        node('a', null, 0, '甲', { status: 'done' }),
        node('b', 'a', 0, '乙', { status: 'failed' }),
      ]),
    ).toBe('partial')
  })

  it('⚑ 有 error → blocked，且优先级高于一切', () => {
    // 就算全部完成，只要还有阻断性问题，就得先说问题
    const allDone = [
      node('a', null, 0, '甲', { status: 'done' }),
      node('b', 'a', 0, '乙', { status: 'done' }),
    ]
    expect(verdictOf(allDone, [ERR])).toBe('blocked')
    expect(summarize(allDone, [ERR]).headline).toContain('阻断性问题')
  })

  it('只有 warning 不阻断 → 处境不受影响', () => {
    expect(
      verdictOf([node('a', null, 0, '甲', { status: 'done' })], [WARN]),
    ).toBe('complete')
  })

  it('skipped 也算"不是干净的待办" → partial', () => {
    // 被跳过意味着有人得收尾，不能报"待办中"
    expect(
      verdictOf([
        node('a', null, 0, '甲', { status: 'done' }),
        node('b', 'a', 0, '乙', { status: 'skipped' }),
      ]),
    ).toBe('partial')
  })

  it('progress 按 done/total 算（skipped 不算完成）', () => {
    const s = summarize(
      [
        node('a', null, 0, '甲', { status: 'done' }),
        node('b', 'a', 0, '乙', { status: 'done' }),
        node('c', 'a', 1, '丙', { status: 'skipped' }),
        node('d', 'a', 2, '丁', { status: 'todo' }),
      ],
      [],
    )
    expect(s.progress).toBe(0.5)
  })
})

/* ── 三个"需要人管"的口径 ─────────────────────────────────── */

describe('summarize · 需要人管的三类', () => {
  const outline: OutlineNode[] = [
    node('u1', null, 0, '归你的待办', { assignee: 'user', assignee_reason: 'needs_human', status: 'todo' }),
    node('u2', null, 1, '归你的已完成', { assignee: 'user', assignee_reason: 'needs_human', status: 'done' }),
    node('b1', null, 2, '卡住的', {
      assignee: 'blocked',
      assignee_reason: 'no_tool',
      assignee_detail: 'restaurant_booking',
      status: 'todo',
    }),
    node('b2', null, 3, '卡住但已完成', { assignee: 'blocked', status: 'done' }),
    node('a1', null, 4, '等点头的', {
      status: 'todo',
      approval: { level: 'confirm', status: 'pending' },
    }),
    node('a2', null, 5, '已批准的', {
      status: 'done',
      approval: { level: 'confirm', status: 'approved' },
    }),
  ]
  const s = summarize(outline, [])

  it('userTodos 只收 assignee=user 且【未完成】的', () => {
    expect(s.userTodos.map((t) => t.id)).toEqual(['u1'])
  })

  it('blockers 只收 assignee=blocked 且【未完成】的', () => {
    expect(s.blockers.map((t) => t.id)).toEqual(['b1'])
  })

  it('awaitingApproval 只收 approval=pending 的', () => {
    expect(s.awaitingApproval.map((t) => t.id)).toEqual(['a1'])
  })

  it('⚑ failedTasks 只收「agent 且 failed」的 —— 即等用户决定怎么处置的', () => {
    const outline = [
      node('f1', null, 0, 'Agent 失败了', { status: 'failed' }),
      // 已经处置过的（assignee 已转 user）不该再出现在这里
      node('f2', null, 1, '已处置的', {
        status: 'skipped',
        assignee: 'user',
        assignee_reason: 'agent_failed',
      }),
      node('f3', null, 2, '用户自己的失败', { status: 'failed', assignee: 'user' }),
    ]
    const r = summarize(outline, [])
    expect(r.failedTasks.map((t) => t.id)).toEqual(['f1'])
  })

  it('原因枚举和 detail 被原样带出来（不做翻译——翻译在 reasons.ts）', () => {
    expect(s.blockers[0]).toEqual({
      id: 'b1',
      title: '卡住的',
      reason: 'no_tool',
      detail: 'restaurant_booking',
    })
  })

  it('byStatus / byAssignee 计数正确', () => {
    expect(s.total).toBe(6)
    expect(s.byAssignee).toEqual({ agent: 2, user: 2, blocked: 2 })
    expect(s.byStatus.done).toBe(3)
    expect(s.byStatus.todo).toBe(3)
  })

  it('headline 里的数字来自真实计数', () => {
    // 这里 3 done / 6 total，但有 pending 审批 → running 优先？
    // 不：running 只由 status=running 决定，这里没有 running，所以是 partial
    expect(s.verdict).toBe('partial')
    expect(s.headline).toContain('已完成 3/6')
    expect(s.headline).toContain('1 项卡住')
    expect(s.headline).toContain('1 项需要你')
  })
})

/* ── 问题排序 ─────────────────────────────────────────────── */

describe('summarize · 问题排序', () => {
  it('error 排在 warning 前面（读者该先看到阻断项）', () => {
    const s = summarize([], [WARN, ERR])
    expect(s.problems.map((p) => p.severity)).toEqual(['error', 'warning'])
  })

  it('排序不修改传入的数组（纯函数不该有副作用）', () => {
    const input = [WARN, ERR]
    summarize([], input)
    expect(input[0]).toBe(WARN) // 原数组顺序不变
  })
})

/* ── 真实数据集 ───────────────────────────────────────────── */

describe('summarize · 真实 mock 数据', () => {
  it('japan 数据集数得出"需要你做的"和"卡住的"', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const s = summarize(japan.outline, [])

    // 归用户的：决定出行日期、办理签证、兑换日元（3 个，都还没完成）
    expect(s.userTodos.map((t) => t.title)).toEqual([
      '决定出行日期',
      '办理签证',
      '兑换日元',
    ])
    // 卡住的只有米其林餐厅
    expect(s.blockers.map((t) => t.title)).toEqual(['预订米其林餐厅'])
    expect(s.blockers[0].detail).toBe('restaurant_booking')
    // 两个等确认的（酒店单次、接送机二次）
    expect(s.awaitingApproval).toHaveLength(2)
    // 一个等决定的（购买旅行保险 —— Agent 失败、还没处置）
    expect(s.failedTasks.map((t) => t.title)).toEqual(['购买旅行保险'])
  })

  it('⚑ headline 说"待你决定"而不是"失败"（前者是待办，后者只是陈述）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const s = summarize(japan.outline, [])
    expect(s.headline).toContain('待你决定')
  })

  it('japan 数据集不是"全部完成"（有 failed/skipped/todo）', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const s = summarize(japan.outline, [])
    expect(s.verdict).not.toBe('complete')
    expect(s.progress).toBeGreaterThan(0)
    expect(s.progress).toBeLessThan(1)
  })

  it('vague-mood（单节点）能算，且不崩', () => {
    const mood = datasets.find((d) => d.key === 'vague-mood')!
    const s = summarize(mood.outline, [])
    expect(s.total).toBe(1)
    expect(s.userTodos).toHaveLength(1)
  })

  it('corrupt-sample 带上 issues 会判定为 blocked', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    // 这里显式传一个 error，模拟 buildTree 的产出
    const s = summarize(corrupt.outline, [ERR])
    expect(s.verdict).toBe('blocked')
  })
})

/* ── 枚举翻译 ─────────────────────────────────────────────── */

describe('reasonText', () => {
  it('每个枚举都有解释、下一步和文档出处', () => {
    const all = [
      'needs_human',
      'no_tool',
      'agent_failed',
      'user_rejected',
      'policy_denied',
    ] as const
    for (const r of all) {
      const t = reasonText(r)
      expect(t, `枚举 ${r} 没有翻译`).not.toBeNull()
      expect(t!.why.length).toBeGreaterThan(0)
      expect(t!.next.length).toBeGreaterThan(0)
      // ⚑ 每条都必须能追到文档出处 —— 这是"可验证"的具体含义
      expect(t!.rule).toMatch(/§/)
    }
  })

  it('null 返回 null（归 Agent 无需解释）', () => {
    expect(reasonText(null)).toBeNull()
    expect(reasonText(undefined)).toBeNull()
  })

  it('未知枚举有安全兜底，不返回 undefined（后端加了新枚举也不该白屏）', () => {
    const t = reasonText('some_future_reason' as never)
    expect(t).not.toBeNull()
    expect(t!.why).toContain('未标注')
  })
})
