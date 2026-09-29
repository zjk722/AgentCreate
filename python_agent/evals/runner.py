"""评测跑批 —— §12 的 A1，`make eval` 的落点。

**跑什么**：`corpus.json` 里每条种子**跑 5 次**，每次按断言判"过 / 不过"。

**为什么要跑多次**：模型每次输出都不一样（实测同一个目标，根节点的孩子数
一次是 9、一次是 7）。**只跑 1 次的话，"命中率 ≥ 阈值"非 0 即 1，那个阈值等于没有。**

**判什么**（§8.1 的三层 + corpus 自己的 `distribution` / `must_not_match`）：

    结构   —— `domain/validation.py` 的 7 条 + 节点数范围        ✅ 做了
    分布   —— 每种 `assignee` 的数量范围（`distribution`）        ✅ 做了
    覆盖   —— 方向命中率（对节点标题做子串匹配）                  ✅ 做了
    编造   —— 标题里不许出现的东西（`must_not_match` 正则）       ✅ 做了
    语义   —— LLM-as-judge（`judges.py`）                        ❌ **还没做**

⚠️ 而这四层的"做了"**不等于每颗种子都查了**：没写那一格断言的种子
   （骨架那几颗，`distribution` / `coverage` / `must_not_match` 是 `null`）
   报告里印 `—`，**不是** `5/5` —— 见下面的 `NOT_CHECKED`。

⚑ 语义层没做这件事会**打印在报告最上面**，不静默跳过（#13）。

**怎么算"这条种子合格"**（按档；阈值在下面的 `TIER_MIN_PASS`）：

    🟢 5 次里 ≥ 4 次通过
    🟡 5 次里 ≥ 3 次通过
    🔴 **不许倒退** —— 本次通过次数 < 基线才红

    ⚑ 关于 🔴：§8.3 说它「回归时一条都不许倒退」。这里读成**相对基线**，
      不是"必须 5/5"—— 如果模型本来就只有 4/5，那 4/5 就是它的水平，
      不退步就不该报警。这也正是 §8.4「关键指标**退化** → 拦截」的意思。
      ⚠️ 反过来，要求"5 次全绿"会天天红 → **报警疲劳**（§7.3）。

⚠️ **基线只在显式 `--update-baseline` 时更新。**

   每次跑完都自动把它当新基线的话，"退化"**永远检测不到** ——
   每次都自动原谅自己。那就成了 §8.4 那句话的反面：
   **没有回归门禁的评测集 = 摆设。**

用法：

    make eval                     # 跑一遍，和基线对比（退化则非零退出码）
    make eval ARGS=--update-baseline   # 把这次的结果接受为新基线
"""

import argparse
import hashlib
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from app.workflows.plan import plan_goal

EVALS_DIR = Path(__file__).resolve().parent
CORPUS = EVALS_DIR / "corpus.json"
BASELINE = EVALS_DIR / "baseline.json"


def corpus_fingerprint() -> str:
    """`corpus.json` 的指纹 —— 用来判断「这份基线是不是针对当前断言跑的」。

    ⚑ 为什么需要它：改了断言（关键词 / node_count / limits）之后，
      旧基线**不能再用来判退化** —— 它量的是**另一把尺子**。

      而没有指纹的话，这一点**看不出来**：基线文件里只有通过次数，
      没有"它是按哪版断言跑出来的"。于是你会拿一份不可比的东西去比，
      得到一个**假的退化**报告。

      ⚑ 那正是 #13 的形状：**它不报错，只是给你一个错的结论。**
    """
    return hashlib.sha256(CORPUS.read_bytes()).hexdigest()[:12]

# 每条种子跑几次。12 颗 × 5 = 60 —— 正好是 §12 给 A1 写的"60 条用例"。
RUNS = 5

# 按档的合格线：🟢 4/5、🟡 3/5。🔴 不在表里 —— 它走"不许倒退"，见模块说明。
#
# ⚠️ 写成【分数】而不是百分比，是有原因的：
#   0.8 在二进制里**不精确**（实际是 0.8000000000000000444…），
#   乘 5 得到 4.000000000000001 —— `ceil` 一下就变成 **5**，
#   阈值会**静默**从"4/5"变成"5/5"。整数算就不会有这种事。
TIER_MIN_PASS = {"green": (4, 5), "yellow": (3, 5)}


