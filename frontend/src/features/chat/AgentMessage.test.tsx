/**
 * Agent 汇报卡片的渲染测试。
 *
 * ⚑ 重点验证【按钮的条件出现】—— 这是这个 demo 的核心交互：
 *   用户解开了阻塞，Agent 才能继续。按钮该出现时没出现，
 *   用户就会以为程序卡死了。
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildTree } from '../../lib/outline'
import { summarize } from '../../lib/summary'
import type { OutlineNode, StructureIssue } from '../../types/outline'
import { node } from '../../mocks/_helper'
import { datasets } from '../../mocks'
import { AgentMessage } from './AgentMessage'

const noop = () => {}

/**
 * ⚠️ renderToString 会在相邻的文本插值之间插入 `<!-- -->` 分隔注释，
 *   所以 `批准 {n} 项待确认` 在 HTML 里长这样：
 *
 *       批准 <!-- -->1<!-- --> 项待确认
 *
 *   断言整句就会失败 —— 但按钮其实是对的。先剥掉注释再断言。
 */
function strip(html: string): string {
  return html.replace(/<!--.*?-->/g, '')
}

function render(
  outline: OutlineNode[],
  opts: { canConfirm?: boolean; issues?: StructureIssue[] } = {},
): string {
  return strip(
    renderToString(
      <AgentMessage
        summary={summarize(outline, opts.issues ?? [])}
        canConfirm={opts.canConfirm ?? false}
        onConfirm={noop}
        onApproveAll={noop}
        onMarkUserDone={noop}
        onItemAction={noop}
      />,
    ),
  )
}

describe('AgentMessage · 内容', () => {
  it('显示 headline', () => {
    const html = render([node('a', null, 0, '甲', { status: 'done' })])
    expect(html).toContain('全部 1 项已完成')
  })

  it('⚑ 需要你做的：列出标题【和原因】', () => {
    const html = render([
      node('u', null, 0, '办理签证', {
        assignee: 'user',
        assignee_reason: 'needs_human',
        status: 'todo',
      }),
    ])
    expect(html).toContain('办理签证')
    // 原因由枚举翻译而来 —— 不是后端存的文字
    expect(html).toContain('只有你本人能做')
  })

  it('⚑ 卡住的：列出标题、原因和缺的工具名', () => {
    const html = render([
      node('b', null, 0, '预订米其林餐厅', {
        assignee: 'blocked',
        assignee_reason: 'no_tool',
        assignee_detail: 'restaurant_booking',
        status: 'todo',
      }),
    ])
    expect(html).toContain('预订米其林餐厅')
    expect(html).toContain('没有可用的工具能完成它')
    expect(html).toContain('restaurant_booking')
  })

  it('被否决的节点显示"你否决了"的原因', () => {
    const html = render([
      node('r', null, 0, '兑换日元', {
        assignee: 'user',
        assignee_reason: 'user_rejected',
        status: 'todo',
      }),
    ])
    expect(html).toContain('你否决了 Agent 的方案')
  })

  it('显示完成度分数', () => {
    const html = render([
      node('a', null, 0, '甲', { status: 'done' }),
      node('b', null, 1, '乙', { status: 'todo', assignee: 'user' }),
    ])
    expect(html).toContain('1/2')
  })
})

