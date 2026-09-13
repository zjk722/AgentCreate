/**
 * moveNode / possibleParents 的单元测试。
 *
 * ⚑ 这块为什么值得写这么多测试：
 *   拖拽是**能改坏数据**的操作。拖错了顶多没反应，但重编号写错会留下
 *   order 空洞 —— 那是**静默的**坏数据：界面上看不出来，
 *   直到某天有人读这张图才发现顺序不对。
 *
 * ⚑ 一个刻意的选择：**不自己写"order 连不连续"的断言，
 *   而是直接调项目自己的校验器 buildTree()**。
 *   因为"什么叫合法的 order"这件事的权威定义在 §7.2 的 W_ORDER_INVALID 里 ——
 *   自己再写一套判断，就等于让测试和规格各说各话，
 *   以后规格改了测试却还绿着。
 */
import { describe, expect, it } from 'vitest'
import { datasets } from '../mocks'
import { node } from '../mocks/_helper'
import type { OutlineNode } from '../types/outline'
import { buildTree } from './outline'
import { deleteImpact, deleteNode, moveNode, nodePath, possibleParents, siblingsOf } from './outlineEdit'

/* ── 助手 ─────────────────────────────────────────────────── */

/**
 * 一批测试共用的树：
 *
 *     根
 *       甲
 *         甲一
 *         甲二
 *       乙
 *         乙一
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

/** 断言"挪完之后数据仍然合法"—— 用项目自己的校验器，不另写一套。 */
function expectClean(outline: OutlineNode[], what = ''): void {
  const issues = buildTree(outline).issues
  expect(issues, `${what} 产生了坏数据：${JSON.stringify(issues, null, 2)}`).toEqual([])
}

/** 某个父亲下的孩子标题，按 order 排好 —— 断言"顺序"最直观的形式。 */
function childrenOf(outline: OutlineNode[], parentId: string | null): string[] {
  return siblingsOf(outline, parentId).map((n) => n.title)
}

/** 断言移动成功并把新数组取出来（失败时直接让断言报错，省得每处都写窄化） */
function moved(
  outline: OutlineNode[],
  from: string,
  to: string,
  pos: 'before' | 'after' | 'child',
): OutlineNode[] {
  const r = moveNode(outline, from, to, pos)
  expect(r.ok, `这次移动被拒了：${r.ok ? '' : r.reason}`).toBe(true)
  return r.ok ? r.outline : outline
}

/* ── 跨父移动：文档特意警告的那条 ─────────────────────────── */

describe('moveNode · 跨父移动', () => {
  it('⚑ 旧组和新组【都要】重编号 —— 只改一组会留下 order 空洞', () => {
    // 把「甲一」从 甲 底下挪到 乙 底下，当乙的孩子
    const next = moved(base(), 'a1', 'b', 'child')
    const byId = new Map(next.map((n) => [n.id, n]))

    // 新家：乙一 还在 0，甲一 追加到 1
    expect(byId.get('a1')!.parent_id).toBe('b')
    expect(byId.get('a1')!.order).toBe(1)
    expect(byId.get('b1')!.order).toBe(0)

    // 旧家：甲二 原本是 1，抽走甲一之后必须补到 0
    // ⚠️ 这一条就是"只改一组"会漏掉的 —— 漏了之后甲二的 order 停在 1，
    //    兄弟组变成 [0, 1] 但只有一个节点 → W_ORDER_INVALID
    expect(byId.get('a2')!.order).toBe(0)

    expectClean(next)
  })

  it('跨父移动后，两张子树都仍然只认自己的爸爸', () => {
    const next = moved(base(), 'a1', 'b', 'child')
    expect(childrenOf(next, 'a')).toEqual(['甲二'])
    expect(childrenOf(next, 'b')).toEqual(['乙一', '甲一'])
  })
})

/* ── 同组内挪动：那个"差一位"的陷阱 ───────────────────────── */