def _need(tier: str, runs: int) -> int:
    """这一档跑 `runs` 次，至少要过几次。整数向上取整，不做浮点。"""
    num, den = TIER_MIN_PASS.get(tier, (runs, runs))
    return -(-num * runs // den)

TIER_LABEL = {"green": "🟢 正常", "yellow": "🟡 边界", "red": "🔴 Bad Case"}

# 失败详情里最多印几个标题（2026-09-22 提成常量，原来是个裸的 12）。
# ⚑ 截断本身没问题（40 个节点的图会把报告淹掉），**问题是别截得无声无息** ——
#   要印"另有 N 个没印出来"。见 run_seed。
TITLE_PREVIEW = 12


# ── 四层断言 ─────────────────────────────────────────────────


class _NotChecked:
    """这一层**没有断言可查**（spec 是 `null` / 空）。

    ⚑ 它存在的唯一理由：把「**没接线**」和「**过了**」分开。

      以前两者都是 `None` —— 于是骨架种子在报告里印出
      「分布 5/5 · 覆盖 5/5 · 编造 5/5」，和**真查过**的种子长得一模一样。
      结果是"只查了 error"被读成"四层都验过了"✗

      ⚠️ 这正是 #13 的形状：**它不报错，只是给你一个看不出差别的数。**

    ⚑ 为什么不改成"在报告那边判断这层该不该查"：
      那就是**第二份实现** —— 判定函数里已经有「空 spec 就早退」这件事了，
      报告再判一次，两份迟早不一致（"判定说查过、报告说没查"）。
      这和 `coverage_hits()` 那条规矩是同一个道理：**"谁中了"/"查了没"只能有一处实现。**
    """

    __slots__ = ()

    def __repr__(self) -> str:
        # 报告里不直接印它（印的是 `—`），但调试时别显示成 <object at 0x…>
        return "NOT_CHECKED"


NOT_CHECKED = _NotChecked()


def _brief(issues: list[dict[str, Any]], limit: int = 3) -> str:
    """把 issue 摊成人话：`code` 只说【哪条规则】，`message` 才说【哪儿错了】。

    ⚑ 为什么要它（2026-09-22）：原来只印 `code`，于是 seed-05 的跑批报告写着

        有 1 个阻断性 error：E_TITLE_TOO_LONG

      而 `domain/validation.py` 生成的 message 里**明明写着**
      「第 12 个节点（下标 11）「HTTP/1.1到HTTP/3」：标题 15 字，超过 12 字上限」。
      **信息本来就有，在报告这一层被扔了** —— 定位真凶只能靠人工数字数。

    ⚑ 上面那句引文里的 code，当天晚些时候改名成 `W_TITLE_TOO_LONG` 并降成 🟡
      （见 §7.2 ① 的说明）。引文**保留原样** —— 那是当时报告真正印出来的字，
      改掉它就成了伪造历史。它现在走下面那条**白名单分支**，不是 error 分支。

    ⚠️ `limit` 是必要的：一个 40 节点的图可能有十几条 error，
       全摊出来会把报告淹掉。**但"还有几条没印"必须说出来** —— 不然又是静默截断。
    """
    shown = [f"[{i['code']}] {i['message']}" for i in issues[:limit]]
    if len(issues) > limit:
        shown.append(f"…另有 {len(issues) - limit} 条未展开")
    return "；".join(shown)


def judge_structure(
    nodes: list[dict[str, Any]], issues: list[dict[str, Any]], spec: dict[str, Any]
) -> str | None:
    """① 结构。过了返回 `None`，没过返回**原因**（人话）。

    ⚑ `error` 恒为 0 是**通用规则**，没写在 12 条数据里（见 README）——
       因为 `error` 的意思就是"这张图不能开工"（§7.1），没有哪条种子该容忍它。

    ⚑ 这一层**从不返回 `NOT_CHECKED`**：上面那条通用规则的意思就是
       "哪怕 `structure` 里只写了 `allowed_warnings`，它也**确实在查**东西"。
       别的三层都可能没接线，这一层不会。

    ⚑ **降级成 🟡 的检查落在这里的白名单分支** —— 这就是严重度和评测强度
      **互相独立**的原因。`W_TITLE_TOO_LONG` 2026-09-22 从 🔴 降成 🟡，
      而 12 颗种子的 `allowed_warnings` 全是 `[]`，所以它照样判红：
      ⇒ **用户不再被拦住开工（§7.1 的闸门），但 §8.3 种子 #11 的断言一条没松。**
      改严重度时别指望这里会跟着变 —— 它不该变。
    """
    errors = [i for i in issues if i["severity"] == "error"]
    if errors:
        return f"有 {len(errors)} 个阻断性 error：{_brief(errors)}"

    allowed = set(spec.get("allowed_warnings", []))
    bad = [i for i in issues if i["code"] not in allowed]
    if bad:
        # ⚑ 白名单的报错要**具体到 code** —— 说"warning 有 2 条"等于没说（见 README）。
        return f"出现了不在白名单里的 warning：{_brief(bad)}"

    n = len(nodes)
    bounds = spec.get("node_count", {})
    if "min" in bounds and n < bounds["min"]:
        return f"节点只有 {n} 个，少于下限 {bounds['min']}"
    if "max" in bounds and n > bounds["max"]:
        return f"节点有 {n} 个，超过上限 {bounds['max']}"

    return None


def judge_distribution(
    nodes: list[dict[str, Any]], spec: dict[str, Any]
) -> "str | None | _NotChecked":
    """③ `distribution`：每种 `assignee` 的数量范围。

    ⚠️ 这个字段有一阵子**根本没被检查** —— 数据里写着，而 runner 不读它。
       那正是"没人读的字段"，也正是这个项目最警惕的东西（#13 的温床）。
       seed-03 的「user: {min: 2}」当时就是这么白写的：看着像断言，实际不起作用。
    """
    if not spec:
        return NOT_CHECKED

    counts = Counter(n["assignee"] for n in nodes)
    for who, bounds in spec.items():
        n = counts.get(who, 0)
        if "min" in bounds and n < bounds["min"]:
            return f"{who} 只有 {n} 个，少于下限 {bounds['min']}"
        if "max" in bounds and n > bounds["max"]:
            return f"{who} 有 {n} 个，超过上限 {bounds['max']}"
    return None


def coverage_hits(
    nodes: list[dict[str, Any]], spec: dict[str, Any]
) -> list[tuple[tuple[str, ...], bool]]:
    """每个方向（一组同义词）**命中了没有**。

    ⚑ 这是"哪个方向中了"的**唯一实现** —— `judge_coverage` 拿它判通过，
      报告拿它统计"每个方向 5 次里中了几次"。
      报告要是自己再判一遍，迟早和判定不一致（"判定说过了、报告说没中"）。
    """
    groups = spec.get("must_contain") or []
    titles = "".join(n["title"] for n in nodes)
    return [(tuple(g), any(w in titles for w in g)) for g in groups]


def judge_coverage(
    nodes: list[dict[str, Any]], spec: dict[str, Any]
) -> "str | None | _NotChecked":
    """② 覆盖。`must_contain` 里**每一项是一个方向**（一组同义词），命中任一即算这个方向中。

    ⚑ 为什么是"一组"而不是一个词：模型对同一个概念有**多种说法**
      （实测：要「机票」，它说「往返航班」）。如果把同义词平铺成一串词，
      一个概念会占掉**两个名额** —— 命中一个概念就算两次命中，命中率会**虚高**。
      所以同义词必须归到同一组里。

    ⚑ 判据是**标题的子串** —— §8.3 说的是「含'监督学习'」；
       不要求"每个概念对应一个独立节点"（那太严，「监督学习基础」也该算中）。
    """
    hits = coverage_hits(nodes, spec)
    if not hits:
        # ⚑ 一个方向都没写 → **没得查**，不是"查了没问题"。
        #   注意判据是 `hits`（`must_contain` 里的方向数），不是 `spec` 本身 ——
        #   只写了 `min_hit_rate` 而没有方向的话，这一层同样什么都没查。
        return NOT_CHECKED

    good = [g for g, ok in hits if ok]
    rate = len(good) / len(hits)
    floor = spec.get("min_hit_rate", 1.0)

    if rate + 1e-9 < floor:
        missing = ["/".join(g) for g, ok in hits if not ok]
        return (
            f"方向命中 {len(good)}/{len(hits)}（{rate:.2f} < {floor}）"
            f"，缺：{'、'.join(missing)}"
        )
    return None


# ── 跑一条种子 ───────────────────────────────────────────────


def judge_no_fabrication(
    nodes: list[dict[str, Any]], spec: list[str]
) -> "str | None | _NotChecked":
    """④ `must_not_match`：标题里**不许出现**的东西（一组正则）。

    ⚑ 测的是 `§8.3` 的 #6 / #10 **已经写在文档里**的那条期望 ——「**不编造**」：

        #6  `"AI"`（两字符）      → 不编造、只出 1–2 层
        #10 「最近有点烦」         → 只出根节点，**不编造**

    它一直只有人眼看，没有机器守 ✓。而"信息严重不足时，模型自己编一个
    具体日期/人数出来"**在界面上看不出任何异常** —— 正是 #13。

    ⚑ 为什么用正则而不是关键词：要挡的是"**编出一个具体的值**"这一类，
       而具体的值本来就不确定 —— 只能按**形状**挡：
       `\\d{4}[-/年]`（编了个年份）、`\\d+\\s*人`（编了个人数）。

    ⚠️ 只查 `title`，**不查** `result_summary` / `evidence` ——
       那些是执行期才有的字段，规划输出里根本没有。
       写上去会永远通过 —— 又一个"没人读的字段"（见 `judge_distribution` 的说明）。

    ⚠️ 这条**只**能挡住"最糟的那种错"，挡不住"问得太少"。
       后者是主观的，断言它等于把一种风格焊死。见 `corpus.json` 里这条种子的 `note`。
    """
    if not spec:
        return NOT_CHECKED

    for n in nodes:
        for pattern in spec:
            if re.search(pattern, n["title"]):
                return f"标题「{n['title']}」编了不该有的东西（匹配 /{pattern}/）"
    return None


def resolve_goal(goal: str, seed_id: str = "") -> str:
    """种子的题目。如果它是个【文件路径】，把文件内容读出来。

    ⚑ 为什么需要它：README 早就写着「长文写成 `"inputs/xxx.txt"`」——
       而 runner **没有**这个代码 ✗。于是那个路径会被**原样当成目标**发给模型
       （"帮我规划一下 inputs/prod-req.txt"），拆出来的图看着挺正常，
       **报告里一切绿灯** ✗ —— 又一次 #13：错的东西看起来是对的。

       （同一个毛病 `distribution` 也犯过一次：数据里写着、runner 不读它。
         所以这条不是补功能，是**补一个文档已经承诺过的东西**。）

    ⚠️ 文件不存在时**直接报错**，绝不退回"把路径当目标" ✗ ——
       那正是上面那个坑，而且是**静默**的。
    """
    if not goal.endswith(".txt"):
        return goal

    path = EVALS_DIR / goal
    if not path.is_file():
        # ⚑ 报错要点名【是哪颗种子】的哪个文件 —— 只说路径的话，
        #   你还得自己去 corpus 里搜哪个种子引用了它。
        raise FileNotFoundError(
            f"种子的输入文件不存在（{seed_id or '某个种子'}）：{path}\n"
            f"  README 说长文写成 'inputs/xxx.txt' —— 那就得真有这个文件。\n"
            f"  要么把长文写进去，要么先跑别的种子（--only）。"
        )
    return path.read_text(encoding="utf-8")


def _tally(why: "str | None | _NotChecked") -> tuple[bool, bool]:
    """把判定函数的返回值摊成 `(这一层查了没, 这一层过了没)`。

    ⚑ `NOT_CHECKED` 的「过了」是 `True` —— **没有断言就不该拦住谁**。
      （否则骨架种子会因为"它本来就没写断言"而变红，那跟它的对错无关；
        同一个道理见 `judge_no_fabrication` 的说明。）

    ⚠️ 但「合格」**不是**「四层都验过」的意思 —— 报告里 `—` 和 `5/5` 必须分开显示，
       否则这个词会被读成"验过了"（#13）。

    ⚑ 还有一个后果是必须的：`NOT_CHECKED` 是个**对象**，为真 ——
      所以 `if why_d:` 这种真值判断会把"没查"当成"失败了"✗。
       下面一律用这里返回的布尔，**不再直接判 `why_*` 的真值**。
    """
    if why is NOT_CHECKED:
        return False, True
    return True, why is None


def run_seed(seed: dict[str, Any], runs: int) -> dict[str, Any]:
    """跑一条种子 `runs` 次，返回每一次的判定。"""
    limits = seed.get("limits", {})
    passed_struct = 0
    passed_dist = 0
    passed_cover = 0
    passed_fab = 0
    passed_all = 0
    # ⚑ 「这一层有没有接线」是**种子的性质**（由 spec 决定），五次必然一致 ——
    #   所以循环里反复赋值、最后那次说了算，不是笔误。
    checked: dict[str, bool] = {}
    failures: list[str] = []
    detail: list[dict[str, Any]] = []

    for k in range(runs):
        result = plan_goal(
            resolve_goal(seed["goal"], seed["id"]),
            max_depth=limits.get("max_depth", 5),
            max_children=limits.get("max_children", 9),
        )

        why_s = judge_structure(result.nodes, result.issues, seed["structure"])
        why_d = judge_distribution(result.nodes, seed.get("distribution") or {})
        why_c = judge_coverage(result.nodes, seed.get("coverage") or {})
        why_f = judge_no_fabrication(result.nodes, seed.get("must_not_match") or [])

        s_checked, s_ok = _tally(why_s)
        d_checked, d_ok = _tally(why_d)
        c_checked, c_ok = _tally(why_c)
        f_checked, f_ok = _tally(why_f)

        checked = {
            "struct": s_checked,
            "dist": d_checked,
            "cover": c_checked,
            "fab": f_checked,
        }

        passed_struct += int(s_ok)
        passed_dist += int(d_ok)
        passed_cover += int(c_ok)
        passed_fab += int(f_ok)
        # ⚑ "这条种子过了几次"必须是【所有已实现的层都过】的次数。
        #   ⚠️ 别用 min(结构, 分布, 覆盖) 代替 —— 那是**高估**：
        #   结构挂第 1 次、覆盖挂第 2 次时 min 说 4/5，
        #   而真正"全部通过"的只有 3 次。（这个坑第一版就踩了。）
        if s_ok and d_ok and c_ok and f_ok:
            passed_all += 1

        # ⚑ 每一次的原始数字都留下 —— **通过的也要**。
        #   调整断言时看的正是这些：节点数的分布、每个方向的命中率。
        #   只报"哪几次翻车了"的话，你手里就没有"正常时是什么样"。
        detail.append(
            {
                "nodes": len(result.nodes),
                "hits": [
                    ok for _, ok in coverage_hits(result.nodes, seed.get("coverage") or {})
                ],
                "warns": [i["code"] for i in result.issues if i["severity"] == "warning"],
                "assignees": Counter(n["assignee"] for n in result.nodes),
            }
        )

        # ⚑ 失败的那几次要留下**是怎么翻车的** —— 只报"红了"没用（#13 的口味）。
        step = f"第 {k + 1} 次"
        if not s_ok:
            step += f" · 结构：{why_s}"
        if not d_ok:
            step += f" · 分布：{why_d}"
        if not c_ok:
            step += f" · 覆盖：{why_c}"
        if not f_ok:
            step += f" · 编造：{why_f}"
        if not (s_ok and d_ok and c_ok and f_ok):
            # ⚠️ 只印前 `TITLE_PREVIEW` 个标题，**但别静默截断** ——
            #   原来截掉的那部分是**不说的**，而 seed-05 第 5 次的真凶
            #   恰好落在被截掉的 7 个里（19 个节点只印了 12 个）→ 查不到 (#13)。
            titles = "、".join(n["title"] for n in result.nodes[:TITLE_PREVIEW])
            hidden = len(result.nodes) - TITLE_PREVIEW
            if hidden > 0:
                titles += f"…（另有 {hidden} 个没印出来）"
            failures.append(f"{step}\n     它当时拆出的是：{titles}")

    return {
        "id": seed["id"],
        "tier": seed["tier"],
        "struct": passed_struct,
        "dist": passed_dist,
        "cover": passed_cover,
        "fab": passed_fab,
        "passed": passed_all,  # ⚑ 判定用的是这个 —— 见上面那段说明
        # ⚑ 哪几层**真查了** —— 报告拿它把"没接线"印成 `—` 而不是 `5/5`
        "checked": checked,
        "failures": failures,
        "detail": detail,
        # 方向的**标签**（五个跑次共用一份），报告里要拿它和每次的命中标志配对
        "dirs": [tuple(g) for g in (seed.get("coverage") or {}).get("must_contain", [])],
    }


# ── 报告 ─────────────────────────────────────────────────────


def _cell(checked: bool, passed: int, runs: int) -> str:
    """一层的一格。**没查过的印 `—` —— 不是 `5/5`，也不是 `0/5`。**

    ⚑ 两个错都得避，而且它们错的方向相反：
      · 印 `5/5` → 读成「过了」（这就是改这个函数的起因）
      · 印 `0/5` → 读成「全挂」，而实情是「没这一项」

    ⚑ `checked` 从判定函数自己来（`NOT_CHECKED`），不是报告这边另判一次 ——
      两份判断必然漂移，见 `_NotChecked` 的说明。
    """
    return f"{passed}/{runs}" if checked else "—"


def render(
    results: list[dict[str, Any]], baseline: dict[str, Any] | None, runs_per_seed: int
) -> bool:
    """打印报告。返回"有没有退化"（True = 有）。"""
    print(f"每条种子跑 {runs_per_seed} 次 · 共 {len(results) * runs_per_seed} 次调用")
    print()
    print("⚠️ 语义层（LLM-as-judge，`judges.py`）**还没做** —— 下面的判定只包含")
    print("   结构 / 分布 / 覆盖 / 编造 四层。")
    print("   所以这里的「通过」意思是「结构、归属、关键词都对，而且没编造」，")
    print("   **不包括**「拆得好不好」。")
    # ⚑ 只在真有种子缺断言时才印这句 —— 一句永远都在的图例会变成样板话，然后被无视。
    if any(not ok for r in results for ok in r["checked"].values()):
        print("   ⚠️ `—` 表示这条种子**没写**那一层的断言 —— 不是通过，也不是失败。")
    print()

    # ⚠️ 不做等宽对齐：中文字符在终端里占两个格子，`:<10` 补出来的列对不齐。
    #    （用空格硬凑的表格，换个字体就是歪的 —— 不如不装。）
    print("─" * 60)

    regressed = False
    for r in results:
        verdict, bad = _verdict(r, baseline, runs_per_seed)
        regressed = regressed or bad
        c = r["checked"]
        print(f"{r['id']}  {TIER_LABEL.get(r['tier'], r['tier'])}")
        print(
            f"    结构 {_cell(c['struct'], r['struct'], runs_per_seed)}"
            f" · 分布 {_cell(c['dist'], r['dist'], runs_per_seed)}"
            f" · 覆盖 {_cell(c['cover'], r['cover'], runs_per_seed)}"
            f" · 编造 {_cell(c['fab'], r['fab'], runs_per_seed)}"
            f" · {verdict}"
        )

    # ── 每条的明细（**通过的那几次也在内**）──────────────────────
    #
    # ⚑ 为什么通过了也要报：调整断言时看的**正是这些数字** ——
    #   "节点数该定多少"看的是它的分布，"这个关键词该不该必含"看的是它的命中率。
    #   只报失败的话，你手里的只有"哪几次翻车了"，没有"正常时是什么样"。
    print()
    print("── 每条种子的明细（含通过的那几次）──────────────────────")
    for r in results:
        d = r["detail"]
        if not d:
            continue
        print()
        print(f"{r['id']}：")

        nodes = [x["nodes"] for x in d]
        print(
            f"    节点数    {' / '.join(map(str, nodes))}"
            f"    （中位 {sorted(nodes)[len(nodes) // 2]}）"
        )
        for who in ("agent", "user", "blocked"):
            vals = [x["assignees"].get(who, 0) for x in d]
            if any(vals):
                print(f"    {who:<7}   {' / '.join(map(str, vals))}")

        if r["dirs"]:
            parts = []
            for i, g in enumerate(r["dirs"]):
                hit = sum(1 for x in d if x["hits"][i])
                parts.append(f"{'/'.join(g)} {hit}/{len(d)}")
            # ⚑ 逐条列出来（不是只报"命中 3/6"）—— 你要调的是**哪几个方向该必含**，
            #   而那要看**每个方向各自的命中率**：0/5 的和 5/5 的处理方式完全不同。
            print(f"    方向命中  {' · '.join(parts)}")

        warns = Counter(w for x in d for w in x["warns"])
        print(
            f"    warning   "
            f"{'、'.join(f'{w}×{n}' for w, n in warns.items()) if warns else '（无）'}"
        )

    if any(r["failures"] for r in results):
        print()
        print("── 失败的那几次，当时是什么样 ──────────────────────────")
        for r in results:
            if r["failures"]:
                print(f"\n{r['id']}：")
                for f in r["failures"]:
                    print(f"   {f}")

    return regressed


def _verdict(
    r: dict[str, Any], baseline: dict[str, Any] | None, runs: int
) -> tuple[str, bool]:
    """返回 (判定文字, 是否退化)。"""
    ok = r["passed"]  # ⚑ 由 run_seed 数出来的"所有已实现的层都过"的次数

    if r["tier"] == "red":
        if baseline is None:
            return "没有基线可比", False
        was = baseline.get(r["id"], {}).get("pass", 0)
        if ok < was:
            return f"🔴 退化（{was} → {ok}）", True
        return f"✅ 没退步（{was} → {ok}）", False

    need = _need(r["tier"], runs)
    if ok >= need:
        return f"✅ 合格（需 {need}/{runs}）", False
    return f"❌ 不合格（{ok} < {need}）", True


# ── 入口 ─────────────────────────────────────────────────────


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="A1：跑评测集，和基线对比")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="把这次的结果接受为新基线（⚠️ 只有显式指定才更新 —— 见模块说明）",
    )
    parser.add_argument("--runs", type=int, default=RUNS, help=f"每条跑几次（默认 {RUNS}）")
    parser.add_argument(
        "--only",
        help="只跑指定的种子（id，逗号分隔）。例：--only seed-03",
    )
    args = parser.parse_args()

    if args.runs < 1:
        # ⚠️ 不挡的话，`--runs 0` 会一路算成"0 次里过了 0 次≥阈值 0"→ **报合格** ✗
        #    一次什么都没跑的运行，最不该长得像"通过"。
        print("❌ --runs 至少要 1。")
        return 2

    seeds = json.loads(CORPUS.read_text(encoding="utf-8"))

    if args.only:
        want = [s.strip() for s in args.only.split(",") if s.strip()]
        known = {s["id"] for s in seeds}
        unknown = [w for w in want if w not in known]
        if unknown:
            # ⚠️ 不存在的 id 必须**报错**，不能"跑 0 条然后全绿" ——
            #    那会是一次**通过了的空跑**（#13 的教科书形态）。
            print(f"❌ --only 里这些 id 不存在：{'、'.join(unknown)}")
            print(f"   corpus 里有：{'、'.join(sorted(known))}")
            return 2
        seeds = [s for s in seeds if s["id"] in want]

    if not seeds:
        print("没有要跑的种子（corpus 是空的，或者 --only 没选中任何一条）。")
        return 1

    baseline = None
    if BASELINE.exists():
        raw = json.loads(BASELINE.read_text(encoding="utf-8"))
        stale = raw.get("corpus") != corpus_fingerprint()

        if stale and not args.update_baseline:
            # 要拿它比 → **拒绝**。见 corpus_fingerprint 的说明。
            print("❌ 这份基线是针对【另一版 corpus】跑的，**不能**拿来判退化。")
            print(f"   基线里记的: {raw.get('corpus')}    当前 corpus: {corpus_fingerprint()}")
            print()
            print("   改了断言（关键词 / node_count / limits）之后，旧基线量的是另一把尺子")
            print("   —— 拿它比会得到一个【假的退化】。")
            print("   要么删掉 baseline.json 重跑，要么跑 `ARGS=--update-baseline` 接受新成绩。")
            return 2

        if stale:
            # ⚑ 要**接受新成绩** → 旧基线**不拦，但不合并**。
            #   拦的话就等于"报错让你去做一件它自己不允许的事"（这个 bug 真发生过）。
            #   不合并是因为它量的是另一把尺子 —— 合并进来等于把旧断言的成绩
            #   混进新基线里，而**从文件里看不出来**。
            print("⚠️ 旧基线是针对【另一版 corpus】的 —— 这次【不合并】它。")
            print("   所以这次没跑到的种子，在新基线里会是**缺的**；等它们跑一次就补上。")
            print()
        else:
            baseline = raw.get("seeds") or {}

    try:
        try:
            results = [run_seed(s, args.runs) for s in seeds]
        except FileNotFoundError as e:
            # ⚑ 长文种子缺输入文件 → **明确报错**，不跳过 ✗
            #   静默跳过的话，报告里"少了一条种子"，而你不会知道为什么少
            #   —— 那就是 #13，只不过发生在评测自己的输出上。
            print(f"❌ {e}")
            return 2
    except KeyboardInterrupt:
        print("\n被打断了 —— 这次的结果不完整，不写基线。")
        return 130

    if args.only:
        print(f"⚠️ 只跑了 {len(results)} 条（--only）—— 别把这份报告读成「全部种子」的结果。")
        print()

    regressed = render(results, baseline, args.runs)

    # 跑了全部种子，还是只跑了几条？后面几处措辞都要跟着变 ——
    # 不然一份"只跑了一条"的报告会被读成"全部种子都合格"。
    scope = f"跑到的这 {len(results)} 条" if args.only else "全部种子"

    if args.update_baseline:
        # ⚑ **合并，不是覆盖。**
        #   用了 --only 时如果直接覆盖写，"没跑的那几条"的基线会被**静默删掉** ——
        #   下次跑全部时会退回"第一次跑"，而你还以为基线一直在。
        merged = dict(baseline or {})
        for r in results:
            merged[r["id"]] = {"pass": r["passed"], "tier": r["tier"]}
        BASELINE.write_text(
            # ⚑ 连**指纹**一起写 —— 下次跑的时候先比它，对不上就拒绝拿来比（见 corpus_fingerprint）
            json.dumps(
                {"corpus": corpus_fingerprint(), "seeds": merged},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print()
        print(f"✅ 基线已更新（{BASELINE.name}）—— 以后就跑它对比。")
        if args.only:
            print(f"   （只更新了 {scope}；其余种子的基线【原样保留】）")
        return 0

    if baseline is None:
        print()
        print("⚠️ 这是**第一次**跑，还没有基线 —— 所以上面的判定里没有「退化」这一项。")
        print("   看过觉得这次的成绩可以接受，就 `make eval ARGS=--update-baseline` 把它定为基线。")
        return 0

    print()
    if regressed:
        print(f"🚫 {scope}里有退化或不合格 —— 门禁不通过（非零退出码）。")
        return 1
    print(f"✅ {scope}合格，且没有退化。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
