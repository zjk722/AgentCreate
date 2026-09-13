/**
 * 拖拽改结构 —— 纯逻辑，不依赖 React。
 *
 * ⚑ 为什么单独一个文件：**"能不能拖"是界面问题**（难测，得开浏览器），
 *   但**"挪完数据结构还对不对"是纯逻辑问题**（好测，毫秒级）。
 *   把后者抽出来，就能为它写一堆测试 —— 包括下面那个"差一位"的陷阱。
 *   混在组件里的话，想测这一条得先起一个浏览器。
 *
 * ── 文档出处（§5.3 的两个手势）───────────────────────────────
 *
 *     拖 X 放到 Y【身上】      → X 的 parent_id = Y    → X 成为 Y 的孩子（调层级）
 *     拖 X 放到 Y 之后的缝隙    → X 的 order + 同组重编号 → X 成为 Y 的兄弟（调顺序）
 *
 *   文档特意警告过一句，也是本模块最要紧的一条：
 *
 *     ⚠️ 跨父移动 = **两组都要重编号**：旧父的孩子组摘掉一个、
 *        新父的孩子组插入一个。只改一组会留下 order 空洞
 *        （触发 §7.2 的 W_ORDER_INVALID）。
 *
 * ── 用大白话说"重编号"是什么 ────────────────────────────────
 *
 *   想象两排人在排队，每个人手里有个号码牌（0、1、2……）。
 *
 *     ① 把甲从第一排拉走 → 他【后面的人要往前补一步】，
 *        不然队伍中间空出一个位置。
 *     ② 把甲插进第二排 → 那排他【后面的人要往后退一步】让位置。
 *
 *   只做一半，队形就破了。队形破了就是坏数据。
 */
import type { NodeId, OutlineNode } from '../types/outline'

/** 落点在目标节点的哪个位置 */
export type DropPosition =
  /** 插到目标【前面】，成为它的兄弟 */
  | 'before'
  /** 插到目标【后面】，成为它的兄弟 */
  | 'after'
  /** 变成目标的【孩子】—— 调层级 */
  | 'child'

/**
 * 这次移动为什么不做。
 *
 * ⚑ 用"返回原因"而不是"抛异常"：拖拽是高频交互，拖错位置是**正常操作**，
 *   不是程序出错。用异常表达正常流程，会把真正的 bug 淹没在噪声里。
 */
export type EditRejection =
  /** 拖到了自己身上 */
  | 'self'
  /** 拖进了自己的后代 —— 会绕成一个圈 */
  | 'descendant'
  /**
   * 会造出第二个根。
   *
   * 只有一种情况：插到【根节点】的前面/后面 —— 那等于挂到"没有爸爸"下面，
   * 自己也变成根，图就裂成两棵树了（§7.2 的 E_MULTIPLE_ROOTS）。
   */
  | 'multiple_roots'
  /** 位置没变（拖回原地）*/
  | 'noop'
  /** id 在数据里不存在 */
  | 'not_found'

export type EditResult = { ok: true; outline: OutlineNode[] } | { ok: false; reason: EditRejection }

/**
 * 把 draggedId 挪到 targetId 的指定位置。
 *
 * 返回**新数组**，不改传进来的那个 —— 和这个项目里其他 lib 一样是纯函数。
 */