describe('moveNode · 同组内挪动', () => {
  /** 一排三个兄弟，专门用来暴露"先算位置再拉走"的差一位错误 */
  function queue(): OutlineNode[] {
    return [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('c', 'r', 2, '丙'),
    ]
  }

  it('⚑⚑ 把「甲」挪到「乙」后面 → 乙 甲 丙（不是 乙 丙 甲）', () => {
    // 正确的顺序是【先拉走、再在新队伍里找位置】。
    // 如果反过来（先算位置再拉走）：
    //   算位置时甲还在队里 → 乙的下标是 1 → 插到 2
    //   拉走甲 → 队变成 [乙, 丙]
    //   插到 2 → [乙, 丙, 甲]  ← 错了
    expect(childrenOf(moved(queue(), 'a', 'b', 'after'), 'r')).toEqual(['乙', '甲', '丙'])
  })

  it('⚑ 把「丙」挪到「甲」前面 → 丙 甲 乙', () => {
    // 反向的同一个陷阱
    expect(childrenOf(moved(queue(), 'c', 'a', 'before'), 'r')).toEqual(['丙', '甲', '乙'])
  })

  it('把最后一个挪到最前、最前的挪到最后', () => {
    expect(childrenOf(moved(queue(), 'c', 'a', 'before'), 'r')).toEqual(['丙', '甲', '乙'])
    expect(childrenOf(moved(queue(), 'a', 'c', 'after'), 'r')).toEqual(['乙', '丙', '甲'])
  })

  it('同组内挪动后 order 依然是 0..k-1', () => {
    expectClean(moved(queue(), 'a', 'b', 'after'))
  })
})

/* ── 护栏 ─────────────────────────────────────────────────── */

