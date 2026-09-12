/**
 * mock 数据集 · ②  任务型（视觉验证的主力）
 *
 * 来源：DEV_DOC §8.3 评测集种子 #2「帮我规划一次日本关西七日游」
 *       断言：扇出 ≤ 6、含 agent/user 分类
 *       图例直接取自 §1.2 的示例，我把它扩到了 14 个节点
 *
 * ⚑ 这份数据的用途是【把每一个视觉状态都覆盖到】。D4 渲染出来后，
 *   下面这些组合应该全部可见 —— 任何一个没出现，就说明配色系统漏了一格：
 *
 *   status   todo ✓  running ✓  done ✓  failed ✓  skipped ✓   （5/5）
 *   assignee agent ✓  user ✓  blocked ✓                        （3/3）
 *   approval 无 ✓   pending/confirm ✓  pending/double_confirm ✓  rejected ✓
 *   其他     locked ✓  evidence ✓  depends_on ✓  source_span ✓
 */
import type { OutlineNode } from '../types/outline'
import { node } from './_helper'

export const japanTrip: OutlineNode[] = [
  // 根节点正在跑 —— 用户看到的第一眼应该是"进行中"而不是"完成"
  node('b20000000000', null, 0, '准备一次日本关西七日游', {
    status: 'running',
  }),

  /* ── 一级分支 ─────────────────────────────────────────── */
  node('b20000000001', 'b20000000000', 0, '行前准备', { status: 'todo' }),
  node('b20000000002', 'b20000000000', 1, '预订安排', { status: 'todo' }),

  /* ── 行前准备 ─────────────────────────────────────────── */

  // 两个「agent + done + 有证据 + 有产出」—— §1.2 里带 [agent · done · 2.3s] 的那两条。
  // ⚑ 只有这两个节点同时有 result_summary 和 evidence：它们是"真正跑完并留下痕迹"
  //   的样本，是「证据链」这个卖点的完整形态。
  node('b20000000011', 'b20000000001', 0, '查往返机票价格', {
    result_summary: '往返 ¥3200，3/12 出发最低',
    evidence: {
      tool: 'flight_search',
      args: { from: '上海', to: '大阪', round_trip: true },
      result_ref: 'tool_call_9f2c',
      elapsed_ms: 2310,
      verified_at: '2026-09-12T09:02:11Z',
    },
  }),
  node('b20000000012', 'b20000000001', 1, '查当前汇率', {
    result_summary: '1 JPY ≈ 0.0482 CNY',
    evidence: {
      tool: 'fx_rate',
      args: { base: 'JPY', quote: 'CNY' },
      result_ref: 'tool_call_7a10',
      elapsed_ms: 820,
      verified_at: '2026-09-12T09:02:14Z',
    },
  }),

  // 这两个是「只能人来」—— 出行日期是个人偏好，签证要求本人到场。
  // ⚑ 注意 reason 是【枚举】不是一句话：界面上那句"需本人办理"
  //   由前端从枚举翻译（lib/reasons.ts），不由后端生成。
  node('b20000000013', 'b20000000001', 2, '决定出行日期', {
    assignee: 'user',
    assignee_reason: 'needs_human',
    status: 'todo',
  }),
  node('b20000000014', 'b20000000001', 3, '办理签证', {
    assignee: 'user',
    assignee_reason: 'needs_human',
    status: 'todo',
  }),

  /* ── 预订安排 ─────────────────────────────────────────── */

  // 🟡 单次确认：可逆操作（酒店能退）。§1.2 里那条 [agent · 待确认 · 有副作用]
  node('b20000000021', 'b20000000002', 0, '预订大阪酒店', {
    status: 'todo',
    depends_on: ['b20000000013'],
    approval: { level: 'confirm', status: 'pending' },
  }),

  node('b20000000022', 'b20000000002', 1, '预订京都民宿', {
    status: 'todo',
    // 依赖「决定出行日期」—— 没定日期就订不了房。
    // 这也是 DAG（depends_on）与树（parent_id）彼此独立的例子：
    // 它在树上属于「预订安排」，但在执行顺序上依赖「行前准备」里的节点。
    depends_on: ['b20000000013'],
  }),

  // 🔴 blocked：谁都做不了 —— 无可用工具。§1.2 里那条。
  // detail 只放【工具名】这种机器可读的短内容，不写句子。
  node('b20000000023', 'b20000000002', 2, '预订米其林餐厅', {
    assignee: 'blocked',
    assignee_reason: 'no_tool',
    assignee_detail: 'restaurant_booking',
    status: 'todo',
  }),

  // 被拒绝 + 人工改过（locked）。
  // 存储是 assignee=user + status=todo（§5.2 的 rejected 转移），
  // 视图会算成 'rejected' —— D4 应该显示成"被你否决，现在归你"。
  node('b20000000024', 'b20000000002', 3, '兑换日元', {
    assignee: 'user',
    assignee_reason: 'user_rejected',
    status: 'todo',
    locked: true,
    approval: { level: 'confirm', status: 'rejected' },
  }),

  // ⚑ Agent 失败了，【还没被处置】—— 等用户决定「我来处理」还是「不处理」。
  //   注意它保持 assignee=agent：`failed` 是一个待决定的中间态（§5.2 的降级表
  //   规定了失败后要转 user 或 blocked，但"重试也失败之后呢"文档没写）。
  node('b20000000025', 'b20000000002', 4, '购买旅行保险', {
    status: 'failed',
  }),

  // ⚑ 依赖保险 —— 这一条把两个状态串成了因果：
  //   它在初始状态是 `todo`，因为上游只是 failed、**还没被决定**。
  //   等你在对话区点「不处理」，上游变 skipped，**这时它才会级联跳过**。
  //   （早期版本这里直接写死 skipped 且没有依赖 —— 那是【讲不通】的数据。）
  node('b20000000026', 'b20000000002', 5, '打印行程单', {
    status: 'todo',
    depends_on: ['b20000000025'],
  }),

  // 🔴 二次确认 + RAG 溯源：不可逆操作（接送机一旦确认就扣款）
  node('b20000000027', 'b20000000002', 6, '预订接送机', {
    status: 'todo',
    approval: { level: 'double_confirm', status: 'pending' },
    source_span: [[12, 48]],
  }),
]
