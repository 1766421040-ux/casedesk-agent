# CaseDesk 后端：运行、API 与模型协议

FastAPI 提供业务 API；LangGraph 编排工单处理；SQLite 保存版本、运行和审批。默认 `demo` 不联网，真实模型通过服务端配置启用。完整安装入口见 [根 README](../README.md)。

## 独立启动与配置

完成根目录依赖安装后，从仓库根目录启动后端：

```bash
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

**只使用一个 Uvicorn worker。** 启动时会将此前遗留的 `running` 标为失败；多个应用进程会误判彼此的运行。开发服务器保持同步执行，不含后台队列或 SSE。

Windows PowerShell 可在仓库根目录完成安装：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-lock.txt
npm --prefix frontend ci
$env:CASEDESK_PROVIDER = "demo"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

保持该终端运行，在另一个 PowerShell 终端进入仓库根目录执行 `npm --prefix frontend run dev -- --port 5173 --strictPort`，访问 `http://127.0.0.1:5173`。Windows 原生路径为运行说明；本轮实际验证的平台以 [验收记录](../docs/验收记录.md) 为准。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `CASEDESK_DATABASE_PATH` | `backend/data/casedesk.sqlite3` 的绝对路径 | 建议覆盖时也使用绝对路径；父目录自动创建 |
| `CASEDESK_PROVIDER` | `demo` | `demo` 或 `openai-compatible` |
| `CASEDESK_MODEL_BASE_URL` | `https://api.openai.com/v1` | 程序追加 `/chat/completions`；只由服务端配置 |
| `CASEDESK_MODEL_NAME` | 空 | 真实模型模式必须指定 |
| `CASEDESK_MODEL_API_KEY` | 空 | 供应商凭据；本地无鉴权兼容端点可保持空值 |
| `CASEDESK_MODEL_TIMEOUT` | `20` | HTTP 阶段超时秒数；同时参与运行时间预算计算 |
| `CASEDESK_DEMO_SEED` | `true` | 空租户库初始化合成账户、政策、订单和工单；已有数据不覆盖 |

shell 用 `export`（PowerShell 用 `$env:`）设置环境变量。`scripts/dev.sh` 不自动加载 `.env`；Compose 使用根目录 `.env`。`CASEDESK_DEMO_SEED=false` 也不会删除已有数据；全新空库此时没有可登录账号，当前没有用户创建 API。

数据库使用 WAL、外键、写事务与增量 schema 迁移。v2 为旧库增加工单版本、工单事件、政策历史和签收时间；迁移保留既有业务数据。旧订单按迁移当时的 `delivery_days` 一次性推导 `delivered_at`；之后随日期计算窗口，不在每次重启时重置。政策迁移保留的是升级时可见的版本，不能重建此前未保存的历史。升级前可在服务停止后复制数据库及相关 WAL/SHM 文件作本地备份。

## 身份与通用约定

