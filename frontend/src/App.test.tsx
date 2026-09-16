/**
 * `Composer` 的渲染测试 —— 只测一件事：
 * **「当前数据集的来源说明」真的被画到屏幕上。**
 *
 * ⚑ 为什么这条非有不可：
 *   `noteFor()` 的逻辑已经在 `mocks/index.test.ts` 里测过了 ——
 *   但那测的是"**该显示哪句话**"（逻辑）。
 *   如果有人改版式时顺手删掉那行 `<p>`，**那些测试照样全绿**：
 *   函数还在、还算得对，而屏幕上"这份数据哪来的"没有了。
 *
 *   **功能没了、检查却还在通过** —— 因为检查的是错的东西。这就是 #13 的形状。
 *
 * ⚠️ 这条测试**也测不到什么**，见文件末尾。
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Composer } from './App'
import { datasets } from './mocks'

const noop = () => {}

/**
 * ⚠️ 三个坑，都收在这里，免得每条断言各踩一次：
 *
 *   ① `renderToString` 会在**相邻**的文本插值之间插 `<!-- -->` 分隔注释，
 *      整句断言会失败 —— 而界面其实是对的。（详见 AgentMessage.test.tsx）
 *   ② 它还会把 `&` `<` `"` 这类字符**转义**成 HTML 实体。
 *      今天这几条 note 里没有这些字符，以后有的话断言要跟着改。
 *   ③ ⚑ **每一句 note 在按钮的 `title` 属性里也有一份**（悬停提示，故意保留的另一条防线）。
 *      所以"在整页 HTML 上 toContain(note)"是一条**假断言** ——
 *      **把 `<p>` 整个删掉它照样通过**。
 *
 *      这和推送 5 那个坑是同一个物种：
 *      `toContain('node-enter')` 被 `'node-enter-root'` 满足 —— 恒真、等于没测。
 *      （本条测试的第一版就踩了：另一条断言变红时顺带把它照出来了。）
 *
 *      `withoutTitles()` 就是为这个存在的：抠掉 title 之后，
 *      "这句话出现在页面上"才真的等于"它被画出来了"。
 */
function withoutTitles(html: string): string {
  return html.replace(/<!--.*?-->/g, '').replace(/title="[^"]*"/g, '')
}

function render(activeKey: string | null): string {
  return withoutTitles(
    renderToString(
      <Composer input="" onInput={noop} onSubmit={noop} activeKey={activeKey} onPick={noop} />,
    ),
  )
}

/** 要的就是原始 HTML（专门用来验证 `title` 那条防线还在） */
function renderRaw(activeKey: string | null): string {
  return renderToString(
    <Composer input="" onInput={noop} onSubmit={noop} activeKey={activeKey} onPick={noop} />,
  )
}

const noteOf = (key: string) => datasets.find((d) => d.key === key)!.note

describe('Composer 的来源说明', () => {
  it('⚑ 当前数据集的说明真的出现在屏幕上', () => {
    expect(render('japan-trip')).toContain(noteOf('japan-trip'))
  })

  it('⚑ 换一份数据，说明跟着换 —— 否则用户看的是 A，读的是 B 的来历', () => {
    const html = render('ml-knowledge')
    expect(html).toContain(noteOf('ml-knowledge'))
    expect(html).not.toContain(noteOf('japan-trip'))
  })

  it('没选数据集时也有话说（空白的那一行等于没有这道防线）', () => {
    expect(render(null)).toContain('手造的样本')
  })

  it('⚠️ 开头的说明会标红 —— warning 算出来了，还得真用上', () => {
    // 光有 `noteFor()` 返回 `warning: true` 是不够的：
    // 那个布尔值必须真被用在这个 <p> 的类名上，红字才会出现。
    expect(render('corrupt-sample')).toContain('text-red-600')
  })

  it('普通说明不标红 —— 满屏红字等于没有红字', () => {
    // ⚠️ 这是一条**否定**断言，它有个天然的弱点：**把整个 `<p>` 删掉它照样通过**
    //    （"不存在红色的东西"在"什么都没有"的时候也成立）。
    //    ⚑ 所以它必须和上面那些**肯定**断言一起读：它们负责"东西在"，
    //      它负责"在的东西不是红的"。单独看它，等于没测。
    expect(render('japan-trip')).not.toContain('text-red-600')
  })

  it('按钮的悬停提示仍然带着 note —— 那是另一条防线，这次没把它删掉', () => {
    // ⚑ 这条测试还有个副作用：它把 `withoutTitles()` 存在的理由钉在了这里。
    //   如果哪天有人删了 title，这条会红 —— 而"为什么不能删 title"上面写了。
    expect(renderRaw(null)).toContain(`title="${noteOf('japan-trip')}"`)
  })
})

/**
 * ⚠️ 这个文件**测不到什么** —— 说清楚，免得给人虚假的安全感：
 *
 *   `renderToString` 只产出**静态 HTML**，没有事件处理，所以这些测不了：
 *
 *     · 点数据集按钮 → `onPick` 收到那份数据        ❌
 *     · 在输入框打字 / 按 Enter → `onInput`/`onSubmit` 被调用   ❌
 *
 *   而且这不是这一个文件的问题：**前端 5 个渲染测试全是这个基座**
 *   （没装 testing-library / jsdom），所以**一条交互测试都没有**。
 *
 *   对一个核心交互是「点击批准 / 拖拽改层级 / 对话输入」的产品，
 *   这是一个真实的盲区 —— 补不补、用什么补，是一件要单独决定的事。
 */
