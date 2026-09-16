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
import realPlans from './real-plans.json'
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

/**
 * ⚑ **真模型跑出来的两份方案**（2026-09-16，DeepSeek，按 corpus 里各自的 limits 跑）。
 *
 * 它们和上面那几份手写样本**长得一模一样**，但来路完全不同 ——
 * 所以每份的 `note` 里那两句必须显示出来（`Composer` 现在会把当前数据集那一行显示在界面上）。
 * 否则你会拿一份"**未经 Policy 裁决、依赖还没算**"的图，当成产品的真实能力。
 *
 * 两个需要知道的细节：
 *
 *   ① 它们和手写样本**共用同一个 `goal`** —— 所以按文字匹配会命中**前面那个**
 *      （手写样本）。真跑这两份要点按钮、或输入 key。
 *      这是**确定的、可解释的**行为，不是"点了没反应"那个 bug
 *      （那条由 `index.test.ts` 里"每份都能被自己的 key 选中"守着）。
 *
 *   ② JSON 里保留着 `proposed_tool`，而前端契约（`types/outline.ts`）里**没有**这个字段
 *      —— 所以界面不会显示它。留着是因为它是**模型真实输出的一部分**，
 *      而且 Policy 将来判 `blocked` / 审批等级靠的就是它（§4.2 的那处缺口）。
 */
const realDatasets = [realPlans['real-japan'], realPlans['real-ml']] as unknown as MockDataset[]
// ⚑ 为什么 `as unknown as`：JSON 模块的类型是"推断出来的字面量类型"
//   （比如 status 推断成 `string`），而 `OutlineNode.status` 是五个值的联合 —— 两边不兼容。
//   ⚠️ 代价要如实说：**这份 fixture 不被类型检查**（字段名写错、枚举值写错都不会报）。
//      换来的是它**忠实保留模型的原样输出**（而不是手抄成 TS、抄错也没人知道）。

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
  // ⚑ 真跑的两份放【最后】：`pickDataset` 的兜底是第一份，而文字匹配撞车时
  //   也是"前面那份赢" —— 手写样本应该优先（真跑那两份靠按钮或 key 进）。
  ...realDatasets,
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

/**
 * 还没选数据集时显示的那句话。
 *
 * ⚑ 它必须**同样**挡住"把手造样本当成真数据"这个误读 ——
 *   而按钮那一排在任何时刻摆的都是手造样本，所以这句话在任何时刻都成立。
 */
const NO_DATASET_NOTE = '上面这几份都是手造的样本 —— 不是模型跑出来的'

/**
 * 界面上那一行「这份数据哪来的」该显示什么。
 *
 * ⚑ 为什么抽成函数，而不是在 JSX 里直接写 `datasets.find(...)?.note`：
 *   那样这段逻辑就只活在调用方那行 JSX 里 —— **而那个位置没有测试守着**
 *   （同一条理由见推送 6：「闸门不能只活在调用方那行 JSX 里」）。
 *
 * ⚑ 没选数据集时**不给空串**：那一行会时有时无，布局跟着跳一下；
 *   而且空着也不诚实 —— 见 NO_DATASET_NOTE 的说明。
 *
 * ⚑ `warning` 的判据是「**note 以 `⚠️` 开头**」，这是一条**约定**：
 *   需要当心看的说明就那么写。它和 `corrupt-sample` 那个红边是同一个目的，
 *   区别是红边按 key 硬编码（以后加数据集不会自动生效），
 *   这条按**内容**认（照约定写就自动生效）。
 */
export function noteFor(activeKey: string | null): { text: string; warning: boolean } {
  const text = datasets.find((d) => d.key === activeKey)?.note ?? NO_DATASET_NOTE
  return { text, warning: text.startsWith('⚠️') }
}
