"""评测跑批 —— §12 的 A1，`make eval` 的落点。

**跑什么**：`corpus.json` 里每条种子**跑 5 次**，每次按断言判"过 / 不过"。

**为什么要跑多次**：模型每次输出都不一样（实测同一个目标，根节点的孩子数
一次是 9、一次是 7）。**只跑 1 次的话，"命中率 ≥ 阈值"非 0 即 1，那个阈值等于没有。**

**判什么**（§8.1 的三层 + corpus 自己的 `distribution`）：

    结构   —— `domain/validation.py` 的 7 条 + 节点数范围        ✅ 做了
    分布   —— 每种 `assignee` 的数量范围（`distribution`）        ✅ 做了
    覆盖   —— 方向命中率（对节点标题做子串匹配）                  ✅ 做了
    语义   —— LLM-as-judge（`judges.py`）                        ❌ **还没做**

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
import io
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from app.workflows.plan import plan_goal

EVALS_DIR = Path(__file__).resolve().parent
CORPUS = EVALS_DIR / "corpus.json"
BASELINE = EVALS_DIR / "baseline.json"

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


# ── 三层断言 ─────────────────────────────────────────────────


def judge_structure(
    nodes: list[dict[str, Any]], issues: list[dict[str, Any]], spec: dict[str, Any]
) -> str | None:
    """① 结构。过了返回 `None`，没过返回**原因**（人话）。

    ⚑ `error` 恒为 0 是**通用规则**，没写在 12 条数据里（见 README）——
       因为 `error` 的意思就是"这张图不能开工"（§7.1），没有哪条种子该容忍它。
    """
    errors = [i for i in issues if i["severity"] == "error"]
    if errors:
        return f"有 {len(errors)} 个阻断性 error：{'、'.join(i['code'] for i in errors)}"

    allowed = set(spec.get("allowed_warnings", []))
    bad = [i for i in issues if i["code"] not in allowed]
    if bad:
        # ⚑ 白名单的报错要**具体到 code** —— 说"warning 有 2 条"等于没说（见 README）。
        return f"出现了不在白名单里的 warning：{'、'.join(i['code'] for i in bad)}"

    n = len(nodes)
    bounds = spec.get("node_count", {})
    if "min" in bounds and n < bounds["min"]:
        return f"节点只有 {n} 个，少于下限 {bounds['min']}"
    if "max" in bounds and n > bounds["max"]:
        return f"节点有 {n} 个，超过上限 {bounds['max']}"

    return None


def judge_distribution(nodes: list[dict[str, Any]], spec: dict[str, Any]) -> str | None:
    """③ `distribution`：每种 `assignee` 的数量范围。

    ⚠️ 这个字段有一阵子**根本没被检查** —— 数据里写着，而 runner 不读它。
       那正是"没人读的字段"，也正是这个项目最警惕的东西（#13 的温床）。
       seed-03 的「user: {min: 2}」当时就是这么白写的：看着像断言，实际不起作用。
    """
    if not spec:
        return None

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


def judge_coverage(nodes: list[dict[str, Any]], spec: dict[str, Any]) -> str | None:
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
        return None

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


def run_seed(seed: dict[str, Any], runs: int) -> dict[str, Any]:
    """跑一条种子 `runs` 次，返回每一次的判定。"""
    limits = seed.get("limits", {})
    passed_struct = 0
    passed_dist = 0
    passed_cover = 0
    passed_all = 0
    failures: list[str] = []
    detail: list[dict[str, Any]] = []

    for k in range(runs):
        result = plan_goal(
            seed["goal"],
            max_depth=limits.get("max_depth", 3),
            max_children=limits.get("max_children", 6),
        )

        why_s = judge_structure(result.nodes, result.issues, seed["structure"])
        why_d = judge_distribution(result.nodes, seed.get("distribution") or {})
        why_c = judge_coverage(result.nodes, seed.get("coverage") or {})

        if why_s is None:
            passed_struct += 1
        if why_d is None:
            passed_dist += 1
        if why_c is None:
            passed_cover += 1
        # ⚑ "这条种子过了几次"必须是【所有已实现的层都过】的次数。
        #   ⚠️ 别用 min(结构, 分布, 覆盖) 代替 —— 那是**高估**：
        #   结构挂第 1 次、覆盖挂第 2 次时 min 说 4/5，
        #   而真正"全部通过"的只有 3 次。（这个坑第一版就踩了。）
        if why_s is None and why_d is None and why_c is None:
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
        if why_s:
            step += f" · 结构：{why_s}"
        if why_d:
            step += f" · 分布：{why_d}"
        if why_c:
            step += f" · 覆盖：{why_c}"
        if why_s or why_d or why_c:
            titles = "、".join(n["title"] for n in result.nodes[:12])
            failures.append(f"{step}\n     它当时拆出的是：{titles}")

    return {
        "id": seed["id"],
        "tier": seed["tier"],
        "struct": passed_struct,
        "dist": passed_dist,
        "cover": passed_cover,
        "passed": passed_all,  # ⚑ 判定用的是这个 —— 见上面那段说明
        "failures": failures,
        "detail": detail,
        # 方向的**标签**（五个跑次共用一份），报告里要拿它和每次的命中标志配对
        "dirs": [tuple(g) for g in (seed.get("coverage") or {}).get("must_contain", [])],
    }


# ── 报告 ─────────────────────────────────────────────────────


def render(
    results: list[dict[str, Any]], baseline: dict[str, Any] | None, runs_per_seed: int
) -> bool:
    """打印报告。返回"有没有退化"（True = 有）。"""
    print(f"每条种子跑 {runs_per_seed} 次 · 共 {len(results) * runs_per_seed} 次调用")
    print()
    print("⚠️ 语义层（LLM-as-judge，`judges.py`）**还没做** —— 下面的判定只包含")
    print("   结构 / 分布 / 覆盖 三层。")
    print("   所以这里的「通过」意思是「结构、归属、关键词都对」，**不包括**「拆得好不好」。")
    print()

    # ⚠️ 不做等宽对齐：中文字符在终端里占两个格子，`:<10` 补出来的列对不齐。
    #    （用空格硬凑的表格，换个字体就是歪的 —— 不如不装。）
    print("─" * 60)

    regressed = False
    for r in results:
        verdict, bad = _verdict(r, baseline, runs_per_seed)
        regressed = regressed or bad
        print(f"{r['id']}  {TIER_LABEL.get(r['tier'], r['tier'])}")
        print(
            f"    结构 {r['struct']}/{runs_per_seed} · 分布 {r['dist']}/{runs_per_seed}"
            f" · 覆盖 {r['cover']}/{runs_per_seed} · {verdict}"
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
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))

    try:
        results = [run_seed(s, args.runs) for s in seeds]
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
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
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
