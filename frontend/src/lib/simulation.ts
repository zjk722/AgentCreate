/**
 * 模拟执行推进 —— 本 demo 用来让「任务图是状态面板」这件事看得见（§1.2）。
 *
 * ⚑ 这不是随便把节点涂绿。它严格按 §5.2 的执行时序与 §9.2 的审批分级：
 *
 *   1. running 的任务 ──▶ done（产出证据 + 摘要）
 *   2. 依赖已满足的 todo ──▶ running（受 Semaphore(maxParallel) 限制，§NFR-2）
 *
 *   ⚑ **只有两步。** 原来还有第 3 步「上游被放弃 → 下游自动 skipped」，
 *     2026-09-20 删掉了 —— 它替用户做了决定。删掉的理由写在 `advance()` 里，
 *     下游现在的去处是 `awaitingDecisionIds()` 的「待你决定」。
 *
 *   并且【拒绝】推进这些节点：
 *
 *   · `approval.status === 'pending'` —— §9.2：审批没过就不许执行
 *   · `assignee !== 'agent'`          —— 归人的、卡住的，Agent 不碰
 *   · 有子节点的容器节点               —— 它不是任务，是分组
 *
 * ⚑ 所以「日本关西七日游」那份数据集按一次「开始执行」下来，
 *   几乎推不动 —— 这是【正确答案】，不是 demo 坏了：
 *   两个 Agent 任务在等用户点头，一个依赖「决定出行日期」（人做的）。
 *   界面上该显示的是"卡在哪、要你做什么"，而不是硬着头皮往前跑。
 *
 * 纯函数：输入 outline，返回新的 outline；无进展时返回 null（调用方据此停表）。
 */
import type { Evidence, OutlineNode } from '../types/outline'

/** 一个节点跑完会产出什么 —— mock 数据里预置。 */
export interface ExecutionOutcome {
  tool: string
  args?: Record<string, unknown>
  result_summary: string
  elapsed_ms: number
}

/** nodeId → 产出。没有条目的节点用兜底产出。 */
export type ExecutionPlan = Record<string, ExecutionOutcome>

export interface AdvanceOptions {
  /** 最多几个任务并行（§NFR-2：单图最多 6 个） */
  maxParallel: number
  /** 每个 tick 最多完成几个 —— 少一点，动画才有层次 */
  completePerTick: number
}

export const DEFAULT_ADVANCE: AdvanceOptions = {
  maxParallel: 6,
  completePerTick: 1,
}

