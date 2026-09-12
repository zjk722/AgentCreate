/**
 * `assignee_reason` 枚举 → 人话。
 *
 * ⚑ 为什么这层翻译放在【前端】而不是让后端返回一句话（§4.2）：
 *
 *   1. 措辞可以改而不动数据 —— 后端只存枚举，改文案不用迁移
 *   2. 永远不会出现无出处的句子 —— 每句话都对应一个枚举值，
 *      而每个枚举值都对应文档里的一条规则
 *   3. 可以同时给出"为什么"和"怎么解决" —— 后者是产品语言，
 *      不该污染存储层
 *
 * 表里每一行的 `rule` 注释都指向文档出处 —— 这是"可验证"的具体含义：
 * 界面上任何一句解释，你都能顺着它找到那条规则。
 */
import type { AssigneeReason } from '../types/outline'

export interface ReasonText {
  /** 一句话解释为什么这么分 */
  why: string
  /** 用户接下来能做什么（产品语言，可改而不动数据） */
  next: string
  /** 文档出处，用于 tooltip / 自查 */
  rule: string
}

const TABLE: Record<AssigneeReason, ReasonText> = {
  needs_human: {
    why: '这件事只有你本人能做',
    next: '需要你自己处理',
    rule: '§1.2 · 需本人办理 / 个人偏好',
  },
  no_tool: {
    why: '没有可用的工具能完成它',
    next: '可以补充工具，或改为自己做',
    rule: '§9.2 · 无工具 → blocked',
  },
  agent_failed: {
    why: 'Agent 尝试过，但失败了',
    next: '已转交给你，可参考失败原因',
    rule: '§5.2 · 参数错误不可重试 → 转 user',
  },
  user_rejected: {
    why: '你否决了 Agent 的方案',
    next: '现在归你处理',
    rule: '§5.2 · rejected → assignee=user',
  },
  policy_denied: {
    why: 'Policy 按规则拒绝了这次操作',
    next: '可调整方案后重试',
    rule: '§9.2 · Policy 拒绝 → blocked',
  },
}

/** 未知枚举值的安全兜底 —— 后端加了新枚举而前端还没跟上时，不该白屏。 */
const UNKNOWN: ReasonText = {
  why: '原因未标注',
  next: '请查看节点详情',
  rule: '（未知枚举值）',
}

export function reasonText(reason: AssigneeReason | null | undefined): ReasonText | null {
  if (!reason) return null
  return TABLE[reason] ?? UNKNOWN
}
