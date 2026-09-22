# 唯一入口 —— §11 把 Makefile 定成唯一入口（附录 A 的 F1 模式）。
#
# ⚠️ 这里只放【已经能用】的目标。
#    空的目标比没有目标更糟：它会让人以为那件事已经做过了 ——
#    这正是 #13（静默失败）在工具链上的形态。
#    所以 migrate / gen-api 现在【故意不在】这里：它们还没东西可指。
#
# 用法：
#     make plan GOAL="准备一次日本关西七日游"
#     make test

GOAL ?= 准备一次日本关西七日游

# ⚑ Windows 控制台的默认代码页不是 UTF-8，不设它的话中文会变成乱码 ——
#   而**失败时最需要读的正是那几行**。
#
# ⚠️ 写成 `export VAR = ...`（make 自己导出），**不要**写成
#   `VAR=value uv run ...` 那种"变量前缀" —— 那是 **sh 的语法，cmd.exe 不认**。
#   实测过：从 cmd 里跑 `make eval` 会报
#       'PYTHONIOENCODING' 不是内部或外部命令
#   因为 make 在 cmd 下用的是 cmd.exe 当 shell。
#   `export` 是 make 层的事，**与 shell 无关**，两边都能用。
export PYTHONIOENCODING = utf-8

.PHONY: help plan prompt test eval serve restart web

help:
	@echo 'make plan GOAL="..."   目标 → 任务图骨架（调真模型；Prompt 没写会明确报错）'
	@echo 'make prompt GOAL="..." 只打印【将要发出去】的内容，不调模型（零成本）'
	@echo 'make test               Python 侧的测试'
	@echo 'make eval               A1 评测跑批（会花钱调模型；退化时非零退出码）'
	@echo 'make eval ARGS="--only seed-03"   只跑一条种子（省 2/3 的调用）'
	@echo 'make serve              起后端（§3.4 的 /v1/plan，端口 8000）'
	@echo '                        ⚠️ 端口已被占时【报错退出】，不叠加第二个进程'
	@echo 'make restart            重启后端（只杀它自己起过的那个，不碰别的）'
	@echo 'make web                起前端（Vite，端口 5173；第一次先 npm install）'
	@echo '                        ⚑ 前后端是【两个终端】各跑一条 —— 见下面说明'

# ⚑ PYTHONIOENCODING=utf-8 不是装饰：Windows 控制台的默认代码页不是 UTF-8，
#   不设它的话 pytest 报告里的中文会变成乱码 —— 而**失败时最需要读的正是那几行**。
#   （cli.py 里也单独 reconfigure 过一次 stdout，两者是不同层面的保险。）

plan:
	@cd python_agent && uv run python -m app.cli --goal "$(GOAL)"

# 改 Prompt 时的回路：不用 key、不花钱，先把要发出去的东西看一遍。
prompt:
	@cd python_agent && uv run python -m app.cli --goal "$(GOAL)" --dry-run

test:
	@cd python_agent && uv run pytest -q

# A1 的评测跑批。退化时非零退出码（§8.4 的回归门禁）。
# ⚠️ 基线只在 `ARGS=--update-baseline` 时才更新 —— 否则"退化"永远检测不到。
eval:
	@cd python_agent && uv run python -m evals.runner $(ARGS)

# 起后端 HTTP 服务 —— §3.4 的 /v1/plan。
#
# ⚑ 端口被占时**报错退出**，不叠加第二个进程。这件事值得单独做，是因为：
#   **Windows 允许两个 socket 绑同一个端口**（Linux 会直接报错 `Address already
#   in use`，你当场就发现了）。于是"再起一个"不会失败，只会让请求**随机**落到
#   旧的那个 —— 「改了代码只有一部分请求生效」，而界面上看不出来（#13）。
#
# ⚑ 逻辑在 `devserve.py`，不在这儿 —— 见那个文件的头部（判据是【试连】不是
#   netstat；pid 文件放系统临时目录）。
#   ⚠️ 特别是**别**把这里改成 `&` / `start` 那套后台写法：它在 cmd 和 sh 里不一样，
#      和下面 `web` 那条注释里说的是同一类坑。
#
# ⚑ **故意不带 `--reload`**（理由写在 `devserve.py` 里）—— 它有时灵有时不灵，
#   而且是双进程，会让"杀掉重启"变得不可靠。既然结论就是"改完就重启"，
#   那就手动重启，别让它挡在中间。
#
# ⚑ 只在本地可达，不暴露公网（§9.4）。
serve:
	@cd python_agent && uv run python devserve.py serve

# 重启。**只杀它自己起过的那个**（认 pid 文件），绝不碰"端口的占用者" ——
# 那可能是别的东西，只有你能判断（杀进程不可逆）。
restart:
	@cd python_agent && uv run python devserve.py restart

# 起前端（Vite dev server，端口 5173）。
#
# ⚑ 它和 `make serve` 是【两个终端里的两条命令】—— **故意不合成一条**：
#   两个前台服务的日志混在一个终端里，"出 500 时先看那个终端的日志"就用不了了。
#
#   ⚠️ 也**不要**改成"后台起一个"：`&` / `start` 那套写法在 cmd 和 sh 里不一样 ——
#      又是一个跨 shell 的坑，和上面 `PYTHONIOENCODING` 那个是同一类。
#
# 第一次要先 `cd frontend && npm install`。
web:
	@cd frontend && npm run dev
