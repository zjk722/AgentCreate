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

.PHONY: help plan prompt test

help:
	@echo 'make plan GOAL="..."   目标 → 任务图骨架（调真模型；Prompt 没写会明确报错）'
	@echo 'make prompt GOAL="..." 只打印【将要发出去】的内容，不调模型（零成本）'
	@echo 'make test               Python 侧的测试'

# ⚑ PYTHONIOENCODING=utf-8 不是装饰：Windows 控制台的默认代码页不是 UTF-8，
#   不设它的话 pytest 报告里的中文会变成乱码 —— 而**失败时最需要读的正是那几行**。
#   （cli.py 里也单独 reconfigure 过一次 stdout，两者是不同层面的保险。）

plan:
	@cd python_agent && PYTHONIOENCODING=utf-8 uv run python -m app.cli --goal "$(GOAL)"

# 改 Prompt 时的回路：不用 key、不花钱，先把要发出去的东西看一遍。
prompt:
	@cd python_agent && PYTHONIOENCODING=utf-8 uv run python -m app.cli --goal "$(GOAL)" --dry-run

test:
	@cd python_agent && PYTHONIOENCODING=utf-8 uv run pytest -q
