"""`depends_on` 的解析：模型写的是【标题】，入库要的是【id】（§11）。

⚑ **为什么模型不直接写 id**：组装之前**还没有 id** ——
   id 是 `planner/outline.py` 组装时生成的（12 位 hex），
   而模型只能指着"我说过的某个节点"，用**它的标题** ✓
   （这是 `prompts.py` 顶部那四个决定里的第 4 条）

⚑ **为什么不用"序号"指认**（"第 3 条"）：序号**永远能解析成功** ✓ ——
   指错了也不会报错，只会得到一条**指错方向的依赖** ✗
   而标题**找不到**（或找到多个）能当场发现 ✓✓

⚠️ **这个文件只做映射，不做校验**：
   · 依赖成环 / 悬空 → 那是 §7.2 第 ③ 组的**读取期校验**（前端和 Java 都跑）
   · 指到自己       → 会变成一个**自环** ✓ 也交给那组校验
   这里只在「**指认不出来**」时报错 —— 因为那时候连一条依赖都构造不出来。
"""

from typing import Any


class DepResolveError(ValueError):
    """模型的 `depends_on` 指认不出来（找不到 / 匹配到多个 / 压根没写）。

    ⚠️ 这几种都必须**报错**，不能"猜一个"：
      猜错的后果是「那个任务永远等着一个不该等的东西」✗ ——
      而界面上它只是一个普普通通的「待办」，没有角标、没有报警（#13 的形状）。
    """


def resolve_depends(
    level_nodes: list[dict[str, Any]], nodes: list[dict[str, Any]]
) -> None:
    """把模型的【标题】依赖解析成【id】依赖，**就地**填进 `nodes[i]["depends_on"]`。

    两份输入**按下标一一对应**（`assemble` 不改变顺序 ✓）。

    ⚑ 为什么需要两份：一份有**标题**（模型写的 ✓）、一份有 **id**（组装出来的 ✓），
      而"标题 → id"的字典只有组装之后才建得出来 ✓
    """
    # 标题 → id 列表（用列表是因为**重名要能发现**，不是取第一个了事）
    by_title: dict[str, list[str]] = {}
    for n in nodes:
        by_title.setdefault(n["title"], []).append(n["id"])

    for i, raw in enumerate(level_nodes):
        title = raw.get("title")

        if "depends_on" not in raw:
            # ⚑ **"没说" 和 "说了没有" 是两回事** —— 后者是 `[]` ✓
            raise DepResolveError(
                f"第 {i + 1} 个节点（下标 {i}）{title!r} 没有 `depends_on` 字段 —— "
                "没有依赖要写 `[]`，不能省略（省略 = 没说，不是没有）"
            )

        labels = raw["depends_on"]
        if not isinstance(labels, list):
            raise DepResolveError(
                f"第 {i + 1} 个节点（下标 {i}）{title!r} 的 `depends_on` "
                f"不是数组，而是 {type(labels).__name__}"
            )

        ids: list[str] = []
        for label in labels:
            hit = by_title.get(label, [])
            if not hit:
                raise DepResolveError(
                    f"第 {i + 1} 个节点（下标 {i}）{title!r} 依赖了一个"
                    f"**不存在的标题** {label!r}"
                )
            if len(hit) > 1:
                raise DepResolveError(
                    f"第 {i + 1} 个节点（下标 {i}）{title!r} 依赖的标题 {label!r} "
                    f"匹配到了 **{len(hit)} 个**节点 —— 指哪个都可能是错的，"
                    "先让标题唯一"
                )
            ids.append(hit[0])

        nodes[i]["depends_on"] = ids