export function advance(
  outline: OutlineNode[],
  plan: ExecutionPlan,
  opts: AdvanceOptions = DEFAULT_ADVANCE,
): OutlineNode[] | null {
  // ⚑ 先把可变副本建好，再用【指向副本的索引】做依赖判断。
  //   Map 里存的是同一批对象的引用，所以 Phase 1 的改动会被 Phase 2 立刻看到 ——
  //   一个任务完成后，它的下游在【同一个 tick 内】就能被派发。
  //   这符合 ADR-5 的模型：调度器拿到任务返回结果后当场决定下一步，
  //   而不是白等一个轮次。
  const next = outline.map((n) => ({ ...n }))
  const byId = new Map(next.map((n) => [n.id, n]))

  // 有子节点的都是分组节点，不是可执行的任务
  const containers = new Set(
    outline.map((n) => n.parent_id).filter((id): id is string => id !== null),
  )

  let changed = false

  /* ── 阶段 1：running ──▶ done ────────────────────────────── */
  let completed = 0
  for (const n of next) {
    if (completed >= opts.completePerTick) break
    if (n.status !== 'running') continue

    const outcome = plan[n.id] ?? fallbackOutcome(n)
    const evidence: Evidence = {
      tool: outcome.tool,
      args: outcome.args ?? {},
      result_ref: `tool_call_${n.id.slice(-4)}`,
      elapsed_ms: outcome.elapsed_ms,
      verified_at: new Date().toISOString(),
    }

    // ⚑ 铁律：没有证据的 done 一律降级为 failed（§5.2 / §7.3）。
    //   这里证据是我们自己造的，但仍然走同一个赋值路径 ——
    //   保证「done 必有 evidence」这个不变式在数据层就成立。
    n.status = 'done'
    n.result_summary = outcome.result_summary
    n.evidence = evidence

    completed++
    changed = true
  }

  /* ── 阶段 2：可执行的 todo ──▶ running ───────────────────── */
  const runningNow = next.filter((n) => n.status === 'running').length
  let slots = opts.maxParallel - runningNow

  for (const n of next) {
    if (slots <= 0) break
    if (n.status !== 'todo') continue

    // §9.2：审批没过就不许执行 —— 这是「危险操作必经审批」的落地
    if (n.approval?.status === 'pending') continue
    // 人做的、卡住的，Agent 不碰
    if (n.assignee !== 'agent') continue
    // 分组节点不是任务
    if (containers.has(n.id)) continue
    // §5.2：拓扑排序 —— 只投递依赖已满足的（读 byId，能看到本 tick 刚完成的）
    //
    // ⚑ `waived_deps` 里的前置**算满足** —— 用户已经点过「这个照做」。
    //   注意它豁免的是【点名的那些依赖】，不是把这个节点整个放行 ✗。
    const waived = new Set(n.waived_deps)
    const depsOk = n.depends_on.every(
      (d) => waived.has(d) || byId.get(d)?.status === 'done',
    )
    if (!depsOk) continue

    n.status = 'running'
    slots--
    changed = true
  }

  /* ── 阶段 3（原：上游被放弃 → 下游自动跳过）——【已删除】──────
   *
   * ⚑ 2026-09-20 删的。理由：它**替用户做了决定** ——
   *   而 §5.2 的原则是「遇到需要判断的地方，让人决定，不要替人猜」。
   *
   *   旧行为：上游一变 `skipped`，下游**立刻**跟着 `skipped`。
   *   问题是「上游被放弃」**不等于**「下游也该放弃」——
   *   最典型的例子就在 `mocks/japan-trip.ts` 里：
   *   用户不想买保险了 → 「打印行程单」**跟着死** ✗，可它照样能打。
   *   「要不要保险」和「要不要打印行程单」是**两个独立的决定**。
   *
   *   ⚑ 更根本的一层：上游该不该放弃，是用户判断的 ✓；
   *     但下游该不该跟着放弃，**也只有用户能判断** ✓ ——
   *     代码替它选了 `skipped`，等于把一个**还可以商量的处境**，
   *     变成了一个**已经发生、而且不可逆的事实** ✗。
   *
   *   新行为：下游停在【待你决定】（见 awaitingDecisionIds()）——
   *   既不自动跑、也不自动放弃，界面上给两个出口：
   *     · 「我也放弃」→ abandonNode() → status = 'skipped'
   *     · 「这个照做」→ waiveDeps()   → 那条前置写进 waived_deps
   *
   *   ⚠️ **不要**改成"上游是 skipped 就算依赖满足" ✗ —— 那是另一条路，
   *      它会把**硬前置**一起放行（「决定出行日期」被放弃后，
   *      「预订酒店」照样被派发 ✗，而没有日期根本订不了）。
   *      豁免必须**逐条、且用户点过** —— 这就是 `waived_deps` 存在的理由。
   *
   *   ⚑ 顺带补掉一个静默黑洞：旧级联只管 `assignee === 'agent'`，
   *     于是**归用户的任务**，上游被放弃后会永远停在 `todo` 且无人过问 ✗。
   *     现在它也会被算进「待你决定」。
   */
  return changed ? next : null
}

/** 没有预置产出的节点用的兜底。诚实但信息量低 —— 真实系统里不会走到这。 */
function fallbackOutcome(n: OutlineNode): ExecutionOutcome {
  return {
    tool: 'task_runner',
    result_summary: `${n.title} · 已完成`,
    elapsed_ms: 900,
  }
}

/* ── 派生：谁停在「待你决定」 ─────────────────────────────── */

/**
 * 为整张图算出【哪些节点停在「待你决定」】—— 一次算完，UI 按 id 查。
 *
 * ⚑ 为什么需要一个专门的概念：上游被放弃之后，下游处在一个
 *   **既不前进也不后退**的处境 —— 它在等一个**只有用户能做的判断**
 *   （"这件事我还要不要做"）。这跟 `todo` 不是一回事
 *   （`todo` 是"排队等着，会自己轮到我"）。
 *
 *     待决定  ⟺  `status === 'todo'`
 *            且  `depends_on` 里有一条指向 `status === 'skipped'` 的节点
 *            且  那一条**不在 `waived_deps` 里**（用户还没说「照做」）
 *
 * ⚑ **为什么不新增一个 `status`**：§4.2 的三轴里 `status` 管"这活到哪一步"，
 *   而"等用户拍板"是**决策**那一轴的事 —— 塞进 `status` 会让每一处读它的代码
 *   （§5.3 的"executing 时拒绝编辑"、D4 的配色、A6 的调度）都被迫理解这套语义。
 *   和 `displayState()`、容器状态是同一个做法：**存储保持正交，展示层自己算。**
 *
 * ⚠️ **不看 `assignee`** —— 归 `user` 的、`blocked` 的同样会停在这里。
 *   （旧级联只管 `agent`，于是归用户的任务会永远停在 `todo` 且无人过问 ✗。）
 * ⚠️ **不看容器** —— 容器不执行，它的状态是汇总出来的。
 */
