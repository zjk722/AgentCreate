# 唯一入口 —— §11 把 Makefile 定成唯一入口（附录 A 的 F1 模式）。
#
# ⚠️ 这里只放【已经能用】的目标。
#    空的目标比没有目标更糟：它会让人以为那件事已经做过了 ——
#    这正是 #13（静默失败）在工具链上的形态。
#    所以 migrate / gen-api / test / eval 现在【故意不在】这里：它们还没东西可指。
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

.PHONY: help plan prompt test eval

help:
	@echo 'make plan GOAL="..."   目标 → 任务图骨架（调真模型；Prompt 没写会明确报错）'
	@echo 'make prompt GOAL="..." 只打印【将要发出去】的内容，不调模型（零成本）'
	@echo 'make test               Python 侧的测试'
	@echo 'make eval               A1 评测跑批（会花钱调模型；退化时非零退出码）'
	@echo 'make eval ARGS="--only seed-03"   只跑一条种子（省 2/3 的调用）'

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
