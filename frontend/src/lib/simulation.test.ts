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
  abandonNode,
  advance,
  approve,
  approveAll,
  awaitingDecisionIds,
  blockingDepsOf,
  completeNode,
  handleFailure,
  markUserTasksDone,
  rejectNode,
  unwaiveDeps,
  waiveDeps,
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

  it('⚑ 依赖【只是 failed】（还没被决定）→ 下游【不】级联，等着', () => {
    // failed 意味着"还没被决定" —— 用户可能选「我来处理」。
    // ⚑ 现在这条已经是**通例的一个特例**：上游出了任何事，下游都不自动放弃
    //   （见下面那条）。留在这里是为了钉住"尤其不能因为 failed 就动下游"。
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

  it('⚑⚑ 上游被【放弃】→ 下游【也】不自动放弃，停在「待你决定」', () => {
    // ⚑ 这一条 2026-09-20 改过。**原来**是"这时才级联跳过"，改的理由：
    //
    //   「上游被放弃」**不等于**「下游也该放弃」——
    //   用户不想买保险了，不代表「打印行程单」也不做（它照样能打）。
    //   "要不要保险"和"要不要打印行程单"是**两个独立的决定**，
    //   而**只有用户能判断第二个**。代码替它选了 skipped，等于把一个
    //   还可以商量的处境，变成已经发生、而且不可逆的事实 —— #13 的形状。
    const outline = [
      node('skip', null, 0, '上游放弃', { status: 'skipped' }),
      node('t', null, 1, '下游', { status: 'todo', depends_on: ['skip'] }),
    ]
    // ① 调度器【碰都不碰它】—— 不是"跳过"，是根本没进展
    expect(advance(outline, PLAN)).toBeNull()
    // ② 但它不再是"普普通通的待办"：它被算进「待你决定」，界面上看得见
    expect([...awaitingDecisionIds(outline)]).toEqual(['t'])
  })

  it('⚑ 完整链路：failed → 用户选「不处理」→ 下游转头【待你决定】', () => {
    const outline = [
      node('bad', null, 0, '上游失败', { status: 'failed' }),
      node('t', null, 1, '下游', { status: 'todo', depends_on: ['bad'] }),
    ]
    // 第一步：用户决定不处理
    const afterDiscard = handleFailure(outline, 'bad', 'discard')
    expect(afterDiscard.find((n) => n.id === 'bad')!.status).toBe('skipped')
    // 第二步：下游不自己动，但开始等用户拍板
    expect(advance(afterDiscard, PLAN)).toBeNull()
    expect([...awaitingDecisionIds(afterDiscard)]).toEqual(['t'])
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

/* ── 上游被放弃之后：两个出口 ─────────────────────────────── */

/**
 * ⚑ 这一组测的是**两个出口真的通** —— 光"不自动放弃"是不够的：
 *   没有出口的话，下游只是换了个地方卡住（从"静默被跳过"变成"静默卡住"），
 *   **#13 只是换了个形状** ✗。
 *
 *     「我也放弃」→ `abandonNode()` → `status = 'skipped'`
 *     「这个照做」→ `waiveDeps()`   → 那条前置写进 `waived_deps`，依赖算满足
 */
describe('上游被放弃之后 · 两个出口', () => {
  /** 所有用例的起点：上游被放弃，下游在等用户拍板 */
  const setup = () => [
    node('skip', null, 0, '买保险', { status: 'skipped' }),
    node('t', null, 1, '打印行程单', { status: 'todo', depends_on: ['skip'] }),
  ]

  it('出口一「这个照做」→ 豁免之后它就能被派发', () => {
    const waived = waiveDeps(setup(), 't', ['skip'])
    expect(waived.find((n) => n.id === 't')!.waived_deps).toEqual(['skip'])
    // 依赖算满足了 → 下一个 tick 就投递
    expect(advance(waived, PLAN)!.find((n) => n.id === 't')!.status).toBe('running')
    // 而且不再是「待你决定」
    expect(awaitingDecisionIds(waived).size).toBe(0)
  })

  it('⚑ 豁免【不】改 depends_on —— 依赖关系本身没变', () => {
    // 这正是它比"直接把依赖删掉"强的地方：事后还查得出"我原来依赖它"，
    // 而"删掉"和"重新加上"在数据上一模一样，分不出来 ✗
    const waived = waiveDeps(setup(), 't', ['skip'])
    expect(waived.find((n) => n.id === 't')!.depends_on).toEqual(['skip'])
  })

  it('⚑ 反悔 → 又变回「待你决定」', () => {
    const back = unwaiveDeps(waiveDeps(setup(), 't', ['skip']), 't', ['skip'])
    expect(back.find((n) => n.id === 't')!.waived_deps).toEqual([])
    expect([...awaitingDecisionIds(back)]).toEqual(['t'])
    expect(advance(back, PLAN)).toBeNull()
  })

  it('⚑⚑ 豁免只对【点名的那条】生效 —— 硬前置必须逐条点', () => {
    // ⚠️ 这一条是整个设计的要害。如果实现被写成"上游是 skipped 就算满足"
    //    （通用放行），这条会红 —— 而那意味着「预订酒店」会在
    //    **没定出行日期**的情况下被派发 ✗（现实里订不了）。
    const outline = [
      node('date', null, 0, '决定出行日期', { status: 'skipped' }),
      node('ins', null, 1, '买保险', { status: 'skipped' }),
      node('hotel', null, 2, '预订酒店', { status: 'todo', depends_on: ['date'] }),
      node('print', null, 3, '打印行程单', { status: 'todo', depends_on: ['date', 'ins'] }),
    ]

    // 只豁免「买保险」—— 打印行程单还等着「出行日期」，所以仍然不动
    const partial = waiveDeps(outline, 'print', ['ins'])
    expect([...awaitingDecisionIds(partial)].sort()).toEqual(['hotel', 'print'])
    expect(advance(partial, PLAN)).toBeNull()

    // 把「出行日期」也豁免掉，它才真的能跑
    const full = waiveDeps(partial, 'print', ['date'])
    expect(advance(full, PLAN)!.find((n) => n.id === 'print')!.status).toBe('running')

    // ⚠️ 而「预订酒店」**仍然**在等 —— 没被顺手放行
    expect(awaitingDecisionIds(full).has('hotel')).toBe(true)
  })

  it('出口二「我也放弃」→ blocked 的节点终于有出口了（v0.7 缺口 #5）', () => {
    // 一个"谁都做不了"的节点，此前三个接口没有一条能让它变 skipped ——
    // 连"我不做这个"都表达不了
    const outline = [
      node('r', null, 0, '根', { status: 'done' }),
      node('x', 'r', 0, '预订米其林餐厅', {
        assignee: 'blocked',
        assignee_reason: 'no_tool',
        status: 'todo',
      }),
    ]
    expect(abandonNode(outline, 'x').find((n) => n.id === 'x')!.status).toBe('skipped')
  })

  it('「我也放弃」只对【还没开始做的】生效（幂等）', () => {
    // running 正在跑、done 已有证据（放弃它会把证据一起丢掉）、
    // failed 该走 handleFailure 那条路
    const cases: Array<[string, OutlineNode]> = [
      ['running', node('a', null, 0, '跑着', { status: 'running' })],
      ['done', node('a', null, 0, '做完了', { status: 'done' })],
      ['failed', node('a', null, 0, '失败了', { status: 'failed' })],
      ['skipped', node('a', null, 0, '已放弃', { status: 'skipped' })],
    ]
    for (const [label, n] of cases) {
      expect(abandonNode([n], 'a')[0].status, label).toBe(n.status)
    }
  })

  it('⚑ blockingDepsOf 只说【还没豁免的】那几条', () => {
    // ⚑ 这就是界面点「这个照做」时豁的那几条 —— 两个入口（对话区 + 详情面板）
    //   都调它，而不是各自从 depends_on 里筛一遍。各筛一遍早晚会筛出分歧。
    const outline = [
      node('a', null, 0, '甲', { status: 'skipped' }),
      node('b', null, 1, '乙', { status: 'skipped' }),
      node('c', null, 2, '丙', { status: 'done' }),
      node('t', null, 3, '丁', { status: 'todo', depends_on: ['a', 'b', 'c'] }),
    ]
    // 只有被放弃的算「挡着」—— 已完成的丙不算，尽管它也在 depends_on 里
    expect(blockingDepsOf(outline, 't')).toEqual(['a', 'b'])
    // 豁掉一条，就只剩另一条
    expect(blockingDepsOf(waiveDeps(outline, 't', ['a']), 't')).toEqual(['b'])
    // 找不到的节点安静返回空 —— 界面可能在数据换掉之后还拿着旧 id
    expect(blockingDepsOf(outline, '不存在')).toEqual([])
  })

  it('豁免过的 id 过期了（那个节点后来被删了）→ 不报错、也不影响', () => {
    // ⚠️ `waived_deps` **允许过期**（见 types/outline.ts）：被豁免的节点
    //   后来被删了，这个 id 在 depends_on 里也没了 —— 读的时候忽略即可。
    //   **这不是坏数据，是设计允许的**（和 E_DANGLING_DEP 正相反）。
    const outline = [
      node('a', null, 0, '甲', { status: 'done' }),
      node('t', null, 1, '乙', { status: 'todo', depends_on: ['a'], waived_deps: ['gone'] }),
    ]
    expect(() => advance(outline, PLAN)).not.toThrow()
    expect(awaitingDecisionIds(outline).size).toBe(0)
    expect(advance(outline, PLAN)!.find((n) => n.id === 't')!.status).toBe('running')
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
