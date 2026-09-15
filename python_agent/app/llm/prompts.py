"""⭐ Prompt 集中在此。

位置是 §11 定的；所有权是 §13 第 8 条定的：
「**Prompt 全部**」属于**你自己写**的那一栏 —— 因为它是这个项目唯一的真差异化。

⚠️ 改这个文件之后，**先用 `make prompt GOAL="..."` 看一眼**，再跑真模型 ——
   它只打印【将要发出去】的内容，不调模型、不花钱。

   ⚑ 为什么必须这样：**Prompt 的格式错误是「隐形」的。**

   Python 有两件事会让"源码里看着好好的"和"实际发出去的"不一样：
     · 相邻字符串字面量会**自动拼接** —— 换行不当分隔符，两行粘成一句
     · 多行 f-string 会把**源码缩进带进正文** —— 行首凭空多出几个空格

   这两样**读源码都看不出来**。本文件已经各踩过一次了。

────────────────────────────────────────────────────────────────
为什么 schema（模型该吐什么形状）和 Prompt 挤在同一个文件里？

我们用 DeepSeek 的 **json 模式**：它只保证「输出是合法 json」，
**不保证符合你的 schema**（这跟 OpenAI 的结构化输出不一样，那边是把 JSON Schema
交给 API 去强制的）。所以"该吐什么形状"这件事**只能写在 Prompt 里** ——
schema 和 Prompt 本来就是同一件事的两半，分开放必然漂移
（同一个道理见 §4.4 的工具注册表、§14.2 的「镜像双后端」）。

────────────────────────────────────────────────────────────────
写多行 Prompt 的格式规矩（踩过两次才总结出来）：

    ✅ 每句一个**单行**字符串，用显式 `\n` 连接 —— 源码缩进永远在引号**外面**
    ❌ 别把字符串折行再对齐缩进 —— 那些空格会**变成正文**
    ❌ 别指望换行能当分隔符 —— 相邻字面量会自动粘成一句

────────────────────────────────────────────────────────────────
已经定下的四个答案

（当初的问题留在标题里，是为了以后回来看得见**为什么**这么定 —— 而不是只看到结论。）

  1. `level` 从 0 还是 1 开始？→ **1**（根是 1，子任务 +1）。
     ⚑ 组装器（`planner/outline.py`）本身两种都认 —— 它拿【第一个节点的 level】当基准。
     定成 1 是为了让 §7.2 ① 的 `E_LEVEL_SKIP` 有个判定基准（你的校验规则表要用）。

  2. 字段叫什么？→ **`level` / `title` / `assignee` / `proposed_tool` / `depends_on`**，
     照 §3.4 用，不另起名。改名字要同时改 `planner/outline.py` 的输入契约。

  3. `assignee` 让模型怎么填？→ **只填 `agent` / `user`**。
     ⚑ 它填的是【**提议**】，不是决定（ADR-2：提议 → Policy 裁决 → 用户确认）。
     `blocked` **不由模型填** —— 那是 Policy 拿工具清单查表得出的（§9.2）。
     理由：确定性的事不该交给概率性的东西，而"模型必然高估自己"正是 Policy 存在的意义。

  4. `depends_on` 走不走这个 schema？→ **走**，用【**标题**】指认别的节点。
     ⚑ 为什么不用序号：序号**永远能解析成功**，所以指错了也不报错；
     标题匹配不到（或匹配到多个）能当场发现。
     标题→id 的映射由 `planner/deps.py` 做，0 个 / 多个匹配都报错，**不猜**。
"""

import json
from typing import Any

# ══════════════════════════════════════════════════════════════
# ① 系统提示 —— 你填
# ══════════════════════════════════════════════════════════════

SYSTEM_PROMPT = ("根据用户需求决定你的身份,需要根据用户的目标,先进行需求分析,然后构造出一个具体方案流程,并将其渲染为思维导图的形式,"
                 "思维节点包括任务标题(标题字数<12),任务依赖(没做完就动不了的才算依赖,别把同级顺序当依赖,方向不要写反),"
                 "任务负责人(只能填user或agent),负责的可以是你也可以是用户,具体任务的负责人由你来提议,"
                 "level的语义(基准任务为1,子任务+1,不能跳级)"
                 )


# ══════════════════════════════════════════════════════════════
# ② 用户消息 —— 你填
# ══════════════════════════════════════════════════════════════
#
# 为什么给你一个**函数**而不是 `{goal}` 那样的模板字符串：
# 模板的 `.format()` 一碰到正文里的大括号就炸 —— 而写 Prompt 时到处是 json 例子。
# 而且它报的错（KeyError/IndexError）完全看不出是"模板里的花括号"引起的。
# 写成函数，你随便写，可用参数就在下面签名里。


