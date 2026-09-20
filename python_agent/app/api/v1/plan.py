"""`POST /v1/plan` —— 目标 → 任务图骨架（§3.4 的第一个内部接口）。

⚠️ 这一层**极薄**：收请求 → 调 `plan_goal()` → 按 §3.4 的形状返回。
   **不重新实现任何逻辑** —— CLI（`make plan`）调的是**同一个函数**。
   （§14.2 的镜像双实现最容易在这里长出来：路由和 CLI 各写一遍，然后漂移。）

⚠️ 一处**已知偏离**，记在这里免得它是静默的：

   §3.4 的请求体里有 `tools`（可用工具清单，**由 Java 传**）——
   而 `plan_goal()` 现在是**自己从 `shared/tools.json` 读**的。

   当前两者等价（读的就是同一份文件），但**契约上应该由请求传**：
   Host 才知道"这次有哪些工具可用"。
   → 等 A6 接上来时改：`plan_goal(tools=...)`。

   现在**不假装支持** `tools` 参数（收下却不用，比不收更糟 —— 那是"静默忽略"）。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.llm.client import PlanCallError
from app.llm.prompts import PromptNotWritten
from app.planner.outline import LevelSkipError
from app.workflows.plan import plan_goal

router = APIRouter(prefix="/v1", tags=["plan"])


class PlanRequest(BaseModel):
    goal: str = Field(min_length=1, description="用户的自然语言目标")
    max_depth: int = Field(default=3, ge=1, description="深度上限（W_DEPTH_EXCEEDED 用它判）")
    max_children: int = Field(default=9, ge=1, description="扇出上限（W_FANOUT_EXCEEDED 用它判）")


class PlanResponse(BaseModel):
    """§3.4 的响应形状 + `check_implemented`。

    ⚑ `check_implemented` 是**故意多带的一个字段**（§3.4 里没有）：
       `issues` 为空有两种可能 —— **查过了没问题** / **还没查**。
       不给这个标记的话，调用方会把后者读成前者（#13 的形状）。
    """

    goal: str
    nodes: list[dict]
    issues: list[dict]
    usage: dict
    check_implemented: bool


@router.post("/plan", response_model=PlanResponse)
def plan(req: PlanRequest) -> PlanResponse:
    try:
        result = plan_goal(
            req.goal, max_depth=req.max_depth, max_children=req.max_children
        )
    except PromptNotWritten as e:
        # Prompt 没写 → 这是【部署方】的问题，不是这次请求的问题
        raise HTTPException(status_code=500, detail=str(e)) from e
    except (PlanCallError, LevelSkipError, ValueError) as e:
        # 调模型失败 / 模型输出不合契约 → 上游（模型）的问题
        # 502 而不是 422：**这个请求本身是合法的**，是上游没能给出可用的结果
        raise HTTPException(status_code=502, detail=str(e)) from e

    return PlanResponse(
        goal=result.goal,
        nodes=result.nodes,
        issues=result.issues,
        usage=result.usage,
        check_implemented=result.check_implemented,
    )
