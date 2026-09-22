"""`evals/runner.py` 里那条新判定的测试。

⚑ 只测 `judge_no_fabrication` —— 它是**纯函数**，不起模型、不花一分钱 ✓。

   而它守的是 §8.3 的 #6 / #10 那条**一直只有人眼看**的期望：「**不编造**」：

       #6  `"AI"`        → 不编造、只出 1–2 层
       #10 「最近有点烦」  → 只出根节点，不编造

   模型给一个含糊目标时自己编出具体日期/人数 —— **界面上看不出任何异常**（#13）。
   现在它有一条机器判的线了。
"""

from evals.runner import judge_no_fabrication

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
