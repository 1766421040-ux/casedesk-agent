# 开源来源与贡献边界

CaseDesk 是独立编写的领域应用，使用开源运行库并借鉴公开工程机制。不是将某个上游产品改名，也未合并 Dify / Open WebUI 的源代码。当前业务代码、数据库模型、审计和审批逻辑、前端界面、合成数据与验收用例均在本仓库中实现；开发过程中使用了 AI 编程辅助。

| 上游 | 用途 | 许可 | 本仓库关系 |
|---|---|---|---|
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | 五个外层阶段的 StateGraph 编排、类型化状态 | MIT | 真实运行依赖；未使用 checkpoint 或 interrupt |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | API、依赖注入、OpenAPI | MIT | 真实运行依赖 |
| [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | API/前端分层、身份约束和测试组织 | MIT | 设计参考；未复制模板源码，不继承其 JWT/SQLModel/Postgres 功能 |
| [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25) | BM25 文本检索 | Apache-2.0 | 真实运行依赖；中文双字切分与业务路由由本项目实现 |
| [facebook/react](https://github.com/facebook/react) | 前端组件与状态 | MIT | 真实运行依赖；工作台自行编写 |
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | UI 图标 | ISC | 通过 lucide-react 导入图标 |
| [vitejs/vite](https://github.com/vitejs/vite) | 开发代理与打包 | MIT | 开发依赖 |
| [microsoft/playwright](https://github.com/microsoft/playwright) | 浏览器回归测试 | Apache-2.0 | 测试依赖 |

其他依赖许可证保留在各发行包中；本仓库 MIT 许可仅覆盖本仓库原创内容，不替代依赖许可。锁文件固定实际使用的版本。

## 研究后没有引入的系统

- [Dify](https://github.com/langgenius/dify)：通用应用平台、依赖面较大；未作为改名或直接复制的基础。
- [Open WebUI](https://github.com/open-webui/open-webui)：通用聊天 UI；未复制其源码或继承其功能。
- [RAGFlow](https://github.com/infiniflow/ragflow)：文档解析和检索能力强，首版规则库无需引入整个解析/索引集群。
- [Haystack](https://github.com/deepset-ai/haystack)、[Qdrant](https://github.com/qdrant/qdrant)：可作为检索扩展候选；当前未集成，也不声称有向量检索或混合检索。
- [assistant-ui](https://github.com/assistant-ui/assistant-ui)：工具状态展示是设计参考，当前 UI 是工单/审批工作台，没有引入聊天组件库。

## 本项目实现的组合机制

1. LangGraph 组织五个业务阶段，模型在 draft 阶段使用受控工具循环；工具 schema、调用 ID、预算与轨迹在本仓库实现。模型只提交方案，身份与审批权限由业务层控制。
2. BM25 提供当前版本的规则片段；本仓库负责规则发布、历史保留、引用校验，以及初始检索与模型补查之间的证据管理。
3. FastAPI 将提案生成、人工决策和只读回放分离；SQLite 将审批、退款账本、幂等响应与审计写入同一事务。
4. React 呈现工单编辑、结案、重开、证据对照、工具轨迹、政策历史与审批；前端操作对应受版本和权限校验的 API。

这是一项可运行的工程融合，不是新的 Agent 算法或原创框架。没有使用上游项目的用户数据、模型权重、商业品牌或私有代码。