export function moveNode(
  outline: OutlineNode[],
  draggedId: NodeId,
  targetId: NodeId,
  position: DropPosition,
): EditResult {
  if (draggedId === targetId) return { ok: false, reason: 'self' }

  const byId = new Map(outline.map((n) => [n.id, n]))
  const dragged = byId.get(draggedId)
  const target = byId.get(targetId)
  if (!dragged || !target) return { ok: false, reason: 'not_found' }

  // 挪过去之后，谁是它的新爸爸？
  //   当孩子 → 爸爸就是目标本身
  //   当兄弟 → 爸爸是目标的爸爸
  const newParentId = position === 'child' ? target.id : target.parent_id

  // ── 护栏①：不许造出第二个根 ──────────────────────────────
  //
  // 大白话：**目标没有爸爸的时候，你自己就会变成根。**
  // "插到根节点的前面/后面" = 挂到根的爸爸下面 = 挂到"没有"下面 = 你也成了根，
  // 于是这张图变成两棵树（触发 E_MULTIPLE_ROOTS，§7.2 的读取期错误）。
  //
  // ⚑ 为什么不去"猜"用户其实想当根的第一个孩子：那是猜测，
  //   而本项目的立场是【遇到冲突，让人决定，不要替人猜】（§5.3）。
  //   界面那边会把根节点的上/下两段直接去掉，用户根本碰不到这个死区。
  //
  // ⚠️ 这条是穷举测试抓出来的 —— 手挑的用例全都没想起来"目标是根"这种情况。
  if (newParentId === null) return { ok: false, reason: 'multiple_roots' }

  // ── 护栏②：不许绕成圈 ────────────────────────────────────
  //
  // 大白话：**不能把爸爸塞进儿子的口袋。** 一旦塞进去，父子关系就绕成一个环，
  // 这个家族谁都到不了祖先，整支就从图上"飘"走了（触发 E_CYCLE_PARENT）。
  //
  // 两种情况都要拦：
  //   · 新爸爸就是自己 —— 把 X 插到自己孩子的旁边，X 的爸爸就变成了 X
  //   · 新爸爸在自己的后代里 —— 就是"塞进儿子口袋"
  if (newParentId === draggedId || isUnder(byId, newParentId, draggedId)) {
    return { ok: false, reason: 'descendant' }
  }

  // ── 算新位置 ──────────────────────────────────────────────
  //
  // ⚠️ 顺序很关键：**先把甲从队伍里拉出来，再在新队伍里找他该站的位置。**
  //    反过来（先算位置再拉走）在同一排内挪动时会【差一位】——
  //    因为算位置时甲还在队里占着一个位子。
  //    这是本模块最容易写错的一处，测试里专门钉了一条。
  const rest = siblingsOf(outline, newParentId, draggedId)

  let insertAt: number
  if (position === 'child') {
    insertAt = rest.length // 当孩子 = 追加到末尾（不插队）
  } else {
    const idx = rest.findIndex((n) => n.id === targetId)
    // 走到这里说明目标不在它自己的兄弟组里 —— 数据坏了
    if (idx === -1) return { ok: false, reason: 'not_found' }
    insertAt = position === 'before' ? idx : idx + 1
  }

  const ordered = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)]
  const newOrder = new Map(ordered.map((n, i) => [n.id, i]))
  const newIndex = newOrder.get(draggedId)!

  // ── 护栏②：拖回原地不算改动 ───────────────────────────────
  //
  // ⚑ 必须显式拦掉。放过去的话，会"成功地"什么都没改 ——
  //   而真实系统里那次写入会把 revision 加一，
  //   于是别人基于旧版本做的编辑全部作废（§5.3 的 409）。
  //   **为了零改动的操作去作废别人的工作，是纯粹的伤害。**
  if (dragged.parent_id === newParentId && dragged.order === newIndex) {
    return { ok: false, reason: 'noop' }
  }

  // ── 旧队伍也要重编 ────────────────────────────────────────
  //
  // ⚠️ 同组内挪动时，"旧队伍"和"新队伍"是同一支，newOrder 已经覆盖了，
  //    再算一遍会打架。所以这里只在【真的换了爸爸】时才算。
  const oldOrder = new Map<NodeId, number>()
  if (dragged.parent_id !== newParentId) {
    siblingsOf(outline, dragged.parent_id, draggedId).forEach((n, i) => oldOrder.set(n.id, i))
  }

  const next = outline.map((n) => {
    // 被拖的那个：换爸爸 + 换号码
    if (n.id === draggedId) return { ...n, parent_id: newParentId, order: newIndex }
    // 新队伍里的其他人：让位
    const no = newOrder.get(n.id)
    if (no !== undefined) return { ...n, order: no }
    // 旧队伍里的其他人：补位
    const oo = oldOrder.get(n.id)
    if (oo !== undefined) return { ...n, order: oo }
    return n
  })

  return { ok: true, outline: next }
}

/* ── 给"不用拖也能改"的界面用的查询 ─────────────────────────── */

