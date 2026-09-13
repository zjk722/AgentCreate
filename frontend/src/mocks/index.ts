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
import type { ExecutionPlan } from '../lib/simulation'
import type { OutlineNode } from '../types/outline'
import { corruptSample } from './corrupt-sample'
import { japanTrip } from './japan-trip'
import { mlKnowledge } from './ml-knowledge'
import { vagueMood } from './vague-mood'

/**
 * 模拟执行时各节点会产出什么。
 *
 * ⚑ 为什么这份"结果"必须放在 mock 里、而不是让前端编：
 *   真实系统里这是【引擎返回的】，前端只是渲染。放进 mock 等于把
 *   "未来会从哪来"这件事实标注清楚 —— 将来 A4 接上真引擎，
 *   这个字段直接删掉，界面代码一行不用改。
 *
 * 没有条目的节点走 simulation.ts 的兜底产出。
 */
const japanExecution: ExecutionPlan = {
  b20000000021: {
    tool: 'hotel_search',
    args: { city: '大阪', nights: 3 },
    result_summary: '锁定难波 3 晚，共 ¥2070',
    elapsed_ms: 2100,
  },
  b20000000022: {
    tool: 'hotel_search',
    args: { city: '京都', nights: 3 },
    result_summary: '找到 4 家民宿，均价 ¥520/晚',
    elapsed_ms: 1850,
  },
  b20000000027: {
    tool: 'transfer_booking',
    args: { from: 'KIX', to: '难波' },
    result_summary: '已预约 3/12 关西机场接机',
    elapsed_ms: 1400,
  },
}

export interface MockDataset {
  /** 稳定标识，用于 React key 和 URL 参数 */
  key: string
  /** 界面上那个快捷按钮显示的名字。要短 —— 长了按钮排不下会互相挤 */
  label: string
  /**
   * 用户在输入框里可能输入的目标原文。
   *
   * ⚠️ 允许为空：坏数据样本根本不是"用户会输入的目标"，
   *    给它编一个目标等于撒谎（那会暗示模型可能产出这种东西）。
   */
  goal: string
  /** 这份数据是哪来的、要演示什么 —— 直接显示在界面上，免得看成"真数据" */
  note: string
  outline: OutlineNode[]
  /** 模拟执行时各节点会产出什么；不提供则该数据集跑起来只有兜底产出 */
  execution?: ExecutionPlan
}

export const datasets: MockDataset[] = [
  {
    key: 'japan-trip',
    label: '日本关西七日游',
    goal: '帮我规划一次日本关西七日游',
    note: '§8.3 种子 #2 · 任务型，覆盖全部状态/归属/审批组合',
    outline: japanTrip,
    execution: japanExecution,
  },
  {
    key: 'ml-knowledge',
    label: '机器学习知识体系',
    goal: '整理一下机器学习的知识体系',
    note: '§8.3 种子 #1 · 知识型，深度 3 单根全绿',
    outline: mlKnowledge,
  },
  {
    key: 'vague-mood',
    label: '最近有点烦',
    goal: '最近有点烦',
    note: '§8.3 种子 #10 🔴 · 退化边界：只出根节点，不编造',
    outline: vagueMood,
  },
  {
    key: 'corrupt-sample',
    label: '坏数据样本',
    goal: '',
    note: '⚠️ 非种子 · 坏数据：重复 id / 孤儿 / 环 / order 空洞 / 依赖悬空 / 依赖环',
    outline: corruptSample,
  },
]

/**
 * 按用户在输入框里打的内容找数据集；匹配不上就回退第一份。
 *
 * ⚑ 同时匹配 `key` 和 `goal` —— 这一条是**修 bug 修出来的**：
 *
 *   原来只匹配 `goal`，于是坏数据样本（`goal` 为空）**永远选不中**，
 *   点它的按钮会静默回退到日本旅游 —— 用户看到的是另一份数据，
 *   而且没有任何提示告诉他选错了。
 *
 *   ⚠️ **静默换掉用户选的东西，比报错还糟**：报错他会重试，
 *      静默替换他会以为自己看到的就是他要的。
 *
 *   现在 `goal` 为空的数据集也能靠 `key` 被选中。
 */
export function pickDataset(text: string): MockDataset {
  const q = text.trim()
  if (q) {
    const hit = datasets.find(
      (d) => d.key === q || (d.goal !== '' && (q.includes(d.goal) || d.goal.includes(q))),
    )
    if (hit) return hit
  }
  return datasets[0]
}
