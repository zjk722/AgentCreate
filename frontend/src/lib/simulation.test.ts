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
  completeNode,
  handleFailure,
  markUserTasksDone,
  rejectNode,
  type ExecutionPlan,
} from './simulation'
import { displayState } from './outline'

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

  it('⚑ 依赖【只是 failed】（还没被决定）→ 下游【不】级联跳过，等着', () => {
    // 这是对 §5.2「依赖失败 → 下游 skipped」的一处收紧：
    // failed 意味着还没被决定，此时级联等于提前替用户放弃下游。
    expect(
      advance(
        [
          node('bad', null, 0, '上游失败', { status: 'failed' }),
          node('t', null, 1, '下游', { status: 'todo', depends_on: ['bad'] }),
        ],
        PLAN,
      ),
    ).toBeNull() // 无变化
  })

  it('⚑ 上游被【放弃】（skipped）→ 下游这时才级联跳过', () => {
    const next = advance(
      [
        node('skip', null, 0, '上游放弃', { status: 'skipped' }),
        node('t', null, 1, '下游', { status: 'todo', depends_on: ['skip'] }),
      ],
      PLAN,
    )!
    expect(next.find((n) => n.id === 't')!.status).toBe('skipped')
  })

  it('⚑ 完整链路：failed → 用户选「不处理」→ 下游才级联', () => {
    const outline = [
      node('bad', null, 0, '上游失败', { status: 'failed' }),
      node('t', null, 1, '下游', { status: 'todo', depends_on: ['bad'] }),
    ]
    // 第一步：用户决定不处理
    const afterDiscard = handleFailure(outline, 'bad', 'discard')
    expect(afterDiscard.find((n) => n.id === 'bad')!.status).toBe('skipped')
    // 第二步：这时下游才被级联跳过
    const after = advance(afterDiscard, PLAN)!
    expect(after.find((n) => n.id === 't')!.status).toBe('skipped')
  })

  it('⚑ 完整链路：failed → 用户选「我来处理」→ 下游【不】被跳过', () => {
    const outline = [
      node('bad', null, 0, '上游失败', { status: 'failed' }),
      node('t', null, 1, '下游', { status: 'todo', depends_on: ['bad'] }),
    ]
    const afterHandle = handleFailure(outline, 'bad', 'handle')
    expect(afterHandle.find((n) => n.id === 'bad')!.status).toBe('todo')
    // 下游仍然是 todo（既没跳过，也还没到能执行的时候）
    expect(afterHandle.find((n) => n.id === 't')!.status).toBe('todo')
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

  it('⚑ rejectNode 触发完整的 §5.2 rejected 转移（一次点击改四样东西）', () => {
    const outline = [
      node('t', null, 0, '预订大阪酒店', {
        assignee: 'agent',
        status: 'todo',
        approval: { level: 'confirm', status: 'pending' },
      }),
    ]
    const [t] = rejectNode(outline, 't')

    expect(t.approval!.status).toBe('rejected') // 审计事实
    expect(t.assignee).toBe('user') // 你不让它做，那就你自己来
    expect(t.assignee_reason).toBe('user_rejected') // 界面上能说出为什么
    expect(t.status).toBe('todo') // 回到待办
  })

  it('rejectNode 不碰已经批准/拒绝的（幂等）', () => {
    const approved = [
      node('a', null, 0, '甲', { approval: { level: 'confirm', status: 'approved' } }),
    ]
    expect(rejectNode(approved, 'a')[0].approval!.status).toBe('approved')
  })

  it('rejectNode 不碰没有审批的节点', () => {
    const plain = [node('a', null, 0, '甲', { status: 'todo' })]
    const [a] = rejectNode(plain, 'a')
    expect(a.assignee).toBe('agent')
    expect(a.status).toBe('todo')
  })

  it('⚑ rejectNode 之后 displayState 显示为 rejected（与画布渲染对接）', () => {
    const outline = [
      node('t', null, 0, '甲', { status: 'todo', approval: { level: 'confirm', status: 'pending' } }),
    ]
    const [t] = rejectNode(outline, 't')
    expect(displayState(t)).toBe('rejected')
  })

  it('⚑ handleFailure「我来处理」→ assignee=user + status=todo', () => {
    const outline = [node('f', null, 0, '保险', { status: 'failed' })]
    const [f] = handleFailure(outline, 'f', 'handle')
    expect(f.assignee).toBe('user')
    expect(f.status).toBe('todo')
    expect(f.assignee_reason).toBe('agent_failed') // 界面上能说出为什么归你
  })

  it('⚑ handleFailure「不处理」→ assignee=user + status=skipped', () => {
    const outline = [node('f', null, 0, '保险', { status: 'failed' })]
    const [f] = handleFailure(outline, 'f', 'discard')
    expect(f.assignee).toBe('user')
    expect(f.status).toBe('skipped')
    expect(f.assignee_reason).toBe('agent_failed')
  })

  it('handleFailure 只作用于「agent 且 failed」的节点（幂等 + 不误伤）', () => {
    const outline = [
      node('ok', null, 0, '已完成的', { status: 'done' }),
      node('todo', null, 1, '待办的', { status: 'todo' }),
      node('userfail', null, 2, '归用户的失败', { status: 'failed', assignee: 'user' }),
    ]
    // 已经处置过的（assignee 已不是 agent）不该再被改
    expect(handleFailure(outline, 'ok', 'discard')[0].status).toBe('done')
    expect(handleFailure(outline, 'todo', 'discard')[1].status).toBe('todo')
    expect(handleFailure(outline, 'userfail', 'discard')[2].status).toBe('failed')
  })

  it('⚑ completeNode 只动指定的那一个', () => {
    const outline = [
      node('a', null, 0, '甲', { assignee: 'user', status: 'todo' }),
      node('b', null, 1, '乙', { assignee: 'user', status: 'todo' }),
    ]
    const next = completeNode(outline, 'a')
    expect(next.find((n) => n.id === 'a')!.status).toBe('done')
    expect(next.find((n) => n.id === 'b')!.status).toBe('todo')
  })

  it('completeNode 对已完成的节点是幂等的，且【不产出证据】', () => {
    const outline = [node('a', null, 0, '甲', { status: 'done' })]
    const [a] = completeNode(outline, 'a')
    // 人勾的完成由人负责，不需要工具调用记录背书
    expect(a.evidence).toBeUndefined()
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