[OpenAPI](http://127.0.0.1:8000/docs) 展示完整字段 schema。除 `/api/health` 和 `/api/auth/login` 外，接口要求：

```http
Authorization: Bearer <login 返回的 token>
```

- 账号见根 README；密码经 PBKDF2 存储，会话随机 token 只保存 SHA-256 哈希，默认 12 小时过期。
- 租户来自当前用户记录，不接受请求或工具参数覆盖。跨租户资源返回 404。
- JSON 字段采用 camelCase，金额单位为整数分；未知字段被拒绝，写请求体上限为 32 KiB。
- 失败格式为 `{"error":{"code":"VERSION_CONFLICT","message":"工单已被更新，请刷新后重试"}}`；字段校验错误可带 `details`。

## API 导航

| 方法与路径 | 作用 | 条件 |
|---|---|---|
| `POST /api/auth/login` / `POST /api/auth/logout` | 创建 / 注销会话 | 登录失败有进程内节流 |
| `GET /api/me` | 当前身份 | 已登录 |
| `GET /api/health` / `/api/stats` / `/api/orders` | 健康状态 / 租户统计 / 租户订单 | health 公开，其余需会话 |
| `GET /api/tickets` | 工单检索、状态筛选、分页 | 当前租户 |
| `POST /api/tickets` | 新建工单 | 关联订单必须属于当前租户 |
| `GET /api/tickets/{id}` | 工单、历史 run、审批与事件 | 当前租户 |
| `PATCH /api/tickets/{id}` | 编辑或补充资料 | 版本匹配、`open`、无运行和待审批 |
| `POST /api/tickets/{id}/transition` | 结案 / 重开 | 版本匹配、合法状态、无运行和待审批 |
| `POST /api/tickets/{id}/runs` | 生成处理方案 | `open`、无另一运行；支持幂等键 |
| `GET /api/runs/{id}` | 读取轨迹与结果 | 不重放工具或业务动作 |
| `GET /api/approvals` | 审批列表 | 当前租户，当前保留最多 500 条 |
| `POST /api/approvals/{id}/decision` | 批准 / 拒绝 | 独立 reviewer；事务中重新校验 |
| `GET /api/knowledge` | 当前政策与片段 | 当前租户 |
| `GET /api/knowledge/{id}/history` | 政策历史版本 | 当前租户 |
| `POST /api/knowledge/{id}/publish` | 发布新版本 | reviewer、版本匹配、内容确有变化 |
| `GET /api/audit` | 审计检索、动作筛选、分页 | 当前租户 |

客服与 reviewer 都可以创建、编辑和变更工单。角色限制重点在审批和政策发布：客服不能批准退款，reviewer 不能批准自己生成的提案。前端按角色组织常用入口，权限最终由 API 校验。

### 列表分页

```http
GET /api/tickets?q=耳机&status=open&limit=20&offset=0
GET /api/audit?q=退款&status=approved&limit=20&offset=0
```

两者返回 `{items,total,limit,offset}`；默认 `limit=50`，范围 1–100，`offset` 范围 0–100000。工单状态为 `open / awaiting_approval / resolved / rejected`。审计的 `status` 匹配动作后缀，例如 `approved` 对应 `approval.approved`。搜索将 `%` 和 `_` 作为普通字符处理。

### 编辑与状态变更

每次先读取详情，取最新 `ticket.version`。编辑只提交需要改变的字段：

```json
{
  "expectedVersion": 1,
  "note": "客户补充：包装完好，商品未使用。"
}
```

`subject`、`description` 和 `orderId` 也可修改；`orderId: null` 解除关联。`note` 附加到描述，并记录前后变更，合并后描述不能超过 8000 字符。没有实际变化返回 `422 NO_CHANGES`。旧版本返回 `409 VERSION_CONFLICT`，客户端应刷新并重新核对后提交。

结案 / 重开请求：

```json
{
  "expectedVersion": 2,
  "action": "reopen",
  "reason": "客户已补充订单信息，需要重新处理。"
}
```

`open → resolved` 使用 `resolve`；`resolved/rejected → open` 使用 `reopen`。有待审批时需先由独立 reviewer 决策，不能通过编辑、结案或重开跳过。重开不撤销已执行的模拟退款，也不删除历史审批。

### 规则版本发布

```json
{
  "expectedVersion": 1,
  "title": "物流与配送说明",
  "body": "物流 shipping 配送 delivery：正常配送时效为 4–6 个工作日。具体送达日期由客服人工核实。",
  "reason": "演示物流政策更新，将正常时效调整为 4–6 个工作日。"
}
```

用于 `POST /api/knowledge/aurora-shipping/publish`。服务端按空行和每段最多 600 字符分片，最多 32 片；版本、片段与审计原子写入。新版本立即成为当前检索版本；旧片段与历史 run 保留。并发发布旧 `expectedVersion` 返回 409。

退款文档返回 `bodyEditable: false`：正文受服务端金额、资格和审批策略保护，只允许改标题发布新版本。尝试修改正文返回 `422 REFUND_POLICY_SERVER_CONTROLLED`。策略本身需要代码、测试和文档一起修改，避免正文与执行规则分离。

## 模型工具协议

真实模式使用 [provider.py](app/provider.py) 发起 Chat Completions 请求，带 `tools`、`tool_choice: auto`、`temperature: 0`、`max_tokens: 1800`。不依赖 `response_format`。模型可以返回函数调用；工具输出以 `role: tool` 与对应 `tool_call_id` 回传。最终需单独调用 `submit_proposal`，也兼容返回相同 schema 的 JSON 文本，仍通过同一校验边界。

| 工具 | 参数 | 服务端限制 |
|---|---|---|
| `search_policies` | `query`；可选 `category`、`limit` | 当前租户和当前文档版本；`limit` 为 1–4；查询最长 1000 字符 |
| `lookup_order` | `orderId` | 仅当前工单绑定订单；同租户其他订单也拒绝 |
| `submit_proposal` | `answer` + `proposal` | 单独调用；校验 schema、引用、动作、金额、政策版本；只产生建议 |

最终 schema：

```json
{
  "answer": "符合当前退款条件，可提交人工审批。[aurora-refund:v1:1]",
  "proposal": {
    "action": "refund",
    "amountCents": 29900,
    "reason": "订单符合退货条件，待独立审批人复核。",
    "citations": ["aurora-refund:v1:1"]
  }
}
```

此例必须与实际 run 的证据、订单和余额一致才可能通过。动作只有 `refund / reply / abstain`；金额严格为整数，不能用浮点数、字符串或布尔值。`reply/abstain` 的金额必须为 0。回答中的引用 ID 与 `proposal.citations` 一致，均来自此次证据；退款至少引用退款类别证据。

外层 `retrieve` 与 `order_lookup` 经同一个工具执行边界获取初始上下文；模型可以补充调用。当前限制为最多 **6 次模型请求、10 次工具执行（含初始调用与最终提交）**，上下文证据最多 8 片。预算不是环境变量；修改常量需同步测试。

非法工具、重复调用 ID、额外参数、重复 JSON 键、非有限数值、越界订单和非法提案会停止自动建议，留下拒绝原因并转人工。最终提交不能与其他工具在同一批调用；每批工具的协议结构先校验后执行。HTTP 错误或超时保存为失败 run，不自动重试。

### 运行指标与时间预算

`GET /api/runs/{id}` 返回：

- `steps`：五个外层节点的输入摘要、输出、状态及时间。
- `toolCalls`：`id/name/source/round/status/startedAt/completedAt/arguments/output`；`source` 区分 `bootstrap`、`demo`、`model`。
- `metrics`：`providerCalls/toolCalls/durationMs/tokenUsage/usageReportedCalls/maxRounds/maxToolCalls`。
- `terminationReason`：如 `proposal_submitted`、`final_response`、`insufficient_evidence` 或具体拒绝原因。

`tokenUsage` 只汇总供应商实际提供的 `prompt_tokens/completion_tokens/total_tokens`；未报告时为 `null`，若仅部分请求有 usage，则结合 `usageReportedCalls` 解读。不估算费用。demo 的模型调用数为 0，但会记录初始读工具和确定性提案提交。

运行预算为 `min(45, max(5, model_timeout + 5))` 秒；默认超时 20 秒时预算为 25 秒。在节点、工具、模型循环边界及响应读取时检查；响应体限制 128000 字节。HTTP 的读等待、数据库锁等待仍可能增加实际墙钟耗时，因此不是硬实时终止。模型请求不跟随重定向、不自动读取系统代理设置，也不重试失败响应。

## 审批与数据一致性

批准在 `BEGIN IMMEDIATE` 内完成：读取当前订单签收时间与资格，检查订单剩余金额、单笔 50000 分上限、租户累计 100000 分预算和方案中的政策版本；之后共同写入订单、模拟退款记录、审批、工单状态、幂等响应及审计。任一步失败会回滚。

运行幂等键绑定租户、工单与申请人；审批幂等键绑定审批对象、决定、理由与执行人。同 key 同请求回放已保存结果，不同请求复用 key 返回 409。同运行 key 在工单修改后仍返回原 run，重新生成需使用新 key。已决定的审批不再修改；需要补充信息时重开工单、生成新的 run 与审批。模型不会拥有审批工具或真实支付能力。

工单状态、run 状态与审批状态各自独立。例如 `run.status=completed` 与 `ticket.status=awaiting_approval` 是正常组合。更多时序和限制见 [架构文档](../docs/架构与验收.md)。

## 开发验证与排错

从仓库根目录执行：

```bash
(cd backend && ../.venv/bin/python -m pytest -q)
(cd backend && ../.venv/bin/python evaluate.py)
```

测试和评估使用临时数据库。`evaluate.py` 默认强制 demo；真实模型需显式 `--provider configured --allow-model-network`，见 [评测清单](../docs/真实模型评测清单.md)。

| 现象 | 优先检查 |
|---|---|
| 登录失败 | 是否启用了种子数据、使用了正确数据库；账号邮件域名为 `.demo` |
| 订单以前能退、现在不能退 | 是否已累计退款、预算已占用，或签收时间随日期超过 30 天 |
| 工单编辑返回 409 | 刷新最新版本；检查是否正在运行或仍有待审批方案 |
| 政策变更后批准失败 | 拒绝旧方案，重开工单，再按当前政策生成新方案 |
| 真实模型运行失败 | 模型名、端点、Key、工具协议支持和服务端网络；查看脱敏错误与工具轨迹 |
| 代理环境可访问供应商，服务却失败 | HTTP client 不读取系统代理；使用后端可直接访问的配置端点 |
| 测试端口占用 | E2E 独占 8001 / 5174，不会复用已运行测试服务 |

真实模型失败内容不直接回显供应商响应正文，但工单和合法工具参数会进入本地历史记录；数据保留与生产脱敏策略尚需另行设计。
