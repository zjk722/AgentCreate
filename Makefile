# 唯一入口 —— §11 把 Makefile 定成唯一入口（附录 A 的 F1 模式）。
#
# ⚠️ 这里只放【已经能用】的目标。
#    空的目标比没有目标更糟：它会让人以为那件事已经做过了 ——
#    这正是 #13（静默失败）在工具链上的形态。
#    所以 migrate / gen-api / test / eval 现在【故意不在】这里：它们还没东西可指。
#
# 用法：
#     make plan GOAL="准备一次日本关西七日游"

GOAL ?= 准备一次日本关西七日游

.PHONY: help plan

help:
	@echo 'make plan GOAL="..."   目标 → 任务图骨架（当前是占位数据，会自报家门）'

plan:
	@cd python_agent && uv run python -m app.cli --goal "$(GOAL)"