describe('moveNode · 五条护栏', () => {
  it('拖到自己身上 → self', () => {
    expect(moveNode(base(), 'a', 'a', 'child')).toEqual({ ok: false, reason: 'self' })
  })

  it('⚑ 插到根节点的前/后面 → multiple_roots（图会裂成两棵树）', () => {
    // ⚠️ 这条是【穷举测试】抓出来的，手挑的用例全都没想起"目标是根"这种情况。
    //    "插到根前面" = 挂到根的爸爸下面 = 挂到"没有"下面 = 自己也变成根
    expect(moveNode(base(), 'a', 'r', 'before')).toEqual({ ok: false, reason: 'multiple_roots' })
    expect(moveNode(base(), 'a', 'r', 'after')).toEqual({ ok: false, reason: 'multiple_roots' })
  })

  it('但插到根节点的【身上】是合法的 —— 那是当根的孩子', () => {
    expect(moveNode(base(), 'a1', 'r', 'child').ok).toBe(true)
  })

  it('⚑ 把爸爸塞进儿子的口袋 → descendant（会绕成圈）', () => {
    expect(moveNode(base(), 'a', 'a1', 'child')).toEqual({ ok: false, reason: 'descendant' })
  })

  it('⚑ 深层后代同样拦住 —— 不只看直接儿子', () => {
    const outline = [
      node('a', null, 0, '甲'),
      node('a1', 'a', 0, '甲一'),
      node('a11', 'a1', 0, '甲一一'),
      node('z', null, 1, '别的'),
    ]
    expect(moveNode(outline, 'a', 'a11', 'child')).toEqual({ ok: false, reason: 'descendant' })
  })

  it('⚑ 把 X 插到自己孩子的"旁边"也拦 —— 那样 X 的爸爸会变成 X', () => {
    // 落点看着是"当兄弟"，但目标是 X 自己的孩子，
    // 于是新爸爸 = 那个孩子的爸爸 = X 自己。同一个环，换个入口。
    expect(moveNode(base(), 'a', 'a1', 'before')).toEqual({ ok: false, reason: 'descendant' })
    expect(moveNode(base(), 'a', 'a1', 'after')).toEqual({ ok: false, reason: 'descendant' })
  })

  it('⚑ 拖回原地 → noop（不能白改一次）', () => {
    // 「乙」已经是根节点的最后一个孩子了，再让它当根的孩子 → 位置没变
    // ⚑ 为什么必须拦：真实系统里任何一次写入都会把 revision 加一，
    //   于是别人基于旧版本的编辑全部作废（§5.3 的 409）。
    //   为了一次零改动的操作去作废别人的工作，是纯粹的伤害。
    expect(moveNode(base(), 'b', 'r', 'child')).toEqual({ ok: false, reason: 'noop' })
  })

  it('拖到自己下一个兄弟前面 → 也是 noop', () => {
    // 甲(0) 乙(1)：把甲挪到乙前面，位置其实没动
    expect(moveNode(base(), 'a', 'b', 'before')).toEqual({ ok: false, reason: 'noop' })
  })

  it('id 不存在 → not_found', () => {
    expect(moveNode(base(), '不存在', 'a', 'child')).toEqual({ ok: false, reason: 'not_found' })
    expect(moveNode(base(), 'a', '不存在', 'child')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('被拒时不返回 outline（调用方没法误用）', () => {
    const r = moveNode(base(), 'a', 'a1', 'child')
    expect(r).not.toHaveProperty('outline')
  })
})

/* ── 坏数据 ───────────────────────────────────────────────── */

describe('moveNode · 坏数据下不能转死', () => {
  it('⚑ 数据本身带环时，往上爬不会无限转（本项目就带了一份坏数据样本）', () => {
    // X→Y→X 已经成环。没有 seen 保护的话，isUnder 会沿着
    // x→y→x→y… 一直爬下去，页面直接卡死。
    const cyclic = [node('x', 'y', 0, 'X'), node('y', 'x', 0, 'Y'), node('z', null, 0, 'Z')]
    expect(() => moveNode(cyclic, 'z', 'x', 'child')).not.toThrow()
  })

  it('⚑ 坏数据集上跑遍所有组合也不崩、不死循环', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    expect(() => {
      for (const from of corrupt.outline) {
        for (const to of corrupt.outline) {
          for (const pos of ['before', 'after', 'child'] as const) {
            moveNode(corrupt.outline, from.id, to.id, pos)
          }
        }
      }
    }).not.toThrow()
  })
})

/* ── 不在坏数据上【造出新的】问题 ─────────────────────────── */

/**
 * ⚑ 这一条是修一个真 bug 时补的，**那个 bug 是测试抓出来的**。
 *
 *   `moveNode` 重编号时原来没有按 id 去重。数据里带重复 id 的话，
 *   重复的那条会占掉一个编号位，而它【又不在树上】
 *   （buildTree 只保留先出现的那个）——
 *   于是真正在树上的兄弟被编出一个空洞，凭空多出一条 `W_ORDER_INVALID`。
 *
 *   ⚑ 要命的地方在于：**那个空洞是我们自己造的。**
 *      用户什么都没干，只是拖了一下，图上就多了一个错。
 *      数据本来就有病，不是我们让它更病的理由。
 */
describe('moveNode · 不在坏数据上造出新问题', () => {
  it('⚑ 数据里有重复 id 时，重编号不会凭空造出 order 空洞', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('c', 'r', 2, '丙'),
      node('b', 'r', 3, '重复的乙'), // ← 同一个 id 又出现一次
    ]

    const r = moveNode(outline, 'c', 'a', 'before')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // 原来那一条重复 id 的问题还在（那是数据自带的，我们管不着），
    // 但【不能多出别的】—— 尤其是 W_ORDER_INVALID。
    expect(buildTree(r.outline).issues.map((i) => i.code)).toEqual(['E_DUPLICATE_ID'])
  })

  it('重复 id 那条不该被算进兄弟编号里', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'),
      node('b', 'r', 5, '重复的乙'),
    ]
    const r = moveNode(outline, 'b', 'a', 'before')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // 根的两个孩子（按 id 去重后）必须是 0 和 1
    const byId = new Map(r.outline.map((n) => [n.id, n]))
    expect(byId.get('a')!.order).toBe(1)
    expect(byId.get('b')!.order).toBe(0)
  })
})

/* ── 纯函数 ───────────────────────────────────────────────── */

describe('moveNode · 是纯函数', () => {
  it('不修改传进来的数组', () => {
    const outline = base()
    const snapshot = JSON.parse(JSON.stringify(outline))
    moveNode(outline, 'a1', 'b', 'child')
    expect(outline).toEqual(snapshot)
  })
})

/* ── 穷举：真实数据上把所有可能都跑一遍 ───────────────────── */

/**
 * ⚑ 为什么值得跑穷举：手挑的用例只能覆盖你**想到**的情况。
 *   重编号的差一位、空组边界这些，恰恰是想不到的那些。
 *   18 个节点 × 18 × 3 种落点 = 不到一千次调用，跑完比眨眼还快。
 */
