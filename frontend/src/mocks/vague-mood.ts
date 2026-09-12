/**
 * mock 数据集 · ③  退化边界（单节点）
 *
 * 来源：DEV_DOC §8.3 评测集种子 #10（🔴 Bad Case）「最近有点烦」
 *       断言：只出根节点，【不编造】
 *
 * 这是整份评测集里最该被【肉眼看过】的一条。它验证的不是布局能力，
 * 而是产品的价值底线：模型面对一个无从下手的目标时，应该老实收手，
 * 而不是编出一棵"情绪管理知识树"来充数。
 *
 * 界面上看起来会很"空"——一个孤零零的节点。那个空就是正确答案。
 * D4 渲染时不要给它加任何"空状态提示"来美化，空着才对。
 *
 * 顺便：它也是布局算法的退化用例 —— 单节点时 d3 给 x=0, y=0，
 * 节点尺寸不能算成 0，否则画布上什么都看不见（D3 的边界之一）。
 */
import type { OutlineNode } from '../types/outline'
import { node } from './_helper'

export const vagueMood: OutlineNode[] = [
  // assignee=user：Agent 做不了任何事，这整件事只属于用户自己
  node('c30000000000', null, 0, '最近有点烦', {
    assignee: 'user',
    status: 'todo',
  }),
]
