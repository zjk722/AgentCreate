/**
 * mock 数据集 · ④  坏数据演示
 *
 * ⚠️ 这份【不是】§8.3 的评测集种子 —— 它是我为 D2 专门造的展示样本。
 *    前三份是"模型可能产出的合理输出"，这一份是"不该存在但会存在的输出"。
 *
 * 为什么需要它：D2 里有一半代码在处理坏数据（E_DUPLICATE_ID / E_ORPHAN_PARENT /
 * E_CYCLE_PARENT / W_ORDER_INVALID），但这些路径在好的数据集上永远不会触发。
 * 不造一份坏数据，就没法验证它们真的工作 —— 也没法在界面上看见
 * "坏数据被显式显示而不是静默丢弃"这个原则的落地效果。
 *
 * 这份数据同时踩了 4 个坑：
 *
 *   ① d4…0002 出现两次          → E_DUPLICATE_ID（后出现的被忽略）
 *   ② d4…0003 的父不存在        → E_ORPHAN_PARENT
 *   ③ d4…0004 ⇄ d4…0005 互为父  → E_CYCLE_PARENT（两个节点各报一条）
 *   ④ 根的孩子们 order 是 [0,2] → W_ORDER_INVALID（缺 1）
 *
 * 预期结果：roots = 1 棵（只有根 + 0001 + 0002）
 *          detached = [0003, 0004, 0005]
 *          issues = 1 error 重复 id + 1 error 孤儿 + 2 error 环 + 1 warning order
 */
import type { OutlineNode } from '../types/outline'
import { node } from './_helper'

export const corruptSample: OutlineNode[] = [
  node('d40000000000', null, 0, '演示：坏数据', { status: 'running' }),

  /* ① 正常的两个子节点 —— 但 order 是 [0, 2]，缺了 1 → W_ORDER_INVALID */
  node('d40000000001', 'd40000000000', 0, '正常子节点 A'),
  node('d40000000002', 'd40000000000', 2, '正常子节点 B'),

  /* ② 孤儿：父 id 指向一个不存在的节点。
   *    `d4deadbeef00` 是 12 位 hex，格式合法但没人用它当 id ——
   *    现实里这对应「拖拽操作做了一半」或「AI 的操作列表没落全」。 */
  node('d40000000003', 'd4deadbeef00', 0, '孤儿节点'),

  /* ③ 环：X 的父是 Y，Y 的父是 X。
   *    沿 parent_id 向上走会无限绕圈 —— 这就是为什么 classify() 必须有 onPath 集合。
   *    现实里这对应「人把 A 拖进 B、又把 B 拖进 A」（§5.3 允许拖拽调层级）。 */
  node('d40000000004', 'd40000000005', 0, '环上的节点 X'),
  node('d40000000005', 'd40000000004', 0, '环上的节点 Y'),

  /* ① 重复 id：与上面那个 d4…0002 撞了。
   *    Map 会静默覆盖，所以这条如果没被检测出来，界面上会莫名少一个节点。 */
  node('d40000000002', 'd40000000000', 1, '重复 id 的节点'),
]
