/**
 * 对话区 —— 用户输入框【上方】那块专门容纳 Agent 文本信息的地方。
 *
 * 布局约定的理由（为什么是"上方"而不是别处）：
 *   它是「输入 → 得到回应 → 再输入」这个循环的一部分，必须和输入框
 *   贴在一起。放到右栏或弹窗里，用户就得在两个区域之间来回看，
 *   而对话的节奏会被打断。
 *
 * 渲染规则：
 *   · 用户说过话 → 一条用户气泡
 *   · 规划中     → 一条"正在规划"的占位
 *   · 有结果     → AgentMessage 卡片（内容全部来自 summarize()）
 */
import { useEffect, useRef } from 'react'
import type { MapSummary } from '../../lib/summary'
import { AgentMessage } from './AgentMessage'

export interface ChatPanelProps {
  goal: string
  planning: boolean
  summary: MapSummary | null
  canConfirm: boolean
  onConfirm: () => void
  onApproveAll: () => void
  onMarkUserDone: () => void
  /** 用于自动滚到底部的依赖 —— 进度变化时就该滚 */
  scrollKey: string | number
}

export function ChatPanel({
  goal,
  planning,
  summary,
  canConfirm,
  onConfirm,
  onApproveAll,
  onMarkUserDone,
  scrollKey,
}: ChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // 新消息/新进度时滚到底部。⚠️ 用 'smooth' 而不是瞬移 ——
  // 瞬移会让人丢失"刚才发生了什么"的上下文。
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [scrollKey, planning])

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {!goal && !planning && <EmptyState />}

      {goal && (
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-lg rounded-br-sm bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white">
            {goal}
          </p>
        </div>
      )}

      {planning && <PlanningBubble />}

      {!planning && summary && (
        <AgentMessage
          summary={summary}
          canConfirm={canConfirm}
          onConfirm={onConfirm}
          onApproveAll={onApproveAll}
          onMarkUserDone={onMarkUserDone}
        />
      )}

      <div ref={endRef} />
    </div>
  )
}

/* ── 空状态 ───────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="pt-6 text-center">
      <p className="text-xs text-slate-400">说说你想做什么，我会拆成任务图。</p>
      <p className="mt-1 text-[11px] text-slate-300">拆完后你可以先看看，再决定要不要开始。</p>
    </div>
  )
}

/* ── 规划中 ───────────────────────────────────────────────── */

/**
 * ⚠️ 这个动画是【假的】—— 真实规划在 A0 的 Python 侧，要几秒。
 *   但它不是"骗人"：它存在的意义是把真实产品里那段等待的【位置和时长感】
 *   先占住，免得将来接真链路时布局跳动。
 *   界面上不写"正在调用模型"这种会变成谎话的话。
 */
function PlanningBubble() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span className="text-xs text-slate-500">正在拆解目标…</span>
    </div>
  )
}
