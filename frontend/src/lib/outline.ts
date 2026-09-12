/**
 * 扁平数组 → 树。**纯函数，不依赖 React**（附录 A 的 F2 模式）。
 *
 * ⚑ 为什么需要这一层：存储是扁平的（ADR-4：规避递归 schema、天然可 diff、
 *   `depends_on` 本就是图），但布局算法吃的是嵌套树。中间必须有人重建结构。
 *
 * ⚠️ 注意它与 Python 侧 `planner/outline.py` 【不是同一个算法】：
 *
 *     Python outline.py   输入 level（模型原文）    → 栈组装
 *     本文件               输入 parent_id（已存数据） → 挂载
 *
 *   方向也不同：一个在【写】的时候组装，一个在【读】的时候重建。
 *   别把两者当成重复实现去合并 —— 它们处理的是不同的数据表示。
 *
 * ⚑ 本模块的一半代码在处理【坏数据】。为什么值得：
 *   生成器产出的 outline 天然是好的，但 §5.3 允许【人工拖拽调层级】，
 *   人把 A 拖进 B、又把 B 拖进 A，环就出来了。所以读取期校验不是防御性编程，
 *   是必需的。
 */
import type {
  DisplayState,
  NodeId,
  NodeStatus,
  OutlineNode,
  StructureIssue,
} from '../types/outline'

/** 树节点：原数据 + 它的孩子。布局算法（D3）吃这个结构。 */
export interface TreeNode {
  node: OutlineNode
  children: TreeNode[]
}

export interface BuildResult {
  /** 能连到根的节点组装的树。正常情况 1 棵；多根坏数据下会有多棵。 */
  roots: TreeNode[]
  /**
   * 挂不上主树的节点（parent_id 指向不存在，或身处环中）。
   *
   * ⚑ 不要 `filter` 掉它们就完事。原则：
   *   【对用户数据，宁可显式显示异常，也不要静默丢弃。】
   *   静默丢弃会让用户看到"内容凭空消失，且无从知道发生过什么"。
   *   正确做法是把它们渲染成带错误角标的游离节点。
   */
  detached: OutlineNode[]
  issues: StructureIssue[]
}

/* ── 内部：判断一个节点能否连到根 ─────────────────────────── */

type Reach =
  | { kind: 'rooted' }
  | { kind: 'orphan'; missing: NodeId }
  | { kind: 'cycle' }

/**
 * 沿 parent_id 向上走，判断这个节点能否到达根。
 *
 * ⚑ 关键简化：`parent_id` 是【单指针】而不是数组，所以每个节点向上的路
 *   【只有一条】。这让环检测变得极简单 —— 不需要 DFS 三色标记，也不需要
 *   拓扑排序（那是 depends_on 那种任意图才需要的，见 §7.2）。
 *
 *   走到 null  → 通了
 *   走到走过的节点 → 一定在环里
 *
 * 复杂度 O(深度)，最坏 O(n)。对整个数组跑一遍是 O(n²)。
 * 文档说规模 20–200 节点（§4.3），200² = 4 万次操作，**不值得为它做记忆化**。
 * 上千节点才需要缓存，那时也该换节点表了（§4.3 已写明这个阈值）。
 */
function classify(start: OutlineNode, byId: Map<NodeId, OutlineNode>): Reach {
  const onPath = new Set<NodeId>()
  let cur = start

  for (;;) {
    const parentId = cur.parent_id

    // ① 走到根 —— 通了
    if (parentId === null) return { kind: 'rooted' }

    // ② 绕回了自己走过的节点 —— 在环里
    if (onPath.has(cur.id)) return { kind: 'cycle' }
    onPath.add(cur.id)

    // ③ 父节点不存在 —— 孤儿
    const parent = byId.get(parentId)
    if (!parent) return { kind: 'orphan', missing: parentId }

    cur = parent
  }
}

/* ── 主函数 ───────────────────────────────────────────────── */

