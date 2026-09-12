/**
 * 应用外壳 + 对话流程编排。
 *
 *   ┌──────────────────────┬──────────────────────────────┐
 *   │ 对话区（Agent 文本）    │  任务图画布                    │
 *   │  ↓                    │                              │
 *   │ 输入框                 │                              │
 *   └──────────────────────┴──────────────────────────────┘
 *
 * ⚑ 流程不是一个"输入 → 直接出图"的跳变，而是 §5.1 那条链：
 *
 *     输入目标 → ① 规划 → ② 裁决 → ③ 用户确认 → ④ 展开执行
 *
 *   本 demo 里 ①② 是 mock（真实在 A0 的 Python + A6 的 Java），
 *   ③④ 是真做的：
 *
 *     ③ 用户确认  —— Agent 汇报完成度/问题/需要你做的事，用户点确认才继续
 *     ④ 展开执行  —— advance() 按 §5.2 拓扑排序 + §9.2 审批分级推进状态
 *
 *   所以"图会不会动"取决于数据本身，而不是写死的动画：
 *   日本那份数据集按规则几乎推不动（审批没过、依赖在人手上），
 *   界面会如实说"卡在哪、要你做什么"，而不是硬把节点涂绿。
 */
import { useEffect, useMemo, useState } from 'react'
import { TaskGraph } from './features/canvas/TaskGraph'
import { ChatPanel } from './features/chat/ChatPanel'
import { buildTree } from './lib/outline'
import {
  advance,
  approve,
  approveAll,
  completeNode,
  markUserTasksDone,
  rejectNode,
  type ExecutionPlan,
  type NodeAction,
} from './lib/simulation'
import { summarize } from './lib/summary'
import { datasets, pickDataset, type MockDataset } from './mocks'
import type { OutlineNode } from './types/outline'

/**
 * 流程阶段。
 *
 *   idle      还没输入
 *   planning  正在拆解（真实在 A0，这里用假延迟占位）
 *   proposed  方案已出，等用户确认 ← §5.1 第 ③ 步
 *   executing 正在推进
 *   settled   推不动了（全完成，或卡在某处等人）
 */
type Phase = 'idle' | 'planning' | 'proposed' | 'executing' | 'settled'

