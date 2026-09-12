/**
 * 应用外壳（两栏）+ mock 数据接线。
 *
 *   ┌──────────────────┬────────────────────────────────┐
 *   │  左栏 · 目标输入   │  右栏 · 任务图画布               │
 *   │  + 数据集切换      │  （D3 布局 + D4 渲染）           │
 *   └──────────────────┴────────────────────────────────┘
 *
 * ⚠️ 本 demo【全程使用 mock 数据】。真实链路是：
 *     输入目标 → A0 的 Python 规划器 → Java Host → 前端
 *   现在这条链路上的每一环都还不存在，所以 pickDataset() 只是按关键词
 *   匹配一份写死的数据。这个"假"必须对所有看 demo 的人可见 ——
 *   所以左栏底部一直显示当前数据集的来源说明。
 */
import { useState } from 'react'
import { TaskGraph } from './features/canvas/TaskGraph'
import { datasets, pickDataset, type MockDataset } from './mocks'

export default function App() {
  const [goal, setGoal] = useState('')
  const [active, setActive] = useState<MockDataset>(datasets[0])
  // 提交后才切换，避免边打字边跳图
  const [pending, setPending] = useState(false)

  function submit() {
    setActive(pickDataset(goal))
    setPending(false)
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h1 className="text-sm font-semibold tracking-wide">Agent 任务图引擎</h1>
          <p className="mt-1 text-xs text-slate-500">自然语言目标 → 可执行任务图</p>
        </header>

        <form
          className="flex flex-col gap-3 border-b border-slate-200 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="goal" className="text-xs font-medium text-slate-700">
            目标
          </label>
          <textarea
            id="goal"
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value)
              setPending(true)
            }}
            placeholder="例如：帮我规划一次日本关西七日游"
            rows={3}
            className="resize-none rounded-md border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            生成任务图
          </button>
          {pending && (
            <p className="text-[11px] text-slate-400">
              输入已改变，点「生成任务图」重新匹配数据集
            </p>
          )}
        </form>

        <DatasetList active={active} onPick={(d) => { setActive(d); setGoal(d.goal) }} />

        <DatasetNote dataset={active} />
      </aside>

      {/* key 让切换数据集时整个画布重挂载 —— 选中态、滚动位置一并重置 */}
      <TaskGraph key={active.key} outline={active.outline} />
    </div>
  )
}

/* ── 数据集切换 ───────────────────────────────────────────── */

/**
 * 方案 B 的落地：直接列出所有数据集，点一下就能换。
 *
 * 为什么除了"按输入匹配"还要有个按钮列表：
 *   匹配是给【演示真实交互】用的（用户输入目标 → 出图）；
 *   列表是给【review 数据本身】用的（快速对比不同形态的图）。
 *   少了列表，想看一眼坏数据长什么样还得先猜对关键词。
 */
function DatasetList({
  active,
  onPick,
}: {
  active: MockDataset
  onPick: (d: MockDataset) => void
}) {
  return (
    <nav className="flex flex-col gap-1 p-3">
      <h2 className="px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-400">
        MOCK 数据集
      </h2>
      {datasets.map((d) => {
        const isActive = d.key === active.key
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onPick(d)}
            aria-current={isActive}
            className={[
              'cursor-pointer rounded-md px-2.5 py-2 text-left transition-colors',
              isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-100',
            ].join(' ')}
          >
            <span className="block truncate text-xs font-medium">
              {d.goal || d.key}
            </span>
            <span
              className={`mt-0.5 block text-[10px] leading-tight ${
                isActive ? 'text-slate-300' : 'text-slate-400'
              }`}
            >
              {d.note}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/** 当前数据集的来源说明 —— 让"这是 mock"这件事一直可见。 */
function DatasetNote({ dataset }: { dataset: MockDataset }) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50 px-5 py-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        <span className="font-medium text-amber-700">当前为 mock 数据。</span>
        <br />
        {dataset.note}
      </p>
    </footer>
  )
}
