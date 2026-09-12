/**
 * 模拟推进的单元测试。
 *
 * ⚑ 重点在【拒绝执行】的那几条规则。让节点变绿很容易，
 *   难的是"该跑的时候才跑" —— 而后者才是这个项目的产品价值
 *   （危险操作必经审批、归人的任务 Agent 不碰）。
 */
import { describe, expect, it } from 'vitest'
import type { OutlineNode } from '../types/outline'
import { node } from '../mocks/_helper'
import {
  DEFAULT_ADVANCE,
  advance,
  approve,
  approveAll,
  markUserTasksDone,
  type ExecutionPlan,
} from './simulation'

const PLAN: ExecutionPlan = {
  t: { tool: 'x', result_summary: '跑完了', elapsed_ms: 100 },
}

/** 跑 n 个 tick，返回最终状态 */
function run(outline: OutlineNode[], ticks = 10, plan = PLAN): OutlineNode[] {
  let cur = outline
  for (let i = 0; i < ticks; i++) {
    const next = advance(cur, plan)
    if (!next) break
    cur = next
  }
  return cur
}

/* ── 该执行的 ─────────────────────────────────────────────── */

describe('advance · 该执行的', () => {
  it('依赖满足的 todo → running', () => {
    const next = advance(
      [node('r', null, 0, '根', { status: 'done' }), node('t', 'r', 0, '任务', { status: 'todo' })],
      PLAN,
    )!
    expect(next.find((n) => n.id === 't')!.status).toBe('running')
  })

  it('running 跑够一轮 → done，并挂上证据和摘要', () => {
    const next = advance([node('t', null, 0, '任务', { status: 'running' })], PLAN)!
    const t = next.find((n) => n.id === 't')!
    expect(t.status).toBe('done')
    expect(t.result_summary).toBe('跑完了')
    expect(t.evidence?.tool).toBe('x')
    expect(t.evidence?.result_ref).toBeTruthy()
  })

  it('⚑ done 必有 evidence（铁律在数据层就成立）', () => {
    const next = advance([node('t', null, 0, '任务', { status: 'running' })], PLAN)!
    expect(next.find((n) => n.id === 't')!.evidence).toBeDefined()
  })

  it('没有预置产出的节点用兜底产出，不会产出 undefined', () => {
    const next = advance([node('t', null, 0, '未知任务', { status: 'running' })], {})!
    const t = next.find((n) => n.id === 't')!
    expect(t.status).toBe('done')
    expect(t.result_summary).toContain('未知任务')
  })

  it('多轮之后整条链跑完', () => {
    const final = run([
      node('a', null, 0, '甲', { status: 'done' }),
      node('b', 'a', 0, '乙', { status: 'todo', depends_on: ['a'] }),
      node('c', 'a', 1, '丙', { status: 'todo', depends_on: ['b'] }),
    ])
    expect(final.map((n) => n.status)).toEqual(['done', 'done', 'done'])
  })
})

/* ── 该【拒绝】执行的（本项目真正的产品规则） ──────────────── */

describe('advance · 拒绝执行的四条规则', () => {
  it('⚑ §9.2：审批 pending 的节点不许执行', () => {
    const next = advance(
      [
        node('t', null, 0, '待确认任务', {
          status: 'todo',
          approval: { level: 'confirm', status: 'pending' },
        }),
      ],
      PLAN,
    )
    // 没有任何变化 → 返回 null
    expect(next).toBeNull()
  })

  it('审批 approved 之后就可以执行了', () => {
    const approved = approve(
      [node('t', null, 0, '任务', { status: 'todo', approval: { level: 'confirm', status: 'pending' } })],
      't',
    )
    expect(advance(approved, PLAN)![0].status).toBe('running')
  })

  it('assignee=user 的节点 Agent 不碰', () => {
    expect(advance([node('t', null, 0, '你来做', { status: 'todo', assignee: 'user' })], PLAN)).toBeNull()
  })

  it('assignee=blocked 的节点不执行', () => {
    expect(
      advance([node('t', null, 0, '卡住', { status: 'todo', assignee: 'blocked' })], PLAN),
    ).toBeNull()
  })

  it('有子节点的容器节点不执行（它是分组，不是任务）', () => {
    const outline = [
      node('parent', null, 0, '行前准备', { status: 'todo' }),
      node('child', 'parent', 0, '子任务', { status: 'todo', depends_on: [] }),
    ]
    const next = advance(outline, PLAN)!
    // 容器保持 todo，只有子任务开跑
    expect(next.find((n) => n.id === 'parent')!.status).toBe('todo')
    expect(next.find((n) => n.id === 'child')!.status).toBe('running')
  })

  it('依赖未完成的节点不执行（拓扑排序）', () => {
    const outline = [
      // 前置归用户且没完成 —— 于是下游永远等不到依赖满足
      node('dep', null, 0, '前置', { status: 'todo', assignee: 'user' }),
      node('t', null, 1, '任务', { status: 'todo', depends_on: ['dep'] }),
    ]
    // 整体无变化 → 返回 null（这正是"拓扑排序拦住它"的表现）
    expect(advance(outline, PLAN)).toBeNull()
  })

  it('依赖链：前置完成后，下游在【同一个 tick 内】就被投递', () => {
    const outline = [
      node('a', null, 0, '甲', { status: 'done' }),
      node('b', null, 1, '乙', { status: 'todo', depends_on: ['a'] }),
      node('c', null, 2, '丙', { status: 'todo', depends_on: ['b'] }),
    ]
    // 第一个 tick：只投 b（c 的依赖 b 还没完成）
    const t1 = advance(outline, PLAN, { maxParallel: 6, completePerTick: 0 })!
    expect(t1.find((n) => n.id === 'b')!.status).toBe('running')
    expect(t1.find((n) => n.id === 'c')!.status).toBe('todo')

    // ⚑ 第二个 tick：b 完成【并且】c 当场被投递。
    //   不这么做的话，每层依赖都要白等一整个轮次 ——
    //   与 ADR-5「调度器拿到结果后当场决定下一步」的模型不符。
    const t2 = advance(t1, PLAN, { maxParallel: 6, completePerTick: 1 })!
    expect(t2.find((n) => n.id === 'b')!.status).toBe('done')
    expect(t2.find((n) => n.id === 'c')!.status).toBe('running')
  })

  it('依赖失败 → 下游 skipped（级联）', () => {
    const next = advance(
      [
        node('bad', null, 0, '上游失败', { status: 'failed' }),
        node('t', null, 1, '下游', { status: 'todo', depends_on: ['bad'] }),
      ],
      PLAN,
    )!
    expect(next.find((n) => n.id === 't')!.status).toBe('skipped')
  })

  it('依赖被跳过 → 下游同样 skipped', () => {
    const next = advance(
      [
        node('skip', null, 0, '上游跳过', { status: 'skipped' }),
        node('t', null, 1, '下游', { status: 'todo', depends_on: ['skip'] }),
      ],
      PLAN,
    )!
    expect(next.find((n) => n.id === 't')!.status).toBe('skipped')
  })
})