describe('moveNode · 在所有 mock 数据集上穷举', () => {
  const POSITIONS = ['before', 'after', 'child'] as const

  for (const d of datasets.filter((x) => x.key !== 'corrupt-sample')) {
    it(`「${d.label}」：任意两节点 × 三种落点，结果都仍然合法`, () => {
      let moves = 0
      for (const from of d.outline) {
        for (const to of d.outline) {
          for (const pos of POSITIONS) {
            const r = moveNode(d.outline, from.id, to.id, pos)
            if (!r.ok) continue
            moves++
            expectClean(r.outline, `把「${from.title}」挪到「${to.title}」的 ${pos} 位之后，`)
          }
        }
      }
      // 顺带确认这个测试确实跑到了东西 —— 如果所有组合都被拒，
      // 上面的 expectClean 一次都不会执行，测试会"绿得毫无意义"。
      //
      // ⚠️ 只有一个节点的图（vague-mood，§8.3 种子 #10）例外：
      //    它只有一个根，拖哪儿都是"拖到自己身上"→ self。
      //    **零次成功移动是正确行为，不是测试没跑。**
      if (d.outline.length > 1) {
        expect(moves, '一次成功的移动都没有，这个穷举等于没跑').toBeGreaterThan(0)
      } else {
        expect(moves, '单节点图不该有任何可移动的组合').toBe(0)
      }
    })
  }
})

/* ── 坏数据能不能被修好 ───────────────────────────────────── */

/**
 * ⚑ 这一组测的是"**出路真的通**"，不是"数据合法"。
 *
 *   界面把游离节点显式画出来、还写着"点一下可以改它挂在哪"，
 *   那这句话就必须是真的 —— 点了、改了，它得真的回到树上。
 *
 *   ⚠️ 而"告示牌立了但路是断的"，和"没有告示牌"对用户是同一件事。
 *      所以这条不能只靠推理，得跑一遍。
 */
describe('坏数据可以被改回主树', () => {
  it('⚑ 把孤儿和环上节点挂回主树之后，游离节点清零', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    let outline = corrupt.outline

    // 起点：3 个游离（1 个孤儿 + 2 个环上）
    expect(buildTree(outline).detached.map((n) => n.id).sort()).toEqual([
      'd40000000003',
      'd40000000004',
      'd40000000005',
    ])

    // ① 把孤儿挂到根下面
    const r1 = moveNode(outline, 'd40000000003', 'd40000000000', 'child')
    expect(r1.ok, '孤儿挂不回去').toBe(true)
    outline = r1.ok ? r1.outline : outline
    expect(buildTree(outline).detached).toHaveLength(2)

    // ② 把环上的 X 挂回主树
    //    ⚑ 这一步【一次修两个】：Y 的父就是 X，X 一旦回到树上，Y 跟着回来。
    //      这正是"环"的性质 —— 它是靠互相指着形成的，破一处就整条散开。
    const r2 = moveNode(outline, 'd40000000004', 'd40000000000', 'child')
    expect(r2.ok, '环上节点挂不回去').toBe(true)
    outline = r2.ok ? r2.outline : outline

    expect(buildTree(outline).detached, '还有节点没回到树上').toEqual([])
  })

  it('⚠️ 但【依赖图】那两个问题改不了 —— 详情面板里没有编辑 depends_on 的入口', () => {
    // ⚑ 这条不是"测试通过"，是**把一个已知缺口钉住**。
    //
    //   结构问题（parent_id）现在能修了；依赖问题（depends_on）还不能 ——
    //   所以坏数据样本修完结构之后，仍然会被 §7.1 的闸门拦住。
    //
    //   这也意味着那条断言哪天红了，说明有人补上了依赖编辑器 ——
    //   那是好事，把这条测试改成"修完就全清了"即可。
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    let outline = corrupt.outline

    for (const [id, target] of [
      ['d40000000003', 'd40000000000'],
      ['d40000000004', 'd40000000000'],
    ] as const) {
      const r = moveNode(outline, id, target, 'child')
      if (r.ok) outline = r.outline
    }

    // 结构已经干净了 —— 游离清零
    expect(buildTree(outline).detached).toEqual([])
    // 而且【没有多出新的问题】：order 也被重编号重排好了。
    // ⚠️ 这一条是有来历的：moveNode 原来没按 id 去重，重复 id 那条会占掉
    //    一个编号位、而它又不在树上，于是凭空编出一个 order 空洞 ——
    //    用户只是拖了一下，图上却多了一个错。这条断言就是为了钉住那个 bug。
    const codes = new Set(buildTree(outline).issues.map((i) => i.code))
    expect(codes, '修结构的时候自己造出了新问题').toEqual(
      new Set([
        // 这两个是依赖图的，界面上还改不了
        'E_DANGLING_DEP',
        'E_CYCLE_DEP',
        // 这个是【原样保留】的：重复 id 没法靠移动节点消掉
        'E_DUPLICATE_ID',
      ]),
    )
  })
})

