"""读 `shared/tools.json`（§4.4：Java Policy 和 Python 引擎共读的**同一份**）。

⚠️ 这里**只读**。写它的是人 —— 一旦程序能改工具清单，
   "两边对工具的理解不一致"就只是时间问题（§14.2 的镜像双后端）。

⚑ 为什么读取时要自检，而不是信任这个文件：

  `side_effect` 拼错一个字母（比如写成 `read-only`）**现在没有任何东西会拦**，
  而它一路决定**要不要拦住一次划钱**。

  所以缺字段 / 枚举不认识 → **直接失败**（§9.1 的默认拒绝）。
  这里刻意**不采用**"不认识就当成最严处理"那种写法：那是人写的配置里打了个错字，
  该在加载时喊出来，而不是让系统带着一个**猜出来的语义**继续跑下去。
"""

import json
from pathlib import Path
from typing import Any

# python_agent/app/tools/registry.py → 上溯 3 层 = 仓库根
TOOLS_JSON = Path(__file__).resolve().parents[3] / "shared" / "tools.json"

REQUIRED_KEYS = ("name", "description", "input_schema", "side_effect", "idempotency", "timeout_ms")
SIDE_EFFECTS = ("read_only", "reversible", "irreversible")
IDEMPOTENCY = ("natural", "keyed", "none")


class ToolRegistryError(RuntimeError):
    """工具注册表读不了，或者内容不合法。"""


def load_tools() -> list[dict[str, Any]]:
    if not TOOLS_JSON.exists():
        raise ToolRegistryError(
            f"找不到工具注册表：{TOOLS_JSON}\n"
            "  它是 Java Policy 和 Python 引擎共读的单一真源（§4.4），不能缺。"
        )
    try:
        tools = json.loads(TOOLS_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ToolRegistryError(f"{TOOLS_JSON} 不是合法 json：{e}") from e

    _check(tools)
    return tools


def _check(tools: Any) -> None:
    if not isinstance(tools, list):
        raise ToolRegistryError(f"{TOOLS_JSON.name} 的顶层应该是个数组，实际是 {type(tools).__name__}")
    if not tools:
        raise ToolRegistryError(f"{TOOLS_JSON.name} 是空的 —— 一个工具都没有，规划无从谈起")

    seen: set[str] = set()
    for i, t in enumerate(tools):
        if not isinstance(t, dict):
            raise ToolRegistryError(f"第 {i} 个工具不是对象，而是 {type(t).__name__}")

        missing = [k for k in REQUIRED_KEYS if k not in t]
        if missing:
            raise ToolRegistryError(f"第 {i} 个工具缺字段：{'、'.join(missing)}")

        name = t["name"]
        # 重名会让"按名字查工具"静默变成"查到最后那个"（同 E_DUPLICATE_ID 的坑）
        if name in seen:
            raise ToolRegistryError(f"工具名重复：{name!r} —— 按名字查会静默取到其中一个")
        seen.add(name)

        if t["side_effect"] not in SIDE_EFFECTS:
            raise ToolRegistryError(
                f"工具 {name!r} 的 side_effect={t['side_effect']!r} 不认识；"
                f"只能是 {'、'.join(SIDE_EFFECTS)} 之一"
            )
        if t["idempotency"] not in IDEMPOTENCY:
            raise ToolRegistryError(
                f"工具 {name!r} 的 idempotency={t['idempotency']!r} 不认识；"
                f"只能是 {'、'.join(IDEMPOTENCY)} 之一"
            )
