"""`make serve` / `make restart` 的实现 —— 起、查、杀三件事都在这儿。

⚑ **为什么这段逻辑在 Python，不在 Makefile 里。**
   Makefile 自己的注释已经定了这条规矩：`&` / `start` / `netstat | findstr`
   那类写法**在 cmd 和 sh 里不一样**，而这个项目两个 shell 都要能跑。
   （写这一版时又实测撞了两个：`findstr /w` 直接报错；
     往 gbk 控制台打 ✓ / ✗ 会 `UnicodeEncodeError`。）
   放在 Python 里 —— **一份实现，两个 shell 走同一条路**。

⚑ **判据是【试连】，不是 `netstat`。**
   实测过一次：`netstat` 报 8000 上有个 PID 30588，`tasklist` 查它却
   "没有运行的任务匹配"，而端口上**真的有东西在答**（试连 → 200）。
   那是**幽灵 PID**。所以：

       能不能起  → 只认"连得上吗"
       杀谁      → 只认 pid 文件（**不猜、不扫端口**）

⚑ **为什么要有 pid 文件，而不是"杀掉占用 8000 的那个"。**
   杀进程**不可逆**。`restart` 只杀它**自己起过的**那个，
   绝不去动"端口的占用者" —— 那可能是别的东西，只有用户能判断。
   （和"不替用户放弃下游"是同一条原则：遇到需要判断的地方，让人决定。）

⚑ **pid 文件放系统临时目录，不放仓库里。**
   它是**每台机器一份**的开发残留，不是项目文件 ——
   放进仓库就得再改一次 `.gitignore`，而且早晚会被误提交。

⚠️ **§11 的目录结构里没有给开发脚本留位置**（顶层只有 `app/` `evals/` `tests/`），
   所以这个文件是放在 `python_agent/` 根下的一处**已知偏离** ——
   和 `evals/` 一样，等 v0.7 回写时一并记进 §11。
"""

from __future__ import annotations

import os
import signal
import socket
import sys
import tempfile
import time
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8000

PID_FILE = Path(tempfile.gettempdir()) / "mindmap_agent.uvicorn.pid"

# ⚑ 杀掉之后等它真的放开端口的上限。**不写死 sleep 1** ——
#   假设"睡一秒它就死了"的话，端口还没释放就 bind，会得到"起不来"而不知道原因。
SHUTDOWN_WAIT_S = 2.0
SHUTDOWN_POLL_S = 0.1


def is_listening(host: str = HOST, port: int = PORT, timeout: float = 0.4) -> bool:
    """端口上有没有人在应答 —— **这是唯一可信的判据**（见模块头部）。"""
    with socket.socket() as s:
        s.settimeout(timeout)
        return s.connect_ex((host, port)) == 0


def read_pid() -> int | None:
    try:
        return int(PID_FILE.read_text().strip())
    except (OSError, ValueError):
        return None


def _holder_hint() -> str:
    return (
        f'自己查一下是谁：netstat -ano | findstr ":{PORT}"'
        f"（⚠️ 那个 PID 可能是【幽灵】—— 查不到的话 tasklist 看一眼）"
    )


def serve() -> int:
    """起服务。

    ⚑ 端口被占就**报错退出** —— 不覆盖、也不代你杀。
      因为"再起一个"在 Windows 上**不会失败**，只会静默多一个进程。
    """
    if is_listening():
        print(
            f"❌ {PORT} 端口已经有人在听了 —— 再起一个会变成【两个进程抢同一个端口】",
            file=sys.stderr,
        )
        print(
            "   而 Windows 允许这样，请求会被【随机路由】：改了的代码只有一部分请求生效，",
            file=sys.stderr,
        )
        print("   界面上看不出来（要么去对比 Prompt 指纹，要么就撞上'改了没变'）。", file=sys.stderr)
        print("   → 要重启：make restart", file=sys.stderr)
        print(f"   → {_holder_hint()}", file=sys.stderr)
        return 1
    return _run()


def restart() -> int:
    """重启 —— 只杀【它自己起过的】那个（认 pid 文件）。"""
    if not is_listening():
        print(f"{PORT} 上本来就没人，直接起。")
        return _run()

    pid = read_pid()
    if pid is None:
        print(
            f"❌ {PORT} 上有人，但**没有 pid 文件** —— 不知道那是不是我们起的。",
            file=sys.stderr,
        )
        print("   不替你杀：杀进程不可逆，而且占着端口的那可能是别的东西。", file=sys.stderr)
        print(f"   → {_holder_hint()}", file=sys.stderr)
        return 1

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as e:
        print(f"❌ 停 pid {pid} 失败：{e}", file=sys.stderr)
        print(f"   → {_holder_hint()}", file=sys.stderr)
        return 1

    # ⚑ 停完**再试连**，而不是睡一觉然后假设它死了 —— 要的是"端口真的放开了"。
    deadline = time.monotonic() + SHUTDOWN_WAIT_S
    while is_listening() and time.monotonic() < deadline:
        time.sleep(SHUTDOWN_POLL_S)

    if is_listening():
        print(
            f"❌ 停掉了 pid {pid}，但 {PORT} 还被占着 —— 可能还有别的进程（或幽灵 PID）。",
            file=sys.stderr,
        )
        print(f"   → {_holder_hint()}", file=sys.stderr)
        return 1

    PID_FILE.unlink(missing_ok=True)
    print(f"已停掉 pid {pid}，重新起。")
    return _run()


def _run() -> int:
    import uvicorn

    # ⚑ 先写 pid，再起 —— 反过来的话，一个刚起来就崩的进程会留下假 pid。
    PID_FILE.write_text(str(os.getpid()))
    try:
        uvicorn.run(
            "app.main:app",
            host=HOST,
            port=PORT,
            # ⚑ **故意不带 `--reload`**（2026-09-22 去掉）：
            #   ① 它**有时灵有时不灵** —— 实测改完代码等 3 秒，PID 一次都没变；
            #      而同一个进程之前重载成功过。赌它，不如自己重启。
            #   ② 它是**双进程**（watcher + server）—— 杀掉一个另一个还活着，
            #      于是"重启了却没生效"，而且 netstat 报的 PID 可能是死的。
            #   既然结论本来就是"改完就重启"，`--reload` 只是让这件事更难管。
        )
    finally:
        # 正常退出（Ctrl-C）时清掉 pid 文件 —— 免得下次 restart 拿着一个假 pid 去杀。
        PID_FILE.unlink(missing_ok=True)
    return 0


COMMANDS = {"serve": serve, "restart": restart}


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if name not in COMMANDS:
        print(f"用法：python devserve.py [{'|'.join(COMMANDS)}]", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(COMMANDS[name]())