/**
 * 这个节点能挂到哪些节点下面。
 *
 * ⚑ 为什么界面需要它：拖拽对一部分人来说是做不到的 —— 用键盘的人、
 *   手抖的人、用屏幕阅读器的人。无障碍规范（WCAG 2.2 AA 的
 *   "dragging-alternative"）要求：**凡是能拖的，都必须另有一条
 *   不用拖也能走的路。** 这个函数就是那条路的数据来源。
 *
 * 排除自己 + 自己的后代 —— 理由同护栏②：挂下去会成环。
 */
export function possibleParents(outline: OutlineNode[], nodeId: NodeId): OutlineNode[] {
  const byId = new Map(outline.map((n) => [n.id, n]))
  if (!byId.has(nodeId)) return []
  return outline.filter((n) => n.id !== nodeId && !isUnder(byId, n.id, nodeId))
}

/**
 * 同一个父亲下的兄弟，按 order 排好。传 `null` 拿的是所有根节点。
 *
 * ⚑ 为什么必须**按 id 去重** —— 这是修一个真 bug 时加的，**测试抓出来的**：
 *
 *   数据可能带重复 id（§7.2 的 `E_DUPLICATE_ID`）。不去重的话，
 *   重复的那条会占掉一个编号位，而它【又不在树上】
 *   （buildTree 只保留先出现的那个）——
 *   结果真正在树上的那几个兄弟被编出一个空洞，凭空多出一条 `W_ORDER_INVALID`。
 *
 *   ⚑ 要命的是：**那个空洞是我们重编号时自己造的。**
 *      用户什么都没干，只是拖了一下，图上却多了一个错。
 *      数据本来就有病，不是我们让它更病的理由。
 *
 *   去重规则与 `buildTree` 一致：**按数组顺序，先出现的赢**（然后再按 order 排序）。
 *
 * @param exclude 要摘出去的那个节点（改顺序时得先把"正在被搬的那个"拿开再数）
 */
export function siblingsOf(
  outline: OutlineNode[],
  parentId: NodeId | null,
  exclude?: NodeId,
): OutlineNode[] {
  const seen = new Set<NodeId>()
  const out: OutlineNode[] = []

  for (const n of outline) {
    if (n.parent_id !== parentId || n.id === exclude) continue
    if (seen.has(n.id)) continue // 先出现的赢，和 buildTree 同一条规则
    seen.add(n.id)
    out.push(n)
  }

  return out.sort(byOrder)
}

/**
 * 节点的完整路径，如「准备关西七日游 / 预订安排 / 大阪酒店」。
 *
 * ⚑ 为什么需要：下拉框里光列标题的话，两个都叫「预订酒店」的节点
 *   根本分不出哪个是哪个。**让用户在两个一模一样的选择里猜，是界面在偷懒。**
 */
export function nodePath(outline: OutlineNode[], nodeId: NodeId): string {
  const byId = new Map(outline.map((n) => [n.id, n]))
  const parts: string[] = []
  const seen = new Set<NodeId>()
  let cur = byId.get(nodeId)

  while (cur && !seen.has(cur.id)) {
    parts.unshift(cur.title)
    seen.add(cur.id)
    cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id)
  }

  return parts.join(' / ')
}

/* ── 删除节点 ─────────────────────────────────────────────── */

/**
 * 删除的两种方式。
 *
 *   `cascade`  连同整棵子树一起删掉
 *   `promote`  子节点【上移一层】，顶到被删节点原来的位置
 *
 * ⚑ 为什么必须有 `promote`：删掉一个中间层是很常见的操作
 *   （"这个分组不要了，但里面的任务留着"）。只有 cascade 的话，
 *   用户为了删一个分组得先把每个子节点手工搬走 —— 那还不如不删。
 *
 * ⚑ 为什么是【用户选】而不是我们替他定：两个都合理，取决于他想干什么。
 *   这正是 §5.3 那条 —— **遇到冲突，让人决定，不要替人猜。**
 */
export type DeleteMode = 'cascade' | 'promote'

/**
 * 删一个节点会波及什么。
 *
 * ⚑ **先查影响，再动手** —— 这是 §5.3 的「提案 / 应用分离」用在人工编辑上。
 *   文档里那个例子是 AI 改稿时的「将新增 3 个节点，删除 1 个」；
 *   人自己删的时候，同样得先看见后果。
 */