/* ── 删除节点 ─────────────────────────────────────────────── */

/**
 * ⚑ 这一组里最要紧的**不是**"节点有没有被删掉"（那是一行 filter），
 *   而是下面两件：
 *
 *     ① **引用清干净了没有** —— 不清理就立刻造出 E_DANGLING_DEP，
 *        下游任务永远等着、界面上什么都不显示。**这是删除功能唯一的真风险。**
 *     ② **兄弟组重编号了没有** —— 抽走一个会留下 order 空洞。
 *
 *   两件事的共同点是：**不做的话，用户什么都没干，图上却多出一个错。**
 */
describe('deleteNode · 两种方式', () => {
  it('cascade：连同整个子树一起删掉', () => {
    const r = deleteNode(base(), 'a', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.outline.map((n) => n.id)).toEqual(['r', 'b', 'b1'])
    // 剩下的兄弟重新编号，不留空洞
    expect(childrenOf(r.outline, 'r')).toEqual(['乙'])
    expectClean(r.outline)
  })

  it('⚑ promote：子节点顶到被删节点【原来的位置】，不是挪到最后', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('b', 'r', 1, '乙'), // ← 被删的夹在中间
      node('c', 'r', 2, '丙'),
      node('b1', 'b', 0, '乙一'),
      node('b2', 'b', 1, '乙二'),
    ]
    const r = deleteNode(outline, 'b', 'promote')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // ⚑ "这一层没了，它的孩子补上来" —— 而不是"孩子们排到最后去"。
    //   两种都说得通，但前者符合直觉得多。
    expect(childrenOf(r.outline, 'r')).toEqual(['甲', '乙一', '乙二', '丙'])
    expectClean(r.outline)
  })

  it('promote 时子节点的顺序保持不变', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('p', 'r', 0, '父'),
      node('c2', 'p', 1, '老二'),
      node('c1', 'p', 0, '老大'),
    ]
    const r = deleteNode(outline, 'p', 'promote')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(childrenOf(r.outline, 'r')).toEqual(['老大', '老二'])
  })

  it('删根 = 清空整张图（cascade）', () => {
    const r = deleteNode(base(), 'r', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.outline).toEqual([])
  })

  it('id 不存在 → not_found', () => {
    expect(deleteNode(base(), '不存在', 'cascade')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('不修改传进来的数组（纯函数）', () => {
    const outline = base()
    const snapshot = JSON.parse(JSON.stringify(outline))
    deleteNode(outline, 'a', 'cascade')
    expect(outline).toEqual(snapshot)
  })
})

describe('deleteNode · 清理依赖引用 ⚑ 删除功能唯一的真风险', () => {
  it('⚑⚑ 删掉 X 之后，依赖 X 的节点必须【失去这条依赖】', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('x', 'r', 0, 'X'),
      node('y', 'r', 1, 'Y', { depends_on: ['x'] }),
    ]
    const r = deleteNode(outline, 'x', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const y = r.outline.find((n) => n.id === 'y')!
    expect(y.depends_on).toEqual([])

    // ⚑ 真正要验的：删完之后【不能冒出新的问题】。
    //   不清理的话这里会红，报 E_DANGLING_DEP ——
    //   而现实中它表现为"下游任务永远等着，界面上它就是个普通待办"。
    expectClean(r.outline)
  })

  it('⚑ cascade 时，依赖【子孙节点】的也要一起清理', () => {
    // ⚠️ 容易漏的一种：被删的是"甲"，但别人依赖的是"甲一"（甲的儿子）。
    //   级联删掉甲一之后，那条依赖同样悬空了。
    const outline = [
      node('r', null, 0, '根'),
      node('a', 'r', 0, '甲'),
      node('a1', 'a', 0, '甲一'),
      node('z', 'r', 1, 'Z', { depends_on: ['a1'] }),
    ]
    const r = deleteNode(outline, 'a', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.outline.find((n) => n.id === 'z')!.depends_on).toEqual([])
    expectClean(r.outline)
  })

  it('promote 时也要清理 —— 子节点留下了，被删的那个走了', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('p', 'r', 0, '父'),
      node('c', 'p', 0, '子'),
      node('z', 'r', 1, 'Z', { depends_on: ['p'] }),
    ]
    const r = deleteNode(outline, 'p', 'promote')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Z 依赖的是"父"，而"父"没了；"子"还在树。
    expect(r.outline.find((n) => n.id === 'z')!.depends_on).toEqual([])
    expectClean(r.outline)
  })

  it('只清掉【被删的那些】，别的依赖原样保留', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('keep', 'r', 0, '留着'),
      node('gone', 'r', 1, '删掉'),
      node('y', 'r', 2, 'Y', { depends_on: ['keep', 'gone'] }),
    ]
    const r = deleteNode(outline, 'gone', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.outline.find((n) => n.id === 'y')!.depends_on).toEqual(['keep'])
  })

  it('没有下游时不会乱改 depends_on', () => {
    const r = deleteNode(base(), 'a1', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.outline.every((n) => n.depends_on.length === 0)).toBe(true)
  })
})

