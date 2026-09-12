/**
 * 任务状态图标。
 *
 * ⚑ 这个文件存在的唯一理由：**颜色不能是唯一的信息载体**。
 *
 *   `done`（绿）和 `failed`（红）是最典型的红绿色盲陷阱 —— 约 8% 的男性
 *   分不出这两个色相。如果状态只靠颜色表达，这部分用户看到的是两张
 *   一模一样的卡片。
 *
 *   所以每个状态都有一个【形状明显不同】的图标：
 *
 *     todo      空心圆        ○    "还没开始"
 *     running   断口圆弧      ◜    "在转"（残缺 = 未完成）
 *     done      勾            ✓    "成了"   ← 和下面的叉形状差最大
 *     failed    叉            ✕    "坏了"
 *     skipped   圆 + 斜杠     ⊘    "跳过了"
 *
 *   颜色只做【加速识别】，信息由形状承载。
 */
import type { NodeStatus } from '../../types/outline'

export function StatusIcon({
  status,
  className,
}: {
  status: NodeStatus
  className?: string
}) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    // 装饰性图标：语义已经由旁边的文字（title + 状态标签）表达了，
    // 让屏幕阅读器跳过它，免得读成"图形 图形 预订大阪酒店"
    'aria-hidden': true,
    className,
  } as const

  switch (status) {
    case 'todo':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      )

    case 'running':
      // 缺口圆弧 —— 暗示"转起来了，但还没合上"
      return (
        <svg {...common}>
          <path
            d="M8 2a6 6 0 1 1-4.9 2.55"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )

    case 'done':
      return (
        <svg {...common}>
          <path
            d="M3.5 8.5l3 3 6-6.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )

    case 'failed':
      return (
        <svg {...common}>
          <path
            d="M4.5 4.5l7 7M11.5 4.5l-7 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )

    case 'skipped':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.75" />
          <path d="M4.2 11.8L11.8 4.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )
  }
}

/** 人工改过 → AI 不许碰（§4.2 的 `locked`）。用锁表示"这是人锁上的"。 */
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** 证据链标记 —— 有工具调用记录可查 */
export function EvidenceIcon({ className }: { className?: string }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M3 3.5h10M3 8h10M3 12.5h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