export interface DeleteImpact {
  node: OutlineNode
  /** 它下面的【所有】后代（不只是直接子节点） */
  descendants: OutlineNode[]
  /** 直接子节点 */
  children: OutlineNode[]
  /**
   * 依赖它的节点 —— 删掉之后这些依赖会【断掉】。
   *
   * ⚑ 这一项是删除功能的**要害**。删掉 X 却不管引用的话，
   *   所有 `depends_on` 里写着 X 的节点立刻变成 `E_DANGLING_DEP`（§7.2 第 ③ 组）——
   *   也就是"依赖悬空 → 任务永远等着 → 界面什么都不显示"。
   *
   *   **那正是我们刚花一整轮修掉的那个 bug。**
   *   而这几份 mock 里那条悬空依赖的注释，写的就是
   *   「AI 的操作列表里删掉了一个节点，却忘了清理引用它的依赖」——
   *   删除功能就是这个场景的源头。
   */
  dependents: { node: OutlineNode; lost: NodeId[] }[]
  /**
   * 能不能"子节点上移一层"。
   *
   * ⚠️ 只有一种情况不行：被删的是**根节点、且它有 2 个以上孩子** ——
   *   上移之后那几个都会变成根，图就裂成两棵了（`E_MULTIPLE_ROOTS`）。
   */
  canPromote: boolean
}

/** 查出"删了它会怎样"。不改数据，只报告。 */
export function deleteImpact(
  outline: OutlineNode[],
  nodeId: NodeId,
  mode: DeleteMode,
): DeleteImpact | null {
  const node = outline.find((n) => n.id === nodeId)
  if (!node) return null

  const children = siblingsOf(outline, nodeId)
  const descendants = descendantsOf(outline, nodeId)

  // 这次删除要拿掉哪些 id —— 依赖检查的口径必须和它一致，否则报出来的
  // "会有几个节点失去依赖"就是假的
  const doomed = new Set<NodeId>([nodeId])
  if (mode === 'cascade') for (const d of descendants) doomed.add(d.id)

  const dependents: DeleteImpact['dependents'] = []
  for (const n of outline) {
    if (doomed.has(n.id)) continue
    const lost = n.depends_on.filter((d) => doomed.has(d))
    if (lost.length > 0) dependents.push({ node: n, lost })
  }

  return {
    node,
    descendants,
    children,
    dependents,
    canPromote: node.parent_id !== null || children.length <= 1,
  }
}

/**
 * 删掉一个节点。
 *
 * ⚑ 真正的工作量**不在"把它从数组里拿掉"**（那是一行 `filter`），
 *   而在后面两件事：
 *
 *     ① **清理引用** —— 否则立刻造出 E_DANGLING_DEP，任务永远等着
 *     ② **兄弟组重编号** —— 抽走一个会在那组里留下 order 空洞
 *
 *   这两件事都是"不做的话，用户什么都没干、图上却多出一个错"。
 */