export function awaitingDecisionIds(outline: OutlineNode[]): Set<string> {
  const byId = new Map(outline.map((n) => [n.id, n]))
  const out = new Set<string>()

  for (const n of outline) {
    if (n.status !== 'todo') continue
    const waived = new Set(n.waived_deps)
    const stuck = n.depends_on.some((d) => !waived.has(d) && byId.get(d)?.status === 'skipped')
    if (stuck) out.add(n.id)
  }
  return out
}

/* ── 用户侧的动作 ─────────────────────────────────────────── */

/**
 * 用户能对【单个节点】做的操作。
 * 对话框里的待办列表和画布的详情面板共用这一套 —— 两处入口，同一个语义。
 *
 *   approve    批准一个待确认的节点（§9.2）
 *   reject     否决它（§5.2 的 rejected 转移）
 *   complete   标记已完成（只对 user / blocked 开放）
 *   handle     ← 失败任务的两种处置，见 handleFailure()
 *   discard    ←
 */
export type NodeAction = 'approve' | 'reject' | 'complete' | 'handle' | 'discard'

/**
 * 用户对【失败任务】的处置 —— §5.2 失败降级表的人工分支。
 *
 *   'handle'   我来处理  →  assignee=user, status=todo
 *   'discard'  不处理    →  assignee=user, status=skipped
 *
 * ⚑ 为什么失败之后要【等人决定】，而不是自动降级：
 *
 *   §5.2 的降级表规定了「参数错误 → 转 user」「无可用工具 → blocked」，
 *   但**"重试也失败之后呢"文档没写** —— 这是个真缺口。
 *
 *   停下来让用户决定是唯一诚实的做法：**系统不该替用户判断
 *   "这件事还值不值得做"**。这和"并发冲突一律 409 不合并"是同一条原则 ——
 *   **遇到需要判断的地方，让人决定，不要替人猜。**
 *
 * ⚠️ 'discard' 产生的 skipped 是【有意放弃】，所以它算"已了结" ——
 *   父容器可以因此判为完成（见 outline.ts 的 combineStatus）。
 *   所以这个赋值走的是和 `abandonNode()` 完全一样的路（→ `skipped`），
 *   只是触发的处境不同：这里只对「Agent 失败了」开放，
 *   那里对任何还没开始做的节点开放。
 */
export function handleFailure(
  outline: OutlineNode[],
  nodeId: string,
  decision: 'handle' | 'discard',
): OutlineNode[] {
  return outline.map((n) => {
    if (n.id !== nodeId) return n
    // 只对「Agent 失败了、且还没被处置」的节点生效（幂等）
    if (n.status !== 'failed' || n.assignee !== 'agent') return n

    return {
      ...n,
      assignee: 'user' as const,
      assignee_reason: 'agent_failed' as const,
      status: decision === 'handle' ? ('todo' as const) : ('skipped' as const),
    }
  })
}

/**
 * 用户决定【这个照做】—— 认可跳过那几条被放弃的前置。
 *
 * ⚑ 只豁免**点名的那几条**，不是"所有被放弃的前置" ——
 *   因为"我认可跳过买保险"和"我认可跳过办签证"是**两个决定**。
 *   界面上把当前挡住它的那几条摆出来，用户点一下，就豁免那几条。
 *
 * ⚑ **不改 `depends_on`**：依赖关系本身没变，变的是"我不等它了"。
 *   两件事分开记，事后才查得出发生过什么 —— 见 types 里 `waived_deps` 的说明。
 *
 * 幂等：已经在豁免里的 id 再加一次没有副作用。
 */
export function waiveDeps(
  outline: OutlineNode[],
  nodeId: string,
  depIds: string[],
): OutlineNode[] {
  const add = new Set(depIds)
  return outline.map((n) =>
    n.id === nodeId ? { ...n, waived_deps: [...new Set([...n.waived_deps, ...add])] } : n,
  )
}

/**
 * 反悔 —— 把这几条从豁免里拿掉，它又变回【待你决定】。
 *
 * ⚑ 这个动作的存在，正是 `waived_deps` 比"直接把依赖从 `depends_on` 删掉"强的地方：
 *   删掉的依赖**加不回来**（"重新加上"和"本来就有"在数据上一模一样 ✗），
 *   而豁免**可以撤销**。
 */
export function unwaiveDeps(
  outline: OutlineNode[],
  nodeId: string,
  depIds: string[],
): OutlineNode[] {
  const drop = new Set(depIds)
  return outline.map((n) =>
    n.id === nodeId ? { ...n, waived_deps: n.waived_deps.filter((d) => !drop.has(d)) } : n,
  )
}

