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
import { buildTree, combineStatus, displayState, hasBlockingIssue, rollupStatuses } from './outline'
import { node } from '../mocks/_helper'
import { datasets } from '../mocks'
import type { OutlineNode } from '../types/outline'

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

/* ── ② 依赖图校验（§7.2 的第 ③ 组）────────────────────────── */

/**
 * ⚑ 为什么这一组值得单独测：
 *
 *   这两个错误都会让调度器【静默】停住 —— 不报错、不崩溃、控制台干净，
 *   只是某个任务永远不动了。而界面上它看起来就是个普普通通的「待办」。
 *
 *   **静默失灵是这一行里最难查的 bug。** 所以校验的边界必须钉死。
 *
 * ⚑ 还要注意它和上一组用的是【完全不同的算法】：
 *   层级树是单指针（往上走一条线），依赖图是任意有向图（必须 DFS 三色）。
 *   下面的"菱形不是环"一条，测的就是三色标记里那个【灰】到底有没有用。
 */
describe('buildTree · 依赖图校验', () => {
  const codesOf = (outline: OutlineNode[], code: string) =>
    buildTree(outline).issues.filter((i) => i.code === code)

  it('依赖指向不存在的节点 → E_DANGLING_DEP', () => {
    const issues = codesOf(
      [node('r', null, 0, '根'), node('a', 'r', 0, '甲', { depends_on: ['没这个'] })],
      'E_DANGLING_DEP',
    )
    expect(issues).toHaveLength(1)
    // ⚑ 挂在【依赖方】身上 —— "是谁在等"才是用户要处理的那个节点
    expect(issues[0].node_id).toBe('a')
    expect(issues[0].severity).toBe('error')
  })

  it('多个悬空引用各报一条', () => {
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲', { depends_on: ['x', 'y'] })]
    expect(codesOf(outline, 'E_DANGLING_DEP')).toHaveLength(2)
  })

  it('正常的依赖链不报错', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙', { depends_on: ['a'] }),
      node('c', 'r', 2, '丙', { depends_on: ['b'] }),
    ]
    expect(buildTree(outline).issues).toEqual([])
  })

  it('自依赖也要抓（一个节点的环也是环）', () => {
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲', { depends_on: ['a'] })]
    const issues = codesOf(outline, 'E_CYCLE_DEP')
    expect(issues).toHaveLength(1)
    expect(issues[0].node_id).toBe('a')
  })

  it('两个互相依赖 → 两边各报一条', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('p', 'r', 0, 'P', { depends_on: ['q'] }),
      node('q', 'r', 1, 'Q', { depends_on: ['p'] }),
    ]
    expect(codesOf(outline, 'E_CYCLE_DEP').map((i) => i.node_id).sort()).toEqual(['p', 'q'])
  })

  it('三个成环 → 环上三个节点各报一条', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('x', 'r', 0, 'X', { depends_on: ['y'] }),
      node('y', 'r', 1, 'Y', { depends_on: ['z'] }),
      node('z', 'r', 2, 'Z', { depends_on: ['x'] }),
    ]
    expect(codesOf(outline, 'E_CYCLE_DEP').map((i) => i.node_id).sort()).toEqual(['x', 'y', 'z'])
  })

  it('⚑⚑ 菱形【不是】环 —— 两条路通向同一个节点是正常的', () => {
    //      决定日期
    //       ├── 订机票 ──┐
    //       └── 订酒店 ──┴─→ 出发
    const outline = [
      node('r', null, 0, '根'),
      node('date', 'r', 0, '决定日期'),
      node('fly', 'r', 1, '订机票', { depends_on: ['date'] }),
      node('hotel', 'r', 2, '订酒店', { depends_on: ['date'] }),
      node('go', 'r', 3, '出发', { depends_on: ['fly', 'hotel'] }),
    ]

    // ⚠️ 这条守的是三色标记里那个【灰】到底有没有用。
    //    只用"走过 / 没走过"两色的话：
    //      走到 出发 → 订机票 → 决定日期 之后，决定日期就"走过了"；
    //      再走 出发 → 订酒店 → 决定日期，会撞上"走过了"，**被误判成环**。
    //    真相是：决定日期走完了（黑），不是还在路上（灰）。
    //    这种"两个前置条件汇合"的结构在任何真实任务图里都遍地都是 ——
    //    误判的话整个产品就废了。
    expect(buildTree(outline).issues).toEqual([])
  })

  it('⚑ 同一个节点身处两个环里时只报一次（不刷屏）', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, 'A', { depends_on: ['b'] }),
      node('b', 'r', 1, 'B', { depends_on: ['a', 'c'] }), // A⇄B 一个环，B⇄C 又一个
      node('c', 'r', 2, 'C', { depends_on: ['b'] }),
    ]
    const ids = codesOf(outline, 'E_CYCLE_DEP').map((i) => i.node_id)
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']))
    // B 在两个环里，但只该报一次 —— 报三遍只是噪声，用户不会因此更明白
    expect(ids).toHaveLength(3)
  })

  it('⚑ 游离节点上的依赖照样校验（依赖图和层级树连不连通无关）', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('lost', '没人', 0, '孤儿', { depends_on: ['也没人'] }),
    ]
    expect(buildTree(outline).issues.map((i) => i.code).sort()).toEqual([
      'E_DANGLING_DEP',
      'E_ORPHAN_PARENT',
    ])
  })

  it('⚑ 依赖成环会真的【拦住】整张图，不只是记一笔', () => {
    // hasBlockingIssue() 是 §7.1 说的唯一闸门。
    // 校验出来了却拦不住，等于没校验 —— 所以这条测的是"后果"，不是"有没有报"。
    const outline = [
      node('r', null, 0, '根'),
      node('p', 'r', 0, 'P', { depends_on: ['q'] }),
      node('q', 'r', 1, 'Q', { depends_on: ['p'] }),
    ]
    expect(hasBlockingIssue(buildTree(outline).issues)).toBe(true)
  })

  it('只有警告（order 不连续）时不算阻断', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 2, '乙'),
    ]
    expect(hasBlockingIssue(buildTree(outline).issues)).toBe(false)
  })
})

