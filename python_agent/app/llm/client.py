"""调 DeepSeek —— §11 定的位置（`llm/client.py`）。

⚠️ 这个文件**不做**的事：
  · 不判断"要不要批准"（§3.2 边界铁律：那是 Host 的事）
  · 不知道 `revision` 是什么
  · **不重试** —— §5.2 那套重试分级针对的是【工具】，不是 LLM 调用。
    输出不合规该怎么办是 §7.4 那条 repair 环的事（等 A1 评测起来之后再谈）

⚑ 为什么用 json 模式，而不是"结构化输出"：

  DeepSeek 支持 `response_format={"type": "json_object"}`，但它**只保证"是合法 json"**，
  **不保证符合我们的 schema**。

  ⇒ 所以"模型没按 schema 吐"是一条**正常路径**，不是异常 ——
    这正是 §7.2 的校验和 §7.4 的 repair 存在的理由。
    这个文件只负责"发出去了 / 收回来了 / 是合法 json"，形状之外的一律不管。
"""

import json
import os
import time
from typing import Any

from openai import OpenAI

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"  # ⚑ 默认值，以官方文档为准；可用 DEEPSEEK_MODEL 覆盖


class PlanCallError(RuntimeError):
    """调用失败，或者收回来的东西不能用。"""


def _client() -> OpenAI:
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key:
        raise PlanCallError(
            "没有 DEEPSEEK_API_KEY。\n"
            "  在 python_agent/.env 里写一行：DEEPSEEK_API_KEY=sk-...\n"
            "  （.env 已被 .gitignore 挡住，不会进仓库；格式参考同目录的 .env.example）"
        )
    return OpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL),
    )


def call_json(
    messages: list[dict[str, str]], *, temperature: float = 0.2
) -> tuple[dict[str, Any], dict[str, int]]:
    """发一次请求，返回 `(解析后的 json, usage)`。

    失败一律抛错 —— **绝不返回半个结果**。半个结果比报错危险得多：
    它看着像成功，会让下游拿一份残缺的数据继续跑（§14.2 #13）。
    """
    model = os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL)

    # ⚑ 这一步【故意放在 try 外面】：缺 key 是"还没开始调"，不是"调用失败"。
    #   包进 try 的话，它会被下面那个兜底 except 再包一层，错误信息就变成
    #   "调用 DeepSeek 失败…：没有 DEEPSEEK_API_KEY" —— 于是读的人会去查网络和 API，
    #   而真正该做的是去填 .env。**一句说错话的报错，比没有报错更耽误时间。**
    client = _client()

    started = time.monotonic()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            response_format={"type": "json_object"},
            temperature=temperature,
        )
    except Exception as e:
        # openai SDK 的异常类型有一大堆（连接/鉴权/限流/超时…），
        # 这里统一包成一种领域错误，免得调用方去认它的类型。
        raise PlanCallError(f"调用 DeepSeek 失败（model={model}）：{type(e).__name__}: {e}") from e

    elapsed_ms = int((time.monotonic() - started) * 1000)
    text = (resp.choices[0].message.content or "").strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        # ⚑ 把原文打出来。只说"json 坏了"等于没说 ——
        #   你要看的是模型到底吐了什么，才知道 Prompt 该往哪儿改。
        raise PlanCallError(f"模型返回的不是合法 json（{e}）。原始返回：\n{text}") from e

    usage = {
        "input_tokens": getattr(resp.usage, "prompt_tokens", 0) or 0,
        "output_tokens": getattr(resp.usage, "completion_tokens", 0) or 0,
        "elapsed_ms": elapsed_ms,
    }
    return data, usage
