/**
 * mock 数据的构造助手（内部用，不是数据集）。
 *
 * 为什么要有它：一个 OutlineNode 有 12 个字段，18 个节点全写满会淹没
 * 【真正的结构信息】—— 谁是谁的孩子、谁是特殊状态。用一个助手把
 * "最常见的情况"设为默认值，那么每一次 `over` 覆盖都是【一次有意的偏离】，
 * 读代码时一眼就能看出哪些节点是特殊的。
 *
 * ⚠️ 默认值本身也是一种断言：它假定「没有依赖、没被人工改过、没有审批」
 *   是最常见的形态。如果真实数据推翻了这个假定，改这里一处即可。
 */
import type { OutlineNode } from '../types/outline'

export function node(
  id: string,
  parent_id: string | null,
  order: number,
  title: string,
  over: Partial<OutlineNode> = {},
): OutlineNode {
  return {
    id,
    parent_id,
    order,
    title,
    assignee: 'agent',
    status: 'done',
    depends_on: [],
    locked: false,
    ...over,
  }
}