export function buildTree(outline: OutlineNode[]): BuildResult {
  const issues: StructureIssue[] = []

  /* ── 第 1 步：建 id 索引，顺带抓重复 id ──────────────────
   * 顺序很重要：必须【先】检测再 set。
   * Map 遇到重复 key 是【静默覆盖】的 —— 不检测的话两个同 id 节点会
   * 悄悄变成一个，后面所有引用都指向后者。这种 bug 不报错，
   * 只是渲染少一个节点，能 debug 到天亮。 */
  const byId = new Map<NodeId, OutlineNode>()
  for (const n of outline) {
    if (byId.has(n.id)) {
      issues.push({
        severity: 'error',
        node_id: n.id,
        code: 'E_DUPLICATE_ID',
        message: `节点 id 重复：${n.id} —— 保留先出现的，后出现的被忽略`,
      })
      continue
    }
    byId.set(n.id, n)
  }

  /* ── 第 2 步：给每个唯一节点包一层空壳 ────────────────
   * 先建全部空壳、再挂载，是为了让"父节点还没被处理到"不影响结果。
   * 数组顺序是任意的（扁平存储不保证拓扑序），不能假设父先出现。 */
  const shellById = new Map<NodeId, TreeNode>()
  for (const n of byId.values()) {
    shellById.set(n.id, { node: n, children: [] })
  }

  /* ── 第 3 步：分类 + 挂载 ────────────────────────────── */
  const roots: TreeNode[] = []
  const detached: OutlineNode[] = []

  for (const n of byId.values()) {
    const r = classify(n, byId)

    if (r.kind !== 'rooted') {
      // 每个坏节点各报一条 issue。这不是噪声 —— §7.1 的 issue 本来就
      // 带 node_id、是【按节点】的，因为 UI 要在每个受影响的节点上挂角标。
      // 所以一个 3 节点组成的环报 3 条 E_CYCLE_PARENT 是正确的。
      issues.push(
        r.kind === 'orphan'
          ? {
              severity: 'error',
              node_id: n.id,
              code: 'E_ORPHAN_PARENT',
              message: `parent_id "${r.missing}" 不存在`,
            }
          : {
              severity: 'error',
              node_id: n.id,
              code: 'E_CYCLE_PARENT',
              message: '沿 parent_id 向上走回到了自己，该节点处于环中',
            },
      )
      detached.push(n)
      continue
    }

    const shell = shellById.get(n.id)!
    if (n.parent_id === null) {
      roots.push(shell)
    } else {
      // 能连到根 ⇒ 父节点必然也存在且也能连到根，所以 ! 是安全的
      shellById.get(n.parent_id)!.children.push(shell)
    }
  }

  /* ── 第 4 步：排序 + 校验 order（§4.2 的连续约束）────────
   * Array.sort 自 ES2019 起保证【稳定】，所以 order 相同的兄弟会保持
   * 它们在原数组里的相对顺序 —— 结果至少是确定的，不会每次刷新都变。 */
  for (const shell of shellById.values()) {
    if (shell.children.length === 0) continue

    shell.children.sort((a, b) => a.node.order - b.node.order)

    const actual = shell.children.map((c) => c.node.order)
    const ok = actual.every((v, i) => v === i)
    if (!ok) {
      // 一行断言同时抓【重复】和【空洞】—— 这是"约束越强、校验越简单"的典型。
      issues.push({
        severity: 'warning',
        node_id: shell.node.id,
        code: 'W_ORDER_INVALID',
        message:
          `子节点 order 应为 [0..${shell.children.length - 1}]，` +
          `实际为 [${actual.join(', ')}]`,
      })
    }
  }

  // 多根时让根之间也有确定顺序，而不是依赖 Map 的迭代顺序
  roots.sort((a, b) => a.node.order - b.node.order)

  /* ── 第 5 步：根数量校验 ────────────────────────────────
   * ⚠️ 注意空数组是 0 个根，不是"错误"——别写成 roots.length !== 1 就抛。
   *    §8.3 种子 #10（「最近有点烦」）正常就只出 1 个根，
   *    而空输入应当安静地返回空结果。 */
  if (roots.length > 1) {
    issues.push({
      severity: 'error',
      node_id: null,
      code: 'E_MULTIPLE_ROOTS',
      message: `根节点有 ${roots.length} 个，应为 1 个`,
    })
  }

  return { roots, detached, issues }
}

/* ── 容器节点的状态汇总 ───────────────────────────────────── */

