/**
 * D1 · 应用外壳（两栏布局骨架）
 *
 * 这一阶段**只搭骨架、不接数据**。目的是把 §3.1 里前端的职责
 * 在布局上先把位置占住：
 *
 *   ┌──────────────────┬────────────────────────────────┐
 *   │  左栏 · 目标输入   │  右栏 · 任务图画布               │
 *   │  （后续长成对话面板）│  （D4 在这里渲染 SVG）           │
 *   └──────────────────┴────────────────────────────────┘
 *
 * 两个布局决策的理由：
 *
 * 1. 左栏固定 380px 且不随窗口缩放。
 *    输入区的宽度应由「一行中文的舒适阅读长度」决定，而不是窗口宽度。
 *    窗口变宽时，多出来的空间应该给画布 —— 画布才是需要空间的那个
 *    （ADR-6：布局是前端最贵的一块，得让它有地方铺开）。
 *
 * 2. 整个应用 h-screen + overflow-hidden，滚动只发生在画布内部。
 *    否则 D5 加缩放/平移时，页面级滚动会和画布手势打架。
 */
import { useState } from 'react'

export default function App() {
  // D1 只验证「提交」这个动作存在。真正的规划在 A0（Python 侧），
  // 这个 demo 全程用 mock 数据（见 D2 的 mocks/）。
  const [goal, setGoal] = useState('')
  const [submitted, setSubmitted] = useState(false)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900">
      <Aside
        goal={goal}
        onGoalChange={(v) => {
          setGoal(v)
          setSubmitted(false)
        }}
        onSubmit={() => setSubmitted(true)}
        submitted={submitted}
      />
      <Canvas />
    </div>
  )
}

/* ── 左栏：目标输入 ───────────────────────────────────────── */

function Aside({
  goal,
  onGoalChange,
  onSubmit,
  submitted,
}: {
  goal: string
  onGoalChange: (v: string) => void
  onSubmit: () => void
  submitted: boolean
}) {
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-5 py-4">
        <h1 className="text-sm font-semibold tracking-wide">Agent 任务图引擎</h1>
        <p className="mt-1 text-xs text-slate-500">
          自然语言目标 → 可执行任务图
        </p>
      </header>

      <form
        className="flex flex-1 flex-col gap-3 p-5"
        onSubmit={(e) => {
          // 阻止默认提交：这是 SPA，不该触发页面刷新
          e.preventDefault()
          onSubmit()
        }}
      >
        <label htmlFor="goal" className="text-xs font-medium text-slate-700">
          目标
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          placeholder="例如：准备一次日本关西七日游"
          rows={4}
          className="resize-none rounded-md border border-slate-300 px-3 py-2 text-sm
                     placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white
                     transition-colors hover:bg-slate-700"
        >
          生成任务图
        </button>

        {submitted && <NotWiredNote />}
      </form>
    </aside>
  )
}

/** 明确告诉使用者「这里还没接上」，而不是假装能用。 */
function NotWiredNote() {
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
      <span className="font-medium">D1 阶段：尚未接入。</span>
      <br />
      规划引擎在 A0（Python 侧），本 demo 全程使用 mock 数据（D2 接入）。
    </p>
  )
}

/* ── 右栏：任务图画布 ─────────────────────────────────────── */

function Canvas() {
  return (
    <main className="relative flex-1 overflow-hidden">
      {/* 点阵背景：让「画布」这个概念可见，也方便 D5 做平移时观察位移 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(203 213 225) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative flex h-full items-center justify-center">
        <p className="text-sm text-slate-400">
          D4 将在此渲染任务图（左右布局 · 根在左）
        </p>
      </div>
    </main>
  )
}
