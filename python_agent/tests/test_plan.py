"""`workflows/plan.py` 里那个"回答元问题"的函数的测试。

⚑ 这一组测的**不是"规划对不对"**（那要真调模型，是 A1 评测的活）——
   测的是「**这个结果能不能自证**」：

     改了 `prompts.py` 之后，我从这个响应里看不看得出
     **跑的是哪一版**？

   这是 #13（静默失败）的解药：让看不见的东西变成看得见。
   指纹没用的唯一方式是**它自己会抖** —— 那样"变没变"就判断不了，
   所以下面一半的测试都在钉"什么该影响它、什么不该"。
"""

import re

import app.workflows.plan as plan_mod
from app.llm.prompts import PLAN_OUTPUT_SCHEMA, SYSTEM_PROMPT
from app.workflows.plan import prompt_fingerprint


def test_是_8_位_hex():
    # 短是故意的：它要显示在页面上、要能一眼比 —— 不是拿来做密码的
    assert re.fullmatch(r"[0-9a-f]{8}", prompt_fingerprint())


def test_同一个_prompt_连续两次算出来一样():
    """⚠️ 这是它**能有用**的前提：指纹自己会抖的话，"变没变"就无从判断。

    最容易踩的是拿 `hash()` 而不是 sha256 —— str 的 `hash()` 每个进程
    都不同（PYTHONHASHSEED），于是重启一次指纹就变，看着像"Prompt 改了"。
    """
    assert prompt_fingerprint() == prompt_fingerprint()


def test_改了_system_prompt_指纹就变(monkeypatch):
    """⚑ 这一条是它**存在的全部理由** —— 改了 Prompt 而指纹不变，等于没做。

    ⚠️ patch 的是 `plan_mod` 上的名字，不是 `app.llm.prompts` 上的 ——
       `from ... import SYSTEM_PROMPT` 之后，它们已经是两个引用了。
    """
    before = prompt_fingerprint()
    monkeypatch.setattr(plan_mod, "SYSTEM_PROMPT", SYSTEM_PROMPT + "\n多加一条规则")
    assert prompt_fingerprint() != before


def test_改了输出_schema_指纹也变(monkeypatch):
    # schema 也是"发出去的东西"的一部分 —— 它变了就是另一版
    before = prompt_fingerprint()
    monkeypatch.setattr(plan_mod, "PLAN_OUTPUT_SCHEMA", {**PLAN_OUTPUT_SCHEMA, "extra": True})
    assert prompt_fingerprint() != before


def test_schema_里嵌套的键顺序也不该影响指纹(monkeypatch):
    """`sort_keys=True` 对**嵌套**同样生效 —— 而 schema 恰恰只长在嵌套里。

    ⚠️ 写这条时先把前提搞错了一次：以为顶层有几个键可以调换，
       实际顶层只有一个 `nodes` —— 真正的字段全在**里面的节点模板**上。
       所以"重排顶层"是个空操作，测试会以"前提不成立"失败。
       （前提断言就是为了在这种时候喊一声，而不是假装通过 ✓）

    ⚠️ 函数名里**不能有 `【】`** —— 中文可以当标识符，但 `【` 是标点，
       Python 会直接 `SyntaxError`（这条踩过）。

    不排序的话，随手把节点模板里的字段上下调一下，指纹就会变 ——
    而那会让人误以为 Prompt 改了。
    """
    node_template = PLAN_OUTPUT_SCHEMA["nodes"][0]
    keys = list(node_template)
    assert len(keys) >= 2, "这条测试要求节点模板至少有两个字段"

    reordered_node = {k: node_template[k] for k in reversed(keys)}
    assert list(reordered_node) != keys, "前提：顺序确实被调换了"

    before = prompt_fingerprint()
    patched = {
        **PLAN_OUTPUT_SCHEMA,
        "nodes": [reordered_node, *PLAN_OUTPUT_SCHEMA["nodes"][1:]],
    }
    # ⚠️ 这里【不能】断言 patched 和原来"不相等" —— dict 比较不看顺序，
    # 内容一样就是相等。能断言的只有结果：指纹没变。
    monkeypatch.setattr(plan_mod, "PLAN_OUTPUT_SCHEMA", patched)
    assert prompt_fingerprint() == before


def test_不含_goal_所以换目标不影响指纹():
    """⚠️ 这条守的是一个**签名上的事实**：它不收 goal。

    收了的后果是隐性的：每换一个目标指纹就变，于是"改了 Prompt 没有"
    这件事被目标的噪声盖掉 —— 指纹看着一直在变，等于没有指纹。
    """
    import inspect

    assert list(inspect.signature(prompt_fingerprint).parameters) == []