def build_user_prompt(goal: str, tools_text: str, max_depth: int, max_children: int) -> str:
    """这一次的具体目标 + 可用工具 + 两个上限。

    参数：
        goal          用户的自然语言目标
        tools_text    可用工具清单，已经渲染成一段文字（见 render_tools）
        max_depth     深度上限（对应 §7.2 ① 的 W_DEPTH_EXCEEDED）
        max_children  扇出上限（对应 W_FANOUT_EXCEEDED）
    """

    return (f"用户的目标是{goal}。思维导图的深度不能大于{max_depth},每个节点的子节点不能大于{max_children}\n"
            f",任务所需用的工具由你来判断,可以是已有的工具也可以是没有的工具,如果需要调用工具才能完成任务,\n"
            f"\n可用工具如下{tools_text}")



# ══════════════════════════════════════════════════════════════
# ③ 模型输出 schema —— 你填
# ══════════════════════════════════════════════════════════════
#
# 这个 dict 会被【机械地】附在系统提示后面（见下面的 build_messages）——
# 所以你不必在自己写的 Prompt 正文里再重复一遍形状。**一处定义，两处用它。**
#
# ⚠️ 别写注释、别用 jsonc：它会被 json.dumps 直接渲染进 Prompt 原文，模型看得见。

PLAN_OUTPUT_SCHEMA: dict[str, Any] =  {
    "nodes": [
        {
            "level": 1,
            "title": "根任务的标题",
            "assignee": "agent",
            "proposed_tool": None,
            "depends_on": [],
        },
        {
            "level": 2,
            "title": "某个子任务的标题",
            "assignee": "user",
            "proposed_tool": None,
            "depends_on": [],
        },
        {
            "level": 2,
            "title": "另一个同级子任务",
            "assignee": "agent",
            "proposed_tool": "清单里的工具名",
            "depends_on": ["某个子任务的标题"],
        },
    ]
}


# ══════════════════════════════════════════════════════════════
# ④ 以下都是管道（机械部分，不是 Prompt 的灵魂）—— 想改随你
# ══════════════════════════════════════════════════════════════

# ⚠️ 这句话里同时出现小写 `json` 和大写 `JSON` 是**故意**的：
#    json 模式要求 Prompt 里出现 "json" 字样，但各家判断大小写的方式不一致。
SCHEMA_PREAMBLE = "输出必须是合法 json，且严格符合下面这个 JSON 形状："


class PromptNotWritten(RuntimeError):
    """Prompt 或 schema 还是空的 —— 见本文件顶部。"""


def render_tools(tools: list[dict[str, Any]]) -> str:
    """把 shared/tools.json 渲染成模型看得懂的一小段。

    ⚑ 只给 `name` + `side_effect` + `description`：
      · **不给 `input_schema`** —— A0 阶段它全是 null（参数要等 A4 才定），
        而工具选择的依据是 `description`（§3.4），不是参数表
      · 给 `side_effect` 是**可以商量的**：它决定的是【审批】，而审批是 Host 的事（§3.2）。
        给它的好处是模型不会随口提议一个不可逆的操作。先给着，你想撤就撤。
    """
    return "\n".join(
        f"- {t['name']}（{t['side_effect']}）：{t['description']}" for t in tools
    )


def build_messages(
    goal: str,
    tools: list[dict[str, Any]],
    max_depth: int,
    max_children: int,
) -> list[dict[str, str]]:
    """把 ①②③ 拼成一次请求的 messages。"""
    _require_written()
    schema_block = (
        SCHEMA_PREAMBLE + "\n" + json.dumps(PLAN_OUTPUT_SCHEMA, ensure_ascii=False, indent=2)
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT.strip() + "\n\n" + schema_block},
        {
            "role": "user",
            "content": build_user_prompt(
                goal, render_tools(tools), max_depth, max_children
            ),
        },
    ]


def _require_written() -> None:
    """空的东西要**报错**，不能静默发出去 —— 发出去只会得到一堆垃圾。"""
    missing = []
    if not SYSTEM_PROMPT.strip():
        missing.append("SYSTEM_PROMPT")
    if not PLAN_OUTPUT_SCHEMA:
        missing.append("PLAN_OUTPUT_SCHEMA")
    if missing:
        raise PromptNotWritten(
            "Prompt 还没写 —— 缺：" + "、".join(missing) + "\n"
            "  在 python_agent/app/llm/prompts.py 里填"
            "（§13 第 8 条：Prompt 全部自己写）。"
        )