/**
 * 用户决定【我也放弃】—— 这个节点不做了。
 *
 * ⚑ 这是 `blocked` 节点**唯一的出口**。此前三个接口没有一条能让它变成
 *   `skipped`（v0.7 缺口 #5）：一个"谁都做不了"的节点就那么永远挂着 ✗ ——
 *   连"我不做这个"都表达不了。
 *
 * ⚑ 数据变化和 `handleFailure(..., 'discard')` 一样（都是 → `skipped`），
 *   为什么仍是两个函数：那一个是「**Agent 失败了**，你来处置」
 *   （只对 `failed` + `agent` 生效），这一个是「**我决定不做这件事**」
 *   （任何 `todo` 都行）。**数据一样、处境不同** —— 合并会让
 *   "哪里该调哪个"变得含糊。
 *
 * ⚠️ 产生的 `skipped` 是【有意放弃】，所以算"已了结"（`combineStatus`）——
 *   父容器可以因此判为完成。
 */
export function abandonNode(outline: OutlineNode[], nodeId: string): OutlineNode[] {
  return outline.map((n) => {
    if (n.id !== nodeId) return n
    // 只有【还没开始做的】能放弃（幂等）：
    //   running 正在跑、done 已有证据、failed 走 handleFailure 那条路
    if (n.status !== 'todo') return n
    return { ...n, status: 'skipped' as const }
  })
}

/**
 * 批准一个待确认的节点（§9.2 的审批流）。
 *
 * ⚠️ 真实系统里这一步在 Java Host 侧，且要写 approvals 表 + 审计（§4.1 / §10.1）。
 *   demo 里只改内存，但【语义保持】—— 只有 pending 能被批准，
 *   批准后可执行性立刻由 advance() 重新判定。
 */
export function approve(outline: OutlineNode[], nodeId: string): OutlineNode[] {
  return outline.map((n) =>
    n.id === nodeId && n.approval?.status === 'pending'
      ? { ...n, approval: { ...n.approval, status: 'approved' as const } }
      : n,
  )
}

/** 一次性批准所有待确认项（demo 便利操作） */
export function approveAll(outline: OutlineNode[]): OutlineNode[] {
  return outline.map((n) =>
    n.approval?.status === 'pending'
      ? { ...n, approval: { ...n.approval, status: 'approved' as const } }
      : n,
  )
}

/**
 * 否决一个待确认的节点 —— §5.2 的 rejected 转移。
 *
 * ⚑ 这是「人机边界」最完整的一次落地，一次点击触发三件事：
 *
 *     审批： pending  → rejected        审计事实，【不清空】
 *     归属： agent    → user            你不让它做，那就你自己来
 *     状态： → todo                     回到待办，等你处理
 *     原因： → user_rejected            这样界面上能说出"你否决了它"
 *
 *   注意 approval.status 保留 rejected 而不是删掉 —— 它是审计事实（§10.1）。
 *   「已完成却仍挂着 rejected」这个坑由 displayState() 的护栏挡掉（见 lib/outline.ts）。
 */
export function rejectNode(outline: OutlineNode[], nodeId: string): OutlineNode[] {
  return outline.map((n) => {
    if (n.id !== nodeId) return n
    // 只有 pending 的能被否决，其余原样返回（幂等）
    if (n.approval?.status !== 'pending') return n

    return {
      ...n,
      assignee: 'user' as const,
      assignee_reason: 'user_rejected' as const,
      status: 'todo' as const,
      approval: { ...n.approval, status: 'rejected' as const },
    }
  })
}

/**
 * 标记【单个】节点已完成。
 *
 * 用途有两类：
 *   · 用户自己在图上勾掉"我做完了"
 *   · 卡住的节点由用户在系统外解决后回来标记
 *
 * ⚠️ 它不产出 `evidence` —— 这是有意的，见 lib/outline.ts 的说明：
 *   「无证据的 done 降级为 failed」针对的是【Agent 的自我报告】。
 *   人勾的完成由人负责，不需要工具调用记录来背书。
 */
export function completeNode(outline: OutlineNode[], nodeId: string): OutlineNode[] {
  return outline.map((n) =>
    n.id === nodeId && n.status !== 'done' ? { ...n, status: 'done' as const } : n,
  )
}

/**
 * 把「需要你做的」标记为已完成。
 *
 * ⚠️ 这是 demo 便利操作：真实系统里这一步是用户在别处办完事、回来打勾，
 *   或者由外部系统回调。这里只是让演示能往下走。
 *   注意它【只作用于 assignee=user 的节点】—— 不会替 Agent 干活。
 */
export function markUserTasksDone(outline: OutlineNode[]): OutlineNode[] {
  return outline.map((n) =>
    n.assignee === 'user' && n.status !== 'done' ? { ...n, status: 'done' as const } : n,
  )
}
