import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileCheck2,
  Inbox,
  Layers3,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  type Approval,
  type Audit,
  type Knowledge,
  type Order,
  type Stats,
  type Ticket,
} from "./api";
import type { Session, TicketDetailData } from "./types";
import { Login } from "./components/Login";
import { TicketDetail } from "./components/TicketDetail";
import { ApprovalCard } from "./components/ApprovalCard";
import { CreateTicket } from "./components/CreateTicket";
import { Badge, Empty, Json, Stat } from "./components/ui";
import { date, money } from "./lib/format";

type Page = "tickets" | "approvals" | "knowledge" | "audit";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState<Page>("tickets");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<{
    provider: string;
    demoMode: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetailData | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const detailSequence = useRef(0);
  const token = session?.token;
  async function refresh() {
    if (!token) return;
    const [ts, st, ap, kn, au] = await Promise.all([
      api<{ items: Ticket[] }>("/tickets", token),
      api<Stats>("/stats", token),
      api<{ items: Approval[] }>("/approvals", token),
      api<{ items: Knowledge[] }>("/knowledge", token),
      api<{ items: Audit[] }>("/audit", token),
    ]);
    setTickets(ts.items);
    setStats(st);
    setApprovals(ap.items);
    setKnowledge(kn.items);
    setAudit(au.items);
    if (!selected && ts.items.length) setSelected(ts.items[0].id);
  }
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api<typeof health>("/health")
      .then(setHealth)
      .catch(() => {});
    api<{ items: Order[] }>("/orders", token)
      .then((x) => setOrders(x.items))
      .catch(() => {});
  }, [token]);
  async function loadDetail(id: string) {
    const seq = ++detailSequence.current;
    setDetail(null);
    try {
      const data = await api<typeof detail>(
        `/tickets/${encodeURIComponent(id)}`,
        token,
      );
      if (seq === detailSequence.current) setDetail(data);
    } catch (e) {
      if (seq === detailSequence.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (selected && token) void loadDetail(selected);
  }, [selected, token]);
  function logout() {
    if (token) void api("/auth/logout", token, {}).catch(() => {});
    detailSequence.current++;
    setSession(null);
    setSelected(null);
    setDetail(null);
    setTickets([]);
    setStats(null);
    setApprovals([]);
    setKnowledge([]);
    setAudit([]);
    setOrders([]);
    setHealth(null);
    setError("");
    setNotice("");
  }
  async function runAgent() {
    if (!selected || running) return;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      await api(`/tickets/${selected}/runs`, token, {
        idempotencyKey: crypto.randomUUID(),
      });
      await Promise.all([refresh(), loadDetail(selected)]);
      setNotice("运行结果已保存，请查看处理方案和执行轨迹。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  async function decide(
    id: string,
    decision: "approve" | "reject",
    reason: string,
    key: string,
  ) {
    setError("");
    setNotice("");
    await api(`/approvals/${id}/decision`, token, {
      decision,
      reason,
      idempotencyKey: key,
    });
    await refresh();
    if (selected) await loadDetail(selected);
    setNotice(
      decision === "approve"
        ? "审批通过，模拟退款已写入账本。"
        : "方案已拒绝，审批意见已留档。",
    );
  }
  if (!session)
    return (
      <Login
        onLogin={(s) => {
          setSession(s);
          setPage("tickets");
        }}
      />
    );
  const filtered = tickets.filter(
    (t) =>
      (filter === "all" || t.status === filter) &&
      `${t.subject} ${t.customerName} ${t.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const nav = [
    { key: "tickets" as Page, label: "工单工作台", icon: Inbox },
    { key: "approvals" as Page, label: "审批中心", icon: FileCheck2 },
    { key: "knowledge" as Page, label: "规则知识库", icon: BookOpen },
    { key: "audit" as Page, label: "审计日志", icon: Activity },
  ];
  const pageMeta = {
    tickets: [
      "CASE OPERATIONS",
      "工单工作台",
      "以证据驱动每一步处理，让服务清晰而可靠。",
    ],
    approvals: [
      "HUMAN IN THE LOOP",
      "审批中心",
      "复核处理依据，确认每一笔模拟退款。",
    ],
    knowledge: [
      "VERSIONED KNOWLEDGE",
      "规则知识库",
      "每个回答都能回到具体规则与版本。",
    ],
    audit: [
      "TRACEABLE BY DESIGN",
      "审计日志",
      "从工单创建到审批执行，保留每一步记录。",
    ],
  }[page];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          CaseDesk
        </div>
        <div className="workspace-tag">
          <div className="workspace-avatar">
            {session.user.tenantName.slice(0, 1)}
          </div>
          <div>
            <strong>{session.user.tenantName}</strong>
            <span>售后服务工作空间</span>
          </div>
          <ChevronRight size={16} />
        </div>
        <span className="nav-caption">工作空间</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.key}
              aria-label={n.label}
              title={n.label}
              className={page === n.key ? "active" : ""}
              onClick={() => {
                setPage(n.key);
                setError("");
                setNotice("");
              }}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.key === "approvals" && !!stats?.awaitingApproval && (
                <b className="nav-count">{stats.awaitingApproval}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>人掌握最终决定</strong>
          <p>
            Agent 提出建议。
            <br />
            资金操作始终需要人工审批。
          </p>
          <span>可追溯 · 可复核 · 可回放</span>
        </div>
        <div className="sidebar-bottom">
          <div className="user-avatar">
            {session.user.role === "reviewer" ? "审" : "客"}
          </div>
          <div>
            <strong>{session.user.name}</strong>
            <small>
              {session.user.role === "reviewer" ? "审批主管" : "客服专员"}
            </small>
          </div>
          <button
            className="icon-button"
            aria-label="退出登录"
            title="退出并切换身份"
            onClick={logout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{pageMeta[1]}</strong>
          </div>
          <div className="environment">
            <i />
            {health?.demoMode === false ? "已连接模型" : "演示模式"}
            <span>合成数据 · 模拟退款</span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{pageMeta[0]}</span>
              <h1>{pageMeta[1]}</h1>
              <p>{pageMeta[2]}</p>
            </div>
            {page === "tickets" && (
              <button className="primary" onClick={() => setShowCreate(true)}>
                <Plus size={17} />
                新建工单
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              <XCircle size={18} />
              {error}
              <button onClick={() => setError("")} aria-label="关闭错误">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button onClick={() => setNotice("")} aria-label="关闭提示">
                <X size={16} />
              </button>
            </div>
          )}
          {page === "tickets" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="工单总数"
                  value={String(stats?.tickets ?? "—")}
                  note="当前工作空间"
                  icon={<Inbox size={20} />}
                />
                <Stat
                  label="等待人工审批"
                  value={String(stats?.awaitingApproval ?? "—")}
                  note="待主管复核"
                  icon={<Clock3 size={20} />}
                  amber
                />
                <Stat
                  label="已完成处理"
                  value={String(stats?.resolved ?? "—")}
                  note="方案已落地"
                  icon={<CheckCircle2 size={20} />}
                />
                <Stat
                  label="模拟退款总额"
                  value={stats ? money(stats.totalRefundCents) : "—"}
                  note="仅本地演示账本"
                  icon={<ArrowDownLeft size={20} />}
                />
              </div>
              <section className="workspace-grid">
                <div className="ticket-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        待办队列 <span>{tickets.length}</span>
                      </h2>
                      <p>选择工单，查看处理方案</p>
                    </div>
                    <ClipboardList size={20} />
                  </div>
                  <div className="queue-tools">
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        aria-label="搜索工单"
                        placeholder="搜索工单或客户…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="filter-tabs">
                      {[
                        ["all", "全部"],
                        ["open", "待处理"],
                        ["awaiting_approval", "待审批"],
                        ["resolved", "已完成"],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          className={filter === v ? "active" : ""}
                          onClick={() => setFilter(v)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ticket-list">
                    {loading ? (
                      <Empty
                        text="正在载入工单…"
                        icon={<LoaderCircle className="spin" />}
                      />
                    ) : filtered.length ? (
                      filtered.map((t) => (
                        <button
                          key={t.id}
                          className={`ticket-card ${selected === t.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelected(t.id);
                            setNotice("");
                            setError("");
                          }}
                        >
                          <div className="ticket-meta">
                            <span>#{t.id.slice(-10)}</span>
                            <Badge status={t.status} />
                          </div>
                          <h3>{t.subject}</h3>
                          <p>{t.description}</p>
                          <div className="ticket-footer">
                            <span className="customer">
                              <i>{t.customerName.slice(0, 1)}</i>
                              {t.customerName}
                            </span>
                            <time>{date(t.createdAt)}</time>
                          </div>
                        </button>
                      ))
                    ) : (
                      <Empty text="没有符合条件的工单" />
                    )}
                  </div>
                  <div className="queue-footer">
                    <i />
                    全部数据按工作空间隔离
                  </div>
                </div>
                <div className="detail-panel">
                  {detail ? (
                    <TicketDetail
                      detail={detail}
                      running={running}
                      onRun={runAgent}
                      isReviewer={session.user.role === "reviewer"}
                      onApproval={() => setPage("approvals")}
                    />
                  ) : (
                    <Empty
                      text={
                        selected ? "正在读取工单…" : "创建第一张工单，开始处理"
                      }
                    />
                  )}
                </div>
              </section>
            </>
          )}
          {page === "approvals" && (
            <div className="approvals-grid">
              {approvals.length ? (
                approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    ticket={tickets.find((t) => t.id === a.ticketId)}
                    run={detail?.runs.find((r) => r.id === a.runId)}
                    user={session.user}
                    token={session.token}
                    decide={decide}
                  />
                ))
              ) : (
                <div className="panel">
                  <Empty
                    text="暂无审批。先在工单工作台运行 Agent。"
                    icon={<FileCheck2 size={32} />}
                  />
                </div>
              )}
            </div>
          )}
          {page === "knowledge" && (
            <>
              <div className="info-strip">
                <BookOpen size={20} />
                <div>
                  <strong>当前检索范围：{knowledge.length} 份规则文档</strong>
                  <p>
                    工单检索按租户过滤，并保留命中片段的版本快照。这里只展示已发布的演示规则。
                  </p>
                </div>
              </div>
              <div className="knowledge-grid">
                {knowledge.map((k) => (
                  <article className="knowledge-card" key={k.id}>
                    <div className="knowledge-icon">
                      <BookOpen size={22} />
                    </div>
                    <div className="knowledge-header">
                      <h2>{k.title}</h2>
                      <span className="version">{k.version}</span>
                    </div>
                    <p className="knowledge-body">{k.body}</p>
                    <footer>
                      <span>规则 ID · {k.id}</span>
                      <span>{date(k.updatedAt)}</span>
                    </footer>
                  </article>
                ))}
              </div>
            </>
          )}
          {page === "audit" && (
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    操作记录 <span>{audit.length}</span>
                  </h2>
                  <p>记录来自后端持久化审计表；不触发任何业务重放。</p>
                </div>
                <Terminal size={21} />
              </div>
              <div className="audit-table">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作</th>
                      <th>操作人</th>
                      <th>关联对象</th>
                      <th>详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td>{date(a.createdAt)}</td>
                        <td>
                          <code>{a.action}</code>
                        </td>
                        <td>{a.actorName || a.actorId}</td>
                        <td>
                          <span>{a.entityType}</span>
                          <small>{a.entityId}</small>
                        </td>
                        <td>
                          <details>
                            <summary>查看记录</summary>
                            <Json value={a.detail} />
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!audit.length && <Empty text="暂无审计记录" />}
              </div>
            </div>
          )}
          <footer className="page-footer">
            <span>CaseDesk · Evidence before action.</span>
            <span>LangGraph 工作流 / 人工审批 / 事务幂等</span>
          </footer>
        </div>
      </main>
      {showCreate && (
        <CreateTicket
          orders={orders}
          token={session.token}
          onClose={() => setShowCreate(false)}
          onCreated={async (t) => {
            setShowCreate(false);
            await refresh();
            setSelected(t.id);
            setNotice("工单已创建，可以运行 Agent 生成处理方案。");
          }}
        />
      )}
    </div>
  );
}
