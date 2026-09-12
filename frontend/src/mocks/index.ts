/**
 * mock 数据集注册表 —— D2 方案 B 的"多份数据"在这里汇总。
 *
 * 用途（D4 接上界面后）：
 *   左侧输入框的内容去 `goal` 里匹配 → 命中哪份就渲染哪份。
 *   匹配不上时回退到第一份，而不是报错 —— 这是 demo，不该让人卡住。
 *
 * ⚑ 为什么把 §8.3 的评测集种子直接当 mock 数据源：
 *   一份数据两用。现在用来渲染 demo，等 A1 做评测时，
 *   同一批种子既能跑自动断言（结构/覆盖），也能直接肉眼看渲染结果。
 *   §8.3 里那三条 🔴 Bad Case 尤其值得肉眼过一遍 ——
 *   它们断言的是"模型该收手时收手了没有"，这种判断机器很难替你做。
 */
import type { OutlineNode } from '../types/outline'
import { corruptSample } from './corrupt-sample'
import { japanTrip } from './japan-trip'
import { mlKnowledge } from './ml-knowledge'
import { vagueMood } from './vague-mood'

export interface MockDataset {
  /** 稳定标识，用于 React key 和 URL 参数 */
  key: string
  /** 用户在输入框里可能输入的目标原文 */
  goal: string
  /** 这份数据是哪来的、要演示什么 —— 直接显示在界面上，免得看成"真数据" */
  note: string
  outline: OutlineNode[]
}

export const datasets: MockDataset[] = [
  {
    key: 'japan-trip',
    goal: '帮我规划一次日本关西七日游',
    note: '§8.3 种子 #2 · 任务型，覆盖全部状态/归属/审批组合',
    outline: japanTrip,
  },
  {
    key: 'ml-knowledge',
    goal: '整理一下机器学习的知识体系',
    note: '§8.3 种子 #1 · 知识型，深度 3 单根全绿',
    outline: mlKnowledge,
  },
  {
    key: 'vague-mood',
    goal: '最近有点烦',
    note: '§8.3 种子 #10 🔴 · 退化边界：只出根节点，不编造',
    outline: vagueMood,
  },
  {
    key: 'corrupt-sample',
    goal: '',
    note: '⚠️ 非种子 · D2 坏数据样本：重复 id / 孤儿 / 环 / order 空洞',
    outline: corruptSample,
  },
]

/** 按输入的目标找数据集；匹配不上就回退第一份，不报错。 */
export function pickDataset(goal: string): MockDataset {
  const q = goal.trim()
  if (q) {
    const hit = datasets.find((d) => d.goal && (q.includes(d.goal) || d.goal.includes(q)))
    if (hit) return hit
  }
  return datasets[0]
}
