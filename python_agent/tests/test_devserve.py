"""`devserve.py` 的判据测试。

⚑ 只测**一件事**：`is_listening()` 判得准不准。

   它看着像一行小事，但整个 `serve` / `restart` 都建立在它上面 ——
   判错一边是"明明空着却说有人，起不来"，另一边是
   "**明明有人却说空着，于是叠了第二个进程**"。
   后者正是我们要根治的那个坑（Windows 允许两个 socket 绑同一端口，
   请求随机路由，"改了代码只有一半生效"）。

⚑ 为什么特意用【试连】当判据 —— 实测过一次 `netstat` 说谎：
   它报了个 PID，`tasklist` 查却"不存在"，而端口上真的有东西在应答。
   所以这个函数是**唯一可信的那条线**，值得单独钉住。
"""

import socket

from devserve import is_listening


def test_没人在听的时候是_False():
    # 挑一个几乎不可能被占的端口。⚠️ 万一真被占了，这条会红 ——
    #   那是**正确**的失败：判据说"有人"，而这时你正需要知道。
    assert is_listening(port=57321) is False


def test_有人在听的时候是_True():
    with socket.socket() as srv:
        srv.bind(("127.0.0.1", 0))  # 0 = 让系统随便给一个空闲端口
        srv.listen(1)
        port = srv.getsockname()[1]

        assert is_listening(port=port) is True

    # ⚑ 关掉之后必须回到 False —— 这正是 `restart` 依赖的那件事：
    #   "杀完等它真的放开端口"，而不是睡一觉然后假设它死了。
    assert is_listening(port=port) is False