describe('deleteImpact · 先看后果再动手', () => {
  const outline = [
    node('r', null, 0, '根'),
    node('a', 'r', 0, '甲'),
    node('a1', 'a', 0, '甲一'),
    node('a11', 'a1', 0, '甲一一'),
    node('y', 'r', 1, 'Y', { depends_on: ['a'] }),
    node('z', 'r', 2, 'Z', { depends_on: ['a11'] }),
  ]

  it('报出【全部后代】，不只是直接子节点', () => {
    const impact = deleteImpact(outline, 'a', 'cascade')!
    expect(impact.descendants.map((n) => n.id).sort()).toEqual(['a1', 'a11'])
    expect(impact.children.map((n) => n.id)).toEqual(['a1'])
  })

  it('⚑ 报出有几个节点的依赖会断 —— 而且口径要跟着模式走', () => {
    // cascade：甲和甲一甲一一都没了 → Y（依赖甲）和 Z（依赖甲一一）都受影响
    expect(deleteImpact(outline, 'a', 'cascade')!.dependents.map((d) => d.node.id).sort()).toEqual(
      ['y', 'z'],
    )
    // promote：只有甲没了，甲一甲一一还在 → 只有 Y 受影响
    expect(deleteImpact(outline, 'a', 'promote')!.dependents.map((d) => d.node.id)).toEqual(['y'])
  })

  it('查一个不存在的节点 → null，不抛', () => {
    expect(deleteImpact(outline, '不存在', 'cascade')).toBeNull()
  })
})

describe('deleteNode · 不能把图删裂', () => {
  it('⚑ 根 + 两个以上孩子时，不允许"子节点上移"（会裂成两棵树）', () => {
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲'), node('b', 'r', 1, '乙')]
    expect(deleteImpact(outline, 'r', 'promote')!.canPromote).toBe(false)
    expect(deleteNode(outline, 'r', 'promote')).toEqual({ ok: false, reason: 'multiple_roots' })
  })

  it('根只有一个孩子时可以上移 —— 那个孩子接任根', () => {
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲')]
    expect(deleteImpact(outline, 'r', 'promote')!.canPromote).toBe(true)

    const r = deleteNode(outline, 'r', 'promote')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.outline.map((n) => n.id)).toEqual(['a'])
    expect(r.outline[0].parent_id).toBeNull()
    expectClean(r.outline)
  })

  it('非根节点上移永远安全（它们顶到的是真实存在的上一层）', () => {
    expect(deleteImpact(base(), 'a', 'promote')!.canPromote).toBe(true)
    expect(deleteImpact(base(), 'a1', 'promote')!.canPromote).toBe(true)
  })
})

