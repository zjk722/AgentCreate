"""`evals/runner.py` 里那几条判定的测试。

⚑ 全是**纯函数** —— 不起模型、不花一分钱 ✓。

   其中最要紧的一条守的是 §8.3 的 #6 / #10 —— 那条**一直只有人眼看**的期望：「**不编造**」：

       #6  `"AI"`        → 不编造、只出 1–2 层
       #10 「最近有点烦」  → 只出根节点，不编造

   模型给一个含糊目标时自己编出具体日期/人数 —— **界面上看不出任何异常**（#13）。
   现在它有一条机器判的线了。

⚑ 2026-09-22 加的那组守的是同一个毛病的另一半：**报告把"没查"显示成"过了"**。
   骨架种子（`distribution` / `coverage` / `must_not_match` 全是 `null`）以前
   印出「分布 5/5 · 覆盖 5/5 · 编造 5/5」，和真查过的种子长得一模一样 ——
   于是"只查了 error"被读成"四层都验过了"。
"""

import json

from evals.runner import (
    CORPUS,
    NOT_CHECKED,
    _cell,
    _tally,
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


def test_没有写这些模式时不报失败():
    """⚠️ 别的 3 条种子都没写 `must_not_match` —— 那时这条判定不能算**失败**，
    否则那些种子会无辜全红，而那跟它们的对错无关。

    ⚑ 2026-09-22 改的：返回值从 `None` 换成了 `NOT_CHECKED`。
      变的是**这一个值**，不是这条判定 —— 因为 `None` 原来同时兼任两个意思
      （「查了、过了」和「没得查」），报告于是把后者也印成 `5/5`。
      现在返回值要能表达三态：过了 / 没过 / 没得查。
    """
    why = judge_no_fabrication([_t("2026年关西之行")], [])
    assert why is NOT_CHECKED, f"空 spec 该是「没得查」，而它给了：{why!r}"
    assert not isinstance(why, str), "⚠️ 它必须是「没得查」，不是一条失败原因"


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


# ── 「没查」和「过了」必须分得开 ───────────────────────────────
#
# ⚑ 守的是 #9，只不过发生在报告自己身上：**"没查"和"查了没问题"长得一样**。
#
#   骨架种子（`distribution` / `coverage` / `must_not_match` 全是 `null`）以前
#   印出「分布 5/5 · 覆盖 5/5 · 编造 5/5」—— 和真查过的种子一模一样，
#   于是"只查了 error"被读成"四层都验过了"。


def test_空_spec_的三层都报没得查():
    assert judge_distribution([], {}) is NOT_CHECKED
    assert judge_coverage([], {}) is NOT_CHECKED
    assert judge_no_fabrication([], []) is NOT_CHECKED


def test_只写了阈值没写方向也算没得查():
    """⚑ `judge_coverage` 的判据是**方向数**，不是 `spec` 本身 ——
    只给 `min_hit_rate` 而一个方向都没写时，这一层同样什么都没查。"""
    assert judge_coverage([], {"min_hit_rate": 0.5}) is NOT_CHECKED


def test_结构层永远算查过():
    """⚑ `error` 恒为 0 是**通用规则** —— 哪怕 `structure` 里只写了
    `allowed_warnings`，这一层也**确实在查**东西，所以它从不返回 `NOT_CHECKED`
    （空图没有 error、没有 warning → 过）。"""
    assert judge_structure([], [], {"allowed_warnings": []}) is None


def test_没得查的那一层不拦住谁():
    """`NOT_CHECKED` 的「过了」必须是 True，否则骨架种子会无辜变红
    （而那跟它们的对错无关 —— 见 `test_没有写这些模式时不报失败`）。"""
    assert _tally(NOT_CHECKED) == (False, True)
    assert _tally(None) == (True, True)
    assert _tally("出了 1 个问题") == (True, False)


def test_报告把没查的那一格印成破折号():
    assert _cell(True, 3, 5) == "3/5"
    # ⚑ 下面两条就是这个函数存在的理由 —— 错的方向相反，都得挡：
    assert _cell(False, 5, 5) == "—"  # 不能印 5/5（那读成「过了」）
    assert _cell(False, 0, 5) == "—"  # 不能印 0/5（那读成「全挂」）


def test_结构失败要说清是哪个节点():
    """⚑ 光印 `code` 只说【哪条规则】，不说是【哪儿】。

    2026-09-22 的 seed-05 跑批就是这么翻的：报告写着
    「有 1 个阻断性 error：E_TITLE_TOO_LONG」，而真凶是 15 字的
    「HTTP/1.1到HTTP/3」—— 只能靠**人工数字数**才找得出来。
    而 `domain/validation.py` 生成的 message 里本来就写着是第几个、多少字。

    ⚑ 那个 code 当天晚些时候改名成 `W_TITLE_TOO_LONG` 并降成 🟡（见 §7.2 ① 的说明），
      所以它现在走**白名单分支**而不是 error 分支。
      **两个分支各自拼字符串，所以两条都得钉** —— 只钉一条的话，
      另一条的 message 被丢掉时不会有东西变红。
    """
    msg = "第 12 个节点（下标 11）「HTTP/1.1到HTTP/3」：标题 34 字，超过 20 字上限"

    def issue(severity: str, code: str) -> dict:
        return {"severity": severity, "node_id": None, "code": code, "message": msg}

    # ① 白名单分支 —— 超长标题现在走这条
    why_w = judge_structure([], [issue("warning", "W_TITLE_TOO_LONG")], {"allowed_warnings": []})
    assert why_w is not None
    assert "W_TITLE_TOO_LONG" in why_w  # 哪条规则
    assert "第 12 个节点" in why_w  # 哪儿 —— 这一半以前是丢的
    assert "HTTP/1.1到HTTP/3" in why_w

    # ② error 分支 —— 别的阻断错走这条
    why_e = judge_structure([], [issue("error", "E_LEVEL_SKIP")], {"allowed_warnings": []})
    assert why_e is not None
    assert "E_LEVEL_SKIP" in why_e
    assert "第 12 个节点" in why_e


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