/* ── 容器状态汇总 ─────────────────────────────────────────── */

describe('combineStatus · 汇总规则', () => {
  it('有 failed → failed（优先级最高，压过 running）', () => {
    // 下面的还在跑、上面有一个失败了 —— 显示 running 会让人以为一切正常
    expect(combineStatus(['running', 'failed', 'done'])).toBe('failed')
  })

  it('有 running → running', () => {
    expect(combineStatus(['done', 'running', 'todo'])).toBe('running')
  })

  it('全部 done 或 skipped → done（skipped 算已了结）', () => {
    expect(combineStatus(['done', 'skipped', 'done'])).toBe('done')
  })

  it('全是 todo → todo', () => {
    expect(combineStatus(['todo', 'todo'])).toBe('todo')
  })

  it('部分了结 + 部分未开工 → running（进行中）', () => {
    expect(combineStatus(['done', 'todo'])).toBe('running')
  })

  it('空数组 → todo（不崩）', () => {
    expect(combineStatus([])).toBe('todo')
  })
})

describe('rollupStatuses · 容器状态派生', () => {
  it('叶子用自己存储的状态，容器用汇总值', () => {
    const built = buildTree([
      node('root', null, 0, '根', { status: 'running' }), // 存的是 running
      node('a', 'root', 0, '甲', { status: 'done' }),
      node('b', 'root', 1, '乙', { status: 'done' }),
    ])
    const rolled = rollupStatuses(built.roots)
    expect(rolled.get('a')).toBe('done')
    expect(rolled.get('b')).toBe('done')
    // ⚑ 根存的是 running，但两个子节点都完成了 → 派生为 done
    expect(rolled.get('root')).toBe('done')
  })

  it('⚑ 根节点的完成标准：所有后代都是 done / skipped 才算完成', () => {
    const mk = (childStatus: 'done' | 'todo' | 'failed' | 'skipped') =>
      buildTree([
        node('root', null, 0, '根'),
        node('mid', 'root', 0, '中间层'),
        node('leaf', 'mid', 0, '叶子', { status: childStatus }),
      ])
    expect(rollupStatuses(mk('done').roots).get('root')).toBe('done')
    expect(rollupStatuses(mk('skipped').roots).get('root')).toBe('done')
    // 只要有一件没办 / 还在办 / 失败了没人管，根就不是已完成
    expect(rollupStatuses(mk('todo').roots).get('root')).not.toBe('done')
    expect(rollupStatuses(mk('failed').roots).get('root')).toBe('failed')
  })

  it('多层嵌套自底向上汇总', () => {
    const built = buildTree([
      node('root', null, 0, '根'),
      node('mid1', 'root', 0, '分支一'),
      node('mid2', 'root', 1, '分支二'),
      node('l1', 'mid1', 0, '叶子一', { status: 'done' }),
      node('l2', 'mid2', 0, '叶子二', { status: 'todo' }),
    ])
    const rolled = rollupStatuses(built.roots)
    expect(rolled.get('mid1')).toBe('done')
    expect(rolled.get('mid2')).toBe('todo')
    // 一个分支完成、一个还没开工 → 根是进行中
    expect(rolled.get('root')).toBe('running')
  })

  it('深层的 failed 会一路上传到根', () => {
    const built = buildTree([
      node('root', null, 0, '根'),
      node('mid', 'root', 0, '中间层'),
      node('leaf', 'mid', 0, '叶子', { status: 'failed' }),
    ])
    const rolled = rollupStatuses(built.roots)
    expect(rolled.get('mid')).toBe('failed')
    expect(rolled.get('root')).toBe('failed')
  })

  it('多根各算各的', () => {
    const built = buildTree([
      node('r1', null, 0, '根一'),
      node('r2', null, 1, '根二'),
      node('a', 'r1', 0, '甲', { status: 'done' }),
      node('b', 'r2', 0, '乙', { status: 'failed' }),
    ])
    const rolled = rollupStatuses(built.roots)
    expect(rolled.get('r1')).toBe('done')
    expect(rolled.get('r2')).toBe('failed')
  })

  it('空输入不崩', () => {
    expect(rollupStatuses([]).size).toBe(0)
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
    it(`「${d.label}」无 error 级 issue`, () => {
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

  it('坏数据样本确实触发了【全部 6 类】问题（否则它就是份没用的样本）', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const codes = new Set(buildTree(corrupt.outline).issues.map((i) => i.code))
    expect(codes).toEqual(
      new Set([
        // §7.2 第 ② 组：层级树
        'E_DUPLICATE_ID',
        'E_ORPHAN_PARENT',
        'E_CYCLE_PARENT',
        'W_ORDER_INVALID',
        // §7.2 第 ③ 组：依赖图
        'E_DANGLING_DEP',
        'E_CYCLE_DEP',
      ]),
    )
  })

  it('⚑ 样本文件头部那份【计数】说明也是准的（不然它会悄悄过时）', () => {
    // corrupt-sample.ts 顶上写着详细清单（1 重复 + 1 孤儿 + 2 环 + 1 order
    // + 1 悬空 + 2 依赖环）。那份说明是给人读的，没有东西守着它就会过时 ——
    // 而这个项目的立场是"文档与代码冲突时以文档为准"，说明写错了比不写还糟。
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const counts = buildTree(corrupt.outline).issues.reduce<Record<string, number>>((acc, i) => {
      acc[i.code] = (acc[i.code] ?? 0) + 1
      return acc
    }, {})

    expect(counts).toEqual({
      E_DUPLICATE_ID: 1,
      E_ORPHAN_PARENT: 1,
      E_CYCLE_PARENT: 2,
      W_ORDER_INVALID: 1,
      E_DANGLING_DEP: 1,
      E_CYCLE_DEP: 2,
    })
  })
})