export function deleteNode(
  outline: OutlineNode[],
  nodeId: NodeId,
  mode: DeleteMode,
): EditResult {
  const impact = deleteImpact(outline, nodeId, mode)
  if (!impact) return { ok: false, reason: 'not_found' }

  if (mode === 'promote' && !impact.canPromote) {
    // 上移会让图裂成两棵 —— 和 moveNode 里的护栏同一条理由
    return { ok: false, reason: 'multiple_roots' }
  }

  const { node, descendants, children } = impact

  // ── ① 哪些 id 会消失 ────────────────────────────────────
  // ⚠️ 按 id 而不是按下标 —— 数据可能带重复 id，两份都得删干净
  const doomed = new Set<NodeId>([nodeId])
  if (mode === 'cascade') for (const d of descendants) doomed.add(d.id)

  // ── ② 上移：子节点换个爸爸（它们本身不删）──────────────
  const newParent = new Map<NodeId, NodeId | null>()
  if (mode === 'promote') for (const c of children) newParent.set(c.id, node.parent_id)

  // ── ③ 幸存者 ────────────────────────────────────────────
  const survivors = outline
    .filter((n) => !doomed.has(n.id))
    .map((n) => (newParent.has(n.id) ? { ...n, parent_id: newParent.get(n.id)! } : n))

  // ── ④ 清理依赖引用 ─────────────────────────────────────
  // ⚑ **这一步是删除功能的要害，不是收尾工作。**
  //   省掉它，被删节点下游那些任务会永远等着，而界面上它们只是
  //   普普通通的「待办」—— 正是 §14.2 #13 说的静默失败。
  const cleaned = survivors.map((n) =>
    n.depends_on.some((d) => doomed.has(d))
      ? { ...n, depends_on: n.depends_on.filter((d) => !doomed.has(d)) }
      : n,
  )

  // ── ⑤ 兄弟组重编号 ─────────────────────────────────────
  // ⚠️ 只重编【被删节点的原父亲那一组】。其余组一个节点都没动 ——
  //   去碰它们就等于顺手改了用户没让改的东西。
  const parentId = node.parent_id
  const at = siblingsOf(outline, parentId).findIndex((s) => s.id === nodeId)
  const rest = siblingsOf(outline, parentId, nodeId)
  const promoted = mode === 'promote' ? children : []

  // ⚑ 上移的子节点顶在被删节点【原来的位置】上，而不是追加到末尾 ——
  //   "这一层没了，它的孩子补上来"比"孩子们挪到最后去"符合直觉得多。
  const sequence =
    at < 0 ? [...rest, ...promoted] : [...rest.slice(0, at), ...promoted, ...rest.slice(at)]

  const orderById = new Map(sequence.map((n, i) => [n.id, i]))

  return {
    ok: true,
    outline: cleaned.map((n) => {
      const o = orderById.get(n.id)
      return o === undefined ? n : { ...n, order: o }
    }),
  }
}

/* ── 内部 ─────────────────────────────────────────────────── */

function byOrder(a: OutlineNode, b: OutlineNode): number {
  return a.order - b.order
}

/**
 * 从某个节点往下走，收集它的**全部后代**（不只是直接子节点）。
 *
 * ⚠️ 两个细节都是为坏数据准备的，各自挡一种死法：
 *
 *   · `seen` 里**先把起点放进去** —— 数据可能带环（`E_CYCLE_PARENT`），
 *     没有它就是死循环，页面直接卡死。
 *   · 用**广度优先 + 队列**而不是递归 —— 一条 200 层的链会把调用栈打爆，
 *     而 §4.3 说规模上限正好是 200。
 */
function descendantsOf(outline: OutlineNode[], rootId: NodeId): OutlineNode[] {
  // 先按"父 → 孩子们"建个索引，免得每层都全表扫一遍
  const kidsOf = new Map<NodeId, OutlineNode[]>()
  for (const n of outline) {
    if (n.parent_id === null) continue
    const list = kidsOf.get(n.parent_id)
    if (list) list.push(n)
    else kidsOf.set(n.parent_id, [n])
  }

  const out: OutlineNode[] = []
  const seen = new Set<NodeId>([rootId])
  const queue: NodeId[] = [rootId]

  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const kid of kidsOf.get(cur) ?? []) {
      if (seen.has(kid.id)) continue // 重复 id 或成环，都靠这一句兜住
      seen.add(kid.id)
      out.push(kid)
      queue.push(kid.id)
    }
  }

  return out
}

/**
 * nodeId 是 ancestorId 的后代吗？
 *
 * ⚑ 只需【往上走】：`parent_id` 是单指针，一个节点只有一个爸爸，
 *   所以从下往上爬一条线就够了 —— 不需要 DFS 三色标记或拓扑排序
 *   （那是 `depends_on` 那种任意有向图才需要的，见 lib/outline.ts）。
 *
 * ⚠️ 那个 `seen` 不是多余的：**数据本身可能已经带环**。
 *   本项目就故意带了一份坏数据样本（corrupt-sample 里有 X→Y→X）。
 *   没有这个保护，用户在坏数据上拖一下就会让页面转死。
 */
function isUnder(byId: Map<NodeId, OutlineNode>, nodeId: NodeId, ancestorId: NodeId): boolean {
  const seen = new Set<NodeId>()
  let cur = byId.get(nodeId)

  while (cur && cur.parent_id !== null) {
    if (cur.parent_id === ancestorId) return true
    if (seen.has(cur.id)) return false // 本来就成环，别再转了
    seen.add(cur.id)
    cur = byId.get(cur.parent_id)
  }

  return false
}