describe('AgentMessage · 按钮的条件出现', () => {
  it('canConfirm 时才出「确认并开始执行」', () => {
    const outline = [node('a', null, 0, '甲', { status: 'todo' })]
    expect(render(outline, { canConfirm: true })).toContain('确认并开始执行')
    expect(render(outline, { canConfirm: false })).not.toContain('确认并开始执行')
  })

  it('⚑⚑ 有【阻断性问题】时不给确认 —— §7.1 那道唯一的闸门', () => {
    // ⚑ 这条守的是全项目唯一一处"真的会拦住东西"的地方。
    //   在它之前，hasBlockingIssue() 只被用来算汇报的语气，
    //   顶上弹着"7 个错误（阻断）"、底下的「确认并开始执行」照样能点。
    //   **"报出来了"和"拦住了"是两回事。**
    const corrupt = datasets.find((d) => d.key === 'corrupt-sample')!
    const issues = buildTree(corrupt.outline).issues

    // 方案已出（canConfirm=true），但图是坏的
    const html = render(corrupt.outline, { canConfirm: true, issues })

    expect(html).not.toContain('确认并开始执行')
    // ⚠️ 而且必须【说明为什么】—— 按钮凭空消失而不解释，
    //   用户只会以为程序坏了。这正是 #13 要防的。
    expect(html).toContain('阻断性问题')
  })

  it('⚑ 只有警告不算阻断 —— order 不连续不该拦住执行', () => {
    // §7.1：error 阻断，warning 放行。把这条也钉住，
    // 免得哪天有人图省事改成"有 issue 就拦"，那会把一堆正常流程卡死。
    const outline = [node('r', null, 0, '根'), node('a', 'r', 0, '甲'), node('b', 'r', 2, '乙')]
    const warnOnly: StructureIssue[] = [
      { severity: 'warning', node_id: 'r', code: 'W_ORDER_INVALID', message: 'order 不对' },
    ]
    expect(render(outline, { canConfirm: true, issues: warnOnly })).toContain('确认并开始执行')
  })

  it('只有一条时不出批量按钮（冗余，且会让人以为两种操作不同）', () => {
    const one = [
      node('a', null, 0, '甲', { assignee: 'user', status: 'todo', approval: { level: 'confirm', status: 'pending' } }),
    ]
    const html = render(one)
    expect(html).not.toContain('全部批准')
    expect(html).not.toContain('全部标记完成')
  })

  it('多于一条时才出批量按钮，并标出数量', () => {
    const two = [
      node('a', null, 0, '甲', { assignee: 'user', status: 'todo' }),
      node('b', null, 1, '乙', { assignee: 'user', status: 'todo' }),
    ]
    expect(render(two)).toContain('全部标记完成（2）')
  })
})

describe('AgentMessage · 逐条操作（不是只能全选）', () => {
  it('⚑ 「需要你做的」每条都有自己的「完成」按钮', () => {
    const two = [
      node('a', null, 0, '甲', { assignee: 'user', status: 'todo' }),
      node('b', null, 1, '乙', { assignee: 'user', status: 'todo' }),
    ]
    const html = render(two)
    // 两个条目 → 两个「完成」按钮
    expect(html.match(/>完成</g)).toHaveLength(2)
  })

  it('⚑ 「等你点头」每条同时给「批准」和「否决」', () => {
    const one = [
      node('a', null, 0, '甲', { status: 'todo', approval: { level: 'confirm', status: 'pending' } }),
    ]
    const html = render(one)
    // "只能同意"不是审批，是通知 —— 两条路都要给
    expect(html).toContain('>批准<')
    expect(html).toContain('>否决<')
  })

  it('⚑ 失败的条目给「我来处理 / 不处理」两条路', () => {
    const one = [node('f', null, 0, '购买旅行保险', { status: 'failed' })]
    const html = render(one)
    expect(html).toContain('需要你决定')
    expect(html).toContain('购买旅行保险')
    // 系统不替用户判断"还值不值得做" —— 两条路都要给
    expect(html).toContain('我来处理')
    expect(html).toContain('不处理')
  })

  it('「需要你决定」排在其他组前面（它是唯一需要判断的）', () => {
    const outline = [
      node('f', null, 0, '失败的', { status: 'failed' }),
      node('u', null, 1, '归你的', { assignee: 'user', status: 'todo' }),
    ]
    const html = render(outline)
    expect(html.indexOf('需要你决定')).toBeLessThan(html.indexOf('需要你做'))
  })

  it('卡住的条目也给「完成」（用户在系统外解决后回来标记）', () => {
    const one = [
      node('a', null, 0, '甲', {
        assignee: 'blocked',
        assignee_reason: 'no_tool',
        status: 'todo',
      }),
    ]
    expect(render(one)).toContain('>完成<')
  })

  it('已完成的节点不出现在待办列表里（自然不会有多余按钮）', () => {
    const done = [node('a', null, 0, '甲', { assignee: 'user', status: 'done' })]
    const html = render(done)
    expect(html).not.toContain('需要你做')
    expect(html).not.toContain('>完成<')
  })
})

describe('AgentMessage · 真实数据集', () => {
  it('japan 数据集：能渲染出三类待办，不崩溃', () => {
    const japan = datasets.find((d) => d.key === 'japan-trip')!
    const html = strip(
      renderToString(
        <AgentMessage
          summary={summarize(japan.outline, [])}
          canConfirm
          onConfirm={noop}
          onApproveAll={noop}
          onMarkUserDone={noop}
          onItemAction={noop}
        />,
      ),
    )
    expect(html).toContain('需要你做')
    expect(html).toContain('卡住了')
    expect(html).toContain('等你点头')
    expect(html).toContain('办理签证')
    expect(html).toContain('预订米其林餐厅')
  })

  it('空图也能渲染（不崩）', () => {
    expect(() => render([])).not.toThrow()
  })
})
