# CaseDesk 后端

Python 3.12+，FastAPI、SQLite、LangGraph、rank-bm25。离线模式使用确定性规则生成建议，不代表真实模型效果。真实模型通过环境变量选择 OpenAI-compatible Chat Completions；未经配置时不会联网请求模型。退款只写入本地模拟账本。

```bash
cd backend
../.venv/bin/python -m pip install -r requirements-dev.txt
../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
../.venv/bin/python -m pytest -q
../.venv/bin/python evaluate.py --output evidence/eval-demo.json
```

仅运行一个 Uvicorn worker。SQLite WAL 支持本地演示的并发请求，启动会将前一进程中断的运行标记为失败；不支持多个应用进程同时启动。不是生产多实例任务系统。

## 演示账户

| 租户 | 客服 | 审批人 |
|---|---|---|
| 极光数码 | agent@aurora.demo | reviewer@aurora.demo |
| 海港生活 | agent@harbor.demo | reviewer@harbor.demo |

本地演示密码均为 `DemoPass!2026`。PBKDF2 哈希存储密码，随机会话 token 的 SHA-256 哈希存储于数据库，默认 12 小时过期。不要将这些默认账户直接用于公网。

## 配置

| 变量 | 默认值 / 含义 |
|---|---|
| `CASEDESK_DATABASE_PATH` | `backend/data/casedesk.sqlite3`，仅服务端环境可配置 |
| `CASEDESK_PROVIDER` | `demo` 或 `openai-compatible` |
| `CASEDESK_MODEL_BASE_URL` | `https://api.openai.com/v1`，程序追加 `/chat/completions` |
| `CASEDESK_MODEL_NAME` | 真实模型模式必填 |
| `CASEDESK_MODEL_API_KEY` | 真实模型凭据，仅服务端 |
| `CASEDESK_MODEL_TIMEOUT` | 默认 20 秒 HTTP 阶段超时；节点边界与响应流检查最多 45 秒的时间预算 |
| `CASEDESK_DEMO_SEED` | `true`，仅空数据库初始化合成数据 |

真实调用会向配置的模型供应商发送当前工单、同租户检索片段和订单摘要。接入真实客户数据前应确认该供应商的数据处理要求。支持 `response_format: {type: json_object}` 的端点；不会自动降级到没有结构校验的模型输出。

## 接口与状态

OpenAPI：`http://127.0.0.1:8000/docs`。除 health/login 外，接口需要 `Authorization: Bearer <token>`。字段统一 camelCase，错误统一 `{"error":{"code":"...","message":"..."}}`。

- `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`
- `GET /api/health`、`GET /api/stats`、`GET /api/orders`
- `GET/POST /api/tickets`、`GET /api/tickets/{id}`
- `POST /api/tickets/{id}/runs`、`GET /api/runs/{id}`
- `GET /api/approvals`、`POST /api/approvals/{id}/decision`
- `GET /api/knowledge`、`GET /api/audit`

执行路径：`intake → retrieve → order_lookup → draft → policy_guard`。使用真实 LangGraph `StateGraph` 编排，应用数据库持久化各节点的输入摘要、输出和时间，未使用 LangGraph checkpoint/interrupt。审批在独立 HTTP 路由中完成；读取历史 run 是只读回放，不重新执行工具。运行目前同步完成，步骤可以由其他请求读取，不提供 SSE 或后台队列。超时由 HTTP 阶段超时和节点/响应流中的预算检查共同控制，不是强制终止线程的硬实时上限；进行中的读取和数据库锁等待可能使实际总耗时超过预算。

工单 `open → awaiting_approval → resolved / rejected`。普通答复或拒答保持 `open`；已审批工单不可重新运行。被拒绝工单需新建工单后重新申请，当前没有编辑/重开/删除接口，以保持审核记录明确。

## 校验边界

检索使用中文双字切分与英文词的 BM25，加上显式业务意图路由；不是向量 RAG。引用绑定 document/version/chunk，审批时重验政策版本。默认知识库是只读合成资料，尚无版本管理编辑端点。

模型只能提出 `refund / reply / abstain` JSON 方案。退款金额为整数分，服务端检查订单资格、30 天窗口、订单剩余金额、50000 分单笔上限和 100000 分租户累计演示预算。审批必须由独立 reviewer 完成，并在 `BEGIN IMMEDIATE` 事务中重新校验订单和预算，同时写入退款账本、审批状态、工单状态、幂等响应和审计。相同 key/参数回放；同 key 不同参数返回 409。

注入关键词检测是辅助拒答机制，不是通用安全证明。真正权限边界由后端身份、租户范围、动作 allowlist、Pydantic schema、引用范围、金额策略和独立审批控制。真实模型回答的每个自然语言断言没有语义级真实性证明，仍需人工审核；系统不会因模型声称已批准而执行退款。

审计表在应用数据库中有禁止更新/删除的 trigger，但数据库管理员仍能绕过，不能宣称外部可信或加密防篡改。测试使用合成数据和 mock 模型端点，不是生产负载测试或真实模型评测。

## 固定场景评估

`evals/cases.json` 包含 12 条中英文合成场景：正常退款、缺少订单、超期、配送、质保、发票、未知问题和提示注入。`evaluate.py` 对动作、是否产生审批、引文范围、整数金额和零自动退款做检查，并保存 JSON 报告。脚本使用临时 SQLite 数据库，不修改正在演示的工单或数据；默认强制使用离线 demo，即使环境中配置了真实模型。

若要评估自己配置的真实模型，先设置上述模型环境变量，再显式执行：

```bash
../.venv/bin/python evaluate.py --provider configured --allow-model-network --output evidence/eval-model.json
```

该命令可能产生模型调用费用，只有显式传入网络授权开关才执行。现有 `evidence/eval-demo.json` 是实际离线运行输出，不可用其通过率宣称真实模型准确率。没有在此项目交付中发起真实模型评测。
