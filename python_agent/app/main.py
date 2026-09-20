"""Python 引擎的 HTTP 入口（§11 的 `app/main.py`）。

⚠️ §9.4 的边界：这个服务**只在开发 / 内网可达**，不暴露公网。
   §3.1 的三层里，**前端只跟 Java 说话，Java 才跟它说话** ✓

   而它自己**仍然无状态**（§3.2）：不连库、不存会话、不知道 revision 是什么。
   加一个 HTTP 入口**没有**改变这一点 —— 每个请求自带完成它所需的全部信息。

启动：

    make serve          # = uv run uvicorn app.main:app --reload --port 8000
    然后 GET http://localhost:8000/health
"""

from fastapi import FastAPI

from app.api.v1.plan import router as plan_router

app = FastAPI(title="Agent 任务图引擎 · Python 引擎", version="0.0.1")
app.include_router(plan_router)


@app.get("/health")
def health() -> dict[str, str]:
    """起没起。

    ⚑ 这个端点不是摆设：**没有它，页面上分不清"后端没起来"和"模型调用失败"** ——
      而这两件事的修法完全相反（一个去启动服务，一个去看 key / 网络 / Prompt）。
       报错要能把人引向对的方向，这是最省事的一道保险。
    """
    return {"status": "ok"}