/**
 * 把一组子节点的状态汇总成父节点的状态。
 *
 * ⚑ 为什么容器需要汇总，而不是自己有事推：
 *   「准备一次日本关西七日游」这种**分组节点**不是可执行任务 ——
 *   调度器不会去"执行"它（见 simulation.ts 的 containers 判断）。
 *   但它又必须有个状态显示给用户。**没有汇总的话它会永远停在初始值。**
 *
 * ⚑ 为什么是【派生】而不是【存下来】：
 *   存下来就会漂移 —— 父节点说 done 而子任务还没做完。
 *   派生则永远不会不一致，因为它是算出来的。
 *
 * ⚑ 判断顺序就是优先级：
 *
 *     1. 有 failed        → failed     ← 【最高】有未处理的失败，整体就不算好
 *     2. 有 running       → running
 *     3. 全 done / skipped → done      ← skipped 算"已了结"（见下）
 *     4. 全 todo          → todo
 *     5. 其余             → running    （部分了结 + 部分未开工 = 进行中）
 *
 *   **为什么 failed 压过 running**：下面的子任务还在跑、上面有一个失败了，
 *   显示 running 会让人以为一切正常。**把异常顶到用户眼前是这项目的产品立场**
 *   （和"坏数据显式显示不静默丢弃"是同一条原则）。
 *
 *   **为什么 skipped 算已了结**：skipped 只应来自「用户有意放弃」
 *   或「从用户放弃级联而来」（见 simulation.ts）。既然是人接受的，
 *   父节点就该算完成 —— 但注意【完成度百分比仍按 done 计】，
 *   "了结了"和"都做完了"不是同一件事，两个数字都真实。
 */
export function combineStatus(children: NodeStatus[]): NodeStatus {
  if (children.length === 0) return 'todo'
  if (children.some((s) => s === 'failed')) return 'failed'
  if (children.some((s) => s === 'running')) return 'running'
  if (children.every((s) => s === 'done' || s === 'skipped')) return 'done'
  if (children.every((s) => s === 'todo')) return 'todo'
  return 'running'
}

/**
 * 为一棵树里的【每个】节点算出展示状态。
 *
 * 叶子节点用自己存储的 `status`；容器节点用子节点的汇总。
 * 返回 Map<nodeId, NodeStatus>，调用方据此覆盖展示值 —— **不改原数据**。
 *
 * 单次自底向上遍历，O(n)。
 */
export function rollupStatuses(roots: TreeNode[]): Map<string, NodeStatus> {
  const out = new Map<string, NodeStatus>()

  const walk = (t: TreeNode): NodeStatus => {
    const status =
      t.children.length === 0
        ? t.node.status
        : combineStatus(t.children.map(walk))
    out.set(t.node.id, status)
    return status
  }

  for (const r of roots) walk(r)
  return out
}

/* ── 质量门禁的唯一闸门（§7.1） ───────────────────────────── */

/**
 * `error` 阻断，`warning` 提示但放行。
 * ⚑ §7.1 明说 `hasBlockingIssue()` 是【唯一】闸门 —— 所有地方都调它，
 *   不要在别处自己写 `issues.some(i => i.severity === 'error')`。
 */
export function hasBlockingIssue(issues: StructureIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

/* ── 视图模型 ─────────────────────────────────────────────── */

/**
 * 把 `status` + `approval` 合成一个【展示用】状态。
 *
 * ⚑ 这就是"存储模型 / 视图模型分层"落地的地方（见 types/outline.ts 的说明）：
 *   后端只管存两个正交的事实，前端负责算出一个用户看得懂的处境。
 *
 * 优先级的两个判断，各挡一个 bug：
 *
 *   ① pending 优先 —— 正在等确认时，节点必然还没开始跑，
 *      显示"等你确认"比显示 todo 有用得多。
 *
 *   ② rejected 要加 `status === 'todo'` 护栏 —— 【这是个真 bug 的修复】。
 *      用户拒绝后存储是 assignee=user + status=todo；
 *      等用户自己把事情办完，status 变成 done，而 approval.status 仍然是
 *      rejected（它是审计事实，不能清）。没有这个护栏的话，
 *      一个【已完成】的任务会永远显示"被拒绝"。
 */
export function displayState(n: OutlineNode): DisplayState {
  if (n.approval?.status === 'pending') return 'awaiting_confirmation'
  if (n.approval?.status === 'rejected' && n.status === 'todo') return 'rejected'
  return n.status
}
