"""`evals/runner.py` 里那条新判定的测试。

⚑ 只测 `judge_no_fabrication` —— 它是**纯函数**，不起模型、不花一分钱 ✓。

   而它守的是 §8.3 的 #6 / #10 那条**一直只有人眼看**的期望：「**不编造**」：

       #6  `"AI"`        → 不编造、只出 1–2 层
       #10 「最近有点烦」  → 只出根节点，不编造

   模型给一个含糊目标时自己编出具体日期/人数 —— **界面上看不出任何异常**（#13）。
   现在它有一条机器判的线了。
"""

import json

from evals.runner import (
    CORPUS,
    judge_coverage,
    judge_distribution,
    judge_no_fabrication,
    judge_structure,
)

PATTERNS = [r"\d{4}\s*[-/年]", r"\d+\s*人"]


def _t(title: str) -> dict:
    return {"title": title}


def test_干净的标题通过():
    assert judge_no_fabrication([_t("出行日期与天数"), _t("兴趣偏好")], PATTERNS) is None


def test_编了年份就报():
    why = judge_no_fabrication([_t("2026年关西之行")], PATTERNS)
    assert why is not None
    assert "2026年关西之行" in why


def test_编了人数就报():
    assert judge_no_fabrication([_t("确认2人同行")], PATTERNS) is not None


def test_没有写这些模式时恒通过():
    """⚠️ 别的 3 条种子都没写 `must_not_match` —— 那时这条判定必须**什么都不说**，
    而不是"没东西可查所以算失败"。后者会让老种子全红，而那跟它们的对错无关。
    """
    assert judge_no_fabrication([_t("2026年关西之行")], []) is None


def test_报错要说清是哪条标题和哪个模式():
    # ⚑ 只报"编造了"没用 —— 你得知道是哪一句、按什么判的（否则没法判断是误报还是真报）
    #
    # ⚠️ 函数名里**不能出现任何中文标点**（`、` `【` `（）` `：` …）——
    #    中文可以当标识符，但标点会让 Python 直接 `SyntaxError`。
    #    ⚑ 这条踩过两次：第一次只记住了 `【】` 那一个字符，没记住这条规则，
    #      于是第二次又用 `、` 撞了一遍。**规则是"标点一律不行"，不是某几个字。**
    why = judge_no_fabrication([_t("3天2晚行程")], [r"\d+\s*[天日]"])
    assert why is not None
    assert "3天2晚行程" in why
    assert "天日" in why


# ── corpus.json 本身 ─────────────────────────────────────────
#
# ⚑ 这一组一行模型都不调 —— 全是**免费的**。而它们守的东西，
#   恰恰是"跑起来才发现"的那类错（一次 5 个调用，才知道 JSON 坏了）。


def _corpus() -> list[dict]:
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def test_corpus_是合法_json():
    """⚑ 看着像句废话，但**手写 JSON 真的会坏** —— 2026-09-22 就坏过一次：

    `note` 里混进一个没转义的 `"`（`是"扇出会不会爆"`），于是报
    `Expecting ',' delimiter: line 161 column 97` ✗ ——
    **它不说那是引号的问题**，你得自己数到第 161 行去。
    """
    assert len(_corpus()) > 0


def test_每颗种子都有_runner_必须的字段():
    # ⚠️ runner 里写的是 `seed["structure"]`（不是 `.get`）——
    #    缺了会 **KeyError 崩在跑批半路**，而那时已经花掉几次调用了 ✗
    for s in _corpus():
        for k in ("id", "tier", "goal", "limits", "structure"):
            assert k in s, f"{s.get('id', '?')} 缺字段 {k}"
        assert s["tier"] in ("green", "yellow", "red"), s["id"]


def test_四个判定函数对每颗种子的断言都不炸():
    """四个判定拿**每颗种子的 spec** 都能跑完，不抛异常。

    ⚠️ 这里**只断言"不炸"，不断言判出什么** —— 空节点列表对一条
       `node_count: {min: 10}` 的种子本来就该判失败（`0 < min`），
       那是对的 ✓。（第一版这里写的 `is None`，就是错的 ✗。）

    ⚑ 专门守的是骨架种子那一类：它们的 `coverage` / `distribution` /
      `must_not_match` 都是 `null` —— 空 spec 必须**安全**处理，
      而不是在跑到第 7 颗种子时 KeyError 崩掉（那时已经花掉几次调用了 ✗）。

    ⚑ 但要注意：空 spec 的"通过" **不等于"测过了"** ✗ —— 它只查了 `error`。
      所以每颗骨架种子的 `note` 里都写明了"断言还没定"，
      否则"合格"会被读成"验过了"（#13 的形状）。
    """
    for s in _corpus():
        judge_structure([], [], s["structure"])
        judge_distribution([], s.get("distribution") or {})
        judge_coverage([], s.get("coverage") or {})
        judge_no_fabrication([], s.get("must_not_match") or [])


def test_长文种子的路径是相对_evals_的():
    """⚠️ `resolve_goal()` 读的是 `EVALS_DIR / goal` ——
    写成绝对路径、或者从仓库根算起的路径，都会找不到；
    而那种错**只在真跑的时候**才炸（又是 5 个调用之后）。"""
    for s in _corpus():
        if s["goal"].endswith(".txt"):
            assert s["goal"].startswith("inputs/"), f"{s['id']} 的路径不对：{s['goal']}"