describe('deleteNode · 坏数据下不能出事', () => {
  it('⚑ 重复 id 的两条要一起删干净', () => {
    const outline = [
      node('r', null, 0, '根'),
      node('dup', 'r', 0, '先来的'),
      node('dup', 'r', 1, '后来的'),
    ]
    const r = deleteNode(outline, 'dup', 'cascade')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.outline.map((n) => n.id)).toEqual(['r'])
  })

  it('⚑ 数据带环时删节点不会转死（找后代要防环）', () => {
    const cyclic = [
      node('r', null, 0, '根'),
      node('x', 'y', 0, 'X'),
      node('y', 'x', 0, 'Y'),
    ]
    // 没有 seen 保护的话，descendantsOf 会沿着 x→y→x→y 一直转
    expect(() => deleteNode(cyclic, 'x', 'cascade')).not.toThrow()
  })

  it('⚑ 坏数据集上删任何节点都不崩', () => {
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    expect(() => {
      for (const n of corrupt.outline) {
        for (const mode of ['cascade', 'promote'] as const) {
          deleteNode(corrupt.outline, n.id, mode)
        }
      }
    }).not.toThrow()
  })
})

/**
 * ⚑ 穷举。理由和 moveNode 那组一样：手挑的用例只能覆盖想得到的情况，
 *   而"删了某个节点之后哪个兄弟组需要重编号"完全取决于它在树里的位置。
 */
describe('deleteNode · 在所有 mock 数据集上穷举', () => {
  for (const d of datasets.filter((x) => x.key !== 'corrupt-sample')) {
    it(`「${d.label}」：删任何一个节点 × 两种方式，结果都仍然合法`, () => {
      let ok = 0
      for (const n of d.outline) {
        for (const mode of ['cascade', 'promote'] as const) {
          const r = deleteNode(d.outline, n.id, mode)
          if (!r.ok) continue
          ok++
          expectClean(r.outline, `删「${n.title}」(${mode}) 之后，`)
        }
      }
      expect(ok, '一次成功的删除都没有，这个穷举等于没跑').toBeGreaterThan(0)
    })
  }
})

/* ── 给"不用拖也能改"的界面用的查询 ───────────────────────── */

describe('possibleParents', () => {
  it('排除自己', () => {
    expect(possibleParents(base(), 'a').map((n) => n.id)).not.toContain('a')
  })

  it('⚑ 排除自己的所有后代 —— 深层也要，不只看直接儿子', () => {
    const outline = [
      node('a', null, 0, '甲'),
      node('a1', 'a', 0, '甲一'),
      node('a11', 'a1', 0, '甲一一'),
      node('z', null, 1, '别的'),
    ]
    expect(possibleParents(outline, 'a').map((n) => n.id)).toEqual(['z'])
  })

  it('⚑ 祖先不会被排除 —— 挂回自己原来的爸爸是合法的（那是改顺序）', () => {
    // ⚠️ 这里容易想错：'a' 是 'a1' 的爸爸，也就是 a1 的【祖先】。
    //    祖先和后代是【相反】的方向 —— 危险的只有"往下钻"，"往上传"没事。
    //    挂回原来的爸爸只是换个位置，是完全合法的操作。
    expect(possibleParents(base(), 'a1').map((n) => n.id).sort()).toEqual(
      ['a', 'a2', 'b', 'b1', 'r'].sort(),
    )
  })

  it('id 不存在 → 空数组，不崩', () => {
    expect(possibleParents(base(), '不存在')).toEqual([])
  })
})

describe('siblingsOf', () => {
  it('按 order 排好', () => {
    expect(childrenOf(base(), 'a')).toEqual(['甲一', '甲二'])
  })

  it('传 null 拿的是根节点', () => {
    expect(siblingsOf(base(), null).map((n) => n.title)).toEqual(['根'])
  })
})

describe('nodePath', () => {
  it('从根拼到该节点，用 / 分隔', () => {
    expect(nodePath(base(), 'a1')).toBe('根 / 甲 / 甲一')
    expect(nodePath(base(), 'r')).toBe('根')
  })

  it('⚑ 坏数据带环时不死循环', () => {
    const cyclic = [node('x', 'y', 0, 'X'), node('y', 'x', 0, 'Y')]
    expect(() => nodePath(cyclic, 'x')).not.toThrow()
  })

  it('id 不存在 → 空串，不崩', () => {
    expect(nodePath(base(), '不存在')).toBe('')
  })
})
