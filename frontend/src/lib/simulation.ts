/**
 * 模拟执行推进 —— 本 demo 用来让「任务图是状态面板」这件事看得见（§1.2）。
 *
 * ⚑ 这不是随便把节点涂绿。它严格按 §5.2 的执行时序与 §9.2 的审批分级：
 *
 *   1. running 的任务 ──▶ done（产出证据 + 摘要）
 *   2. 依赖已满足的 todo ──▶ running（受 Semaphore(maxParallel) 限制，§NFR-2）
 *   3. 依赖失败/跳过的 ──▶ skipped（级联，§5.2 失败降级表）
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
import type { Evidence, NodeStatus, OutlineNode } from '../types/outline'

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

/** 状态列表里表示"这条依赖线已经废了"的取值 */
const DEAD_STATUSES: NodeStatus[] = ['failed', 'skipped']

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
    const depsOk = n.depends_on.every((d) => byId.get(d)?.status === 'done')
    if (!depsOk) continue

    n.status = 'running'
    slots--
    changed = true
  }

  /* ── 阶段 3：依赖废掉的 ──▶ skipped（级联） ─────────────── */
  for (const n of next) {
    if (n.status !== 'todo') continue
    if (n.assignee !== 'agent') continue
    const blockedByDeadDep = n.depends_on.some((d) => {
      const dep = byId.get(d)
      return dep ? DEAD_STATUSES.includes(dep.status) : false
    })
    if (blockedByDeadDep) {
      n.status = 'skipped'
      changed = true
    }
  }

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

/* ── 用户侧的动作 ─────────────────────────────────────────── */

/**
 * 用户能对【单个节点】做的三种操作。
 * 对话框里的待办列表和画布的详情面板共用这一套 —— 两处入口，同一个语义。
 */
export type NodeAction = 'approve' | 'reject' | 'complete'

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