/* ── 并发上限 ─────────────────────────────────────────────── */

describe('advance · 并发限制', () => {
  it('§NFR-2：同时 running 的不超过 maxParallel', () => {
    const kids = Array.from({ length: 10 }, (_, i) =>
      node(`k${i}`, null, i, `子 ${i}`, { status: 'todo' }),
    )
    const next = advance(kids, PLAN, { maxParallel: 3, completePerTick: 0 })!
    expect(next.filter((n) => n.status === 'running')).toHaveLength(3)
  })

  it('已有 running 时，剩余名额减少', () => {
    const outline = [
      node('r1', null, 0, '跑着的', { status: 'running' }),
      node('r2', null, 1, '跑着的', { status: 'running' }),
      node('t', null, 2, '待办', { status: 'todo' }),
    ]
    // completePerTick=0：本 tick 不完成任何任务，只看投递
    const next = advance(outline, PLAN, { maxParallel: 3, completePerTick: 0 })!
    // 3 个名额 − 2 个已在跑 = 只投 1 个
    expect(next.filter((n) => n.status === 'running')).toHaveLength(3)
  })
})

/* ── 无进展与纯函数性 ─────────────────────────────────────── */

describe('advance · 无进展与纯函数性', () => {
  it('推不动时返回 null（调用方据此停表，避免空转烧 CPU）', () => {
    expect(advance([node('t', null, 0, '你来做', { status: 'todo', assignee: 'user' })], PLAN)).toBeNull()
    expect(advance([], PLAN)).toBeNull()
  })

  it('不修改传入的数组和对象（纯函数）', () => {
    const outline = [node('t', null, 0, '任务', { status: 'running' })]
    const before = JSON.parse(JSON.stringify(outline))
    advance(outline, PLAN)
    expect(outline).toEqual(before)
  })

  it('默认参数下也能工作', () => {
    expect(DEFAULT_ADVANCE.maxParallel).toBe(6) // §NFR-2
    expect(advance([node('t', null, 0, '任务', { status: 'running' })], PLAN)).not.toBeNull()
  })
})

/* ── 用户侧动作 ───────────────────────────────────────────── */

describe('用户侧动作', () => {
  it('approve 只作用于 pending 的那一个', () => {
    const outline = [
      node('a', null, 0, '待确认', { approval: { level: 'confirm', status: 'pending' } }),
      node('b', null, 1, '另一个', { approval: { level: 'confirm', status: 'pending' } }),
      node('c', null, 2, '无审批'),
    ]
    const next = approve(outline, 'a')
    expect(next.find((n) => n.id === 'a')!.approval!.status).toBe('approved')
    expect(next.find((n) => n.id === 'b')!.approval!.status).toBe('pending')
    expect(next.find((n) => n.id === 'c')!.approval).toBeUndefined()
  })

  it('approve 不碰已经批准/拒绝的（幂等）', () => {
    const outline = [
      node('a', null, 0, '已批准', { approval: { level: 'confirm', status: 'approved' } }),
      node('b', null, 1, '已否决', { approval: { level: 'confirm', status: 'rejected' } }),
    ]
    const next = approveAll(outline)
    expect(next.map((n) => n.approval!.status)).toEqual(['approved', 'rejected'])
  })

  it('approveAll 一次批准全部 pending', () => {
    const next = approveAll([
      node('a', null, 0, '甲', { approval: { level: 'confirm', status: 'pending' } }),
      node('b', null, 1, '乙', { approval: { level: 'double_confirm', status: 'pending' } }),
    ])
    expect(next.every((n) => n.approval!.status === 'approved')).toBe(true)
  })

  it('⚑ markUserTasksDone 只动 assignee=user 的节点', () => {
    const outline = [
      node('u', null, 0, '你来做', { assignee: 'user', status: 'todo' }),
      node('a', null, 1, 'Agent 做', { assignee: 'agent', status: 'todo' }),
      node('b', null, 2, '卡住的', { assignee: 'blocked', status: 'todo' }),
    ]
    const next = markUserTasksDone(outline)
    expect(next.find((n) => n.id === 'u')!.status).toBe('done')
    // 不会替 Agent 干活，也不会替用户解开卡住的项
    expect(next.find((n) => n.id === 'a')!.status).toBe('todo')
    expect(next.find((n) => n.id === 'b')!.status).toBe('todo')
  })
})
