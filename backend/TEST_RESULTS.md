# 后端验证记录 · v2

验证日期：2026-10-26。Python 3.12.14；依赖精确版本见 [requirements-lock.txt](requirements-lock.txt)。本文件记录本轮已运行的后端结果；全栈、浏览器和容器结果见 [统一验收记录](../docs/验收记录.md)。

## 实际命令与结果

从仓库根目录执行：

```bash
(cd backend && ../.venv/bin/python -m pytest -q)
(cd backend && ../.venv/bin/python evaluate.py)
```

- pytest：**82 passed in 9.42s**，包括原有 API 行为、v2 工具协议与业务生命周期回归。
- 固定合成场景：**12 / 12 passed**，`totalRefundCents = 0`，provider 为离线 `demo`。
- [逐场景报告](evidence/eval-demo.json)：schemaVersion 2，保留动作、引用、节点状态、工具调用、停止原因和运行指标；[输入集](evals/cases.json) 为 12 条中英文合成工单。

## 测试范围

| 测试文件 | 检查重点 |
|---|---|
| [test_api.py](tests/test_api.py) | 登录、会话、租户、运行与审批幂等、独立审批、金额/引用校验、并发订单/预算限制、历史只读与重启 |
| [test_agent_v2.py](tests/test_agent_v2.py) | 多轮模型工具协议、工具 allowlist、绑定订单范围、参数 schema、调用 ID、最终提交独占、轮次/工具预算、时点变化、HTTP 故障、响应体限制与 telemetry |
| [test_workflow_v2.py](tests/test_workflow_v2.py) | 工单版本冲突、补资料、结案/重开、待审批编辑阻断、规则版本发布与正文保护、分页检索、签收日期重验、旧库迁移及中断工具恢复 |

v2 新增的关键检查包括：

1. 模型先查询绑定订单、再细化检索，收到对应 `tool_call_id` 的结果，最后单独提交方案。
2. 伪造工具、重复 ID、同租户其他订单、非法参数、超次数和不完整响应都受到明确处理；供应商 HTTP 错误不重试、不切换 demo。
3. 运行中规则更新后，旧引用不能提交有效方案；重新检索使用当前版本，旧查询仍留在轨迹中。
4. 确定性 demo 的非退款答复读取当前发布的政策，不继续使用此前硬编码的物流时效。
5. 重开已退款工单不重置账本；旧表单不能覆盖新版工单；政策发布保留历史并阻断旧提案批准。
6. 签收天数随日期计算，批准时再次验证；旧库增量迁移保留数据并且可重复启动。
7. 进程中断后的运行、节点和工具转为失败，工单历史只追加一次中断事件。

所有测试使用临时 SQLite 数据库。真实模型协议由 MockTransport / 测试替身验证，未用真实供应商测量模型回答质量、token 成本或延迟分布；demo 的模型请求数为 0。12 条场景与 82 项 pytest 分开计数。