/** 规划假延迟。真实规划要几秒，这里够让人看见"在想了"即可 */
const PLANNING_MS = 700
/** 每个推进 tick 的间隔。太长显得卡，太短看不清状态是怎么变的 */
const TICK_MS = 700

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [goal, setGoal] = useState('')
  const [input, setInput] = useState('')
  const [dataset, setDataset] = useState<MockDataset | null>(null)
  const [outline, setOutline] = useState<OutlineNode[]>([])

  // plan 必须稳定，否则每次 render 都换新对象会让执行 effect 反复重挂
  const plan: ExecutionPlan = useMemo(() => dataset?.execution ?? {}, [dataset])

  /* ── ③ 规划：假延迟后落数据 ─────────────────────────────── */
  useEffect(() => {
    if (phase !== 'planning' || !dataset) return
    const id = setTimeout(() => {
      setOutline(dataset.outline)
      setPhase('proposed')
    }, PLANNING_MS)
    return () => clearTimeout(id)
  }, [phase, dataset])

  /* ── ④ 执行：每个 tick 推进一次状态 ─────────────────────── */
  // 用 setTimeout 而非 setInterval：每次都基于【最新的 outline】推进一步，
  // 结束后再排下一个。这样不会出现"定时器还在跑但状态已经变了"的竞态。
  useEffect(() => {
    if (phase !== 'executing') return
    const id = setTimeout(() => {
      const next = advance(outline, plan)
      if (next) {
        setOutline(next)
      } else {
        // 推不动了 —— 不是错误，是"卡住了等人"或"全完成了"
        setPhase('settled')
      }
    }, TICK_MS)
    return () => clearTimeout(id)
  }, [phase, outline, plan])

  /* ── 派生：结构 → 问题 → 汇报 ───────────────────────────── */
  const built = useMemo(() => buildTree(outline), [outline])
  const summary = useMemo(
    () => (outline.length > 0 ? summarize(outline, built.issues) : null),
    [outline, built.issues],
  )

  /* ── 动作 ───────────────────────────────────────────────── */

  function submit(text: string) {
    const g = text.trim()
    if (!g) return
    setGoal(g)
    setInput('')
    setDataset(pickDataset(g))
    setOutline([]) // 规划期间右栏先空着，避免闪一下旧数据
    setPhase('planning')
  }

  function confirm() {
    setPhase('executing')
  }

  /**
   * 用户侧动作执行后，如果之前已经"停"了，就恢复推进。
   *
   * ⚑ 这是这个 demo 最重要的一处交互：**用户解开了阻塞，Agent 才继续**。
   *   不是定时器自己往前跑 —— 那会让"审批"看起来毫无意义。
   */
  function applyUserAction(next: OutlineNode[]) {
    setOutline(next)
    if (phase === 'settled') setPhase('executing')
  }

  /**
   * 对【单个节点】的操作 —— 两个入口共用这一个处理函数：
   *   · 对话区待办列表里的行内按钮
   *   · 画布上点开节点后的详情面板
   *
   * ⚑ 两处入口、同一个语义，是这个设计的关键：用户在哪儿看到问题，
   *   就能在哪儿解决它，不必先去另一个区域找到对应的那一条。
   */
  function handleNodeAction(nodeId: string, action: NodeAction) {
    const next =
      action === 'approve'
        ? approve(outline, nodeId)
        : action === 'reject'
          ? rejectNode(outline, nodeId)
          : completeNode(outline, nodeId)
    applyUserAction(next)
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h1 className="text-sm font-semibold tracking-wide">Agent 任务图引擎</h1>
          <p className="mt-1 text-xs text-slate-500">自然语言目标 → 可执行任务图</p>
        </header>

        <ChatPanel
          goal={goal}
          planning={phase === 'planning'}
          summary={summary}
          canConfirm={phase === 'proposed'}
          onConfirm={confirm}
          onApproveAll={() => applyUserAction(approveAll(outline))}
          onMarkUserDone={() => applyUserAction(markUserTasksDone(outline))}
          onItemAction={handleNodeAction}
          scrollKey={`${phase}:${outline.length}:${summary?.byStatus.done ?? 0}`}
        />

        <Composer
          input={input}
          onInput={setInput}
          onSubmit={() => submit(input)}
          activeKey={dataset?.key ?? null}
          onPick={(d) => submit(d.goal || d.key)}
        />
      </aside>

      <TaskGraph outline={outline} onNodeAction={handleNodeAction} />
    </div>
  )
}

/* ── 输入区 ───────────────────────────────────────────────── */

function Composer({
  input,
  onInput,
  onSubmit,
  activeKey,
  onPick,
}: {
  input: string
  onInput: (v: string) => void
  onSubmit: () => void
  activeKey: string | null
  onPick: (d: MockDataset) => void
}) {
  return (
    <div className="border-t border-slate-200">
      {/* 数据集快捷入口 —— 用于快速 review 不同形态的图，不必先猜对关键词 */}
      <div className="flex gap-1 overflow-x-auto px-3 pt-2.5 pb-0">
        {datasets.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => onPick(d)}
            title={d.note}
            className={[
              'shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[10px] transition-colors',
              d.key === activeKey
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ].join(' ')}
          >
            {d.goal || d.key}
          </button>
        ))}
      </div>

      <form
        className="flex items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <textarea
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送、Shift+Enter 换行 —— 聊天区域的通行约定
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder="例如：帮我规划一次日本关西七日游"
          rows={2}
          aria-label="目标"
          className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-xs placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="cursor-pointer rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
      </form>
    </div>
  )
}
