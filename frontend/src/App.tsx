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
  RefreshCw,
} from "lucide-react";
import {
  api,
  type Approval,
  type Audit,
  type Knowledge,
  type Order,
  type Stats,
  type Ticket,
  type PageResult,
  type Run,
} from "./api";
import type { Session, TicketDetailData } from "./types";
import { Login } from "./components/Login";
import { TicketDetail } from "./components/TicketDetail";
import { ApprovalCard } from "./components/ApprovalCard";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { Pagination } from "./components/Pagination";
import { CreateTicket } from "./components/CreateTicket";
import { Badge, Empty, Json, Stat } from "./components/ui";
import { date, money } from "./lib/format";

type Page = "tickets" | "approvals" | "knowledge" | "audit";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    function onExpired(event: Event) {
      if ((event as CustomEvent).detail === session?.token) {
        setSession(null);
        setExpired(true);
      }
    }
    window.addEventListener("casedesk:session-expired", onExpired);
    return () =>
      window.removeEventListener("casedesk:session-expired", onExpired);
  }, [session]);
  if (!session)
    return (
      <>
        {expired && (
          <div className="session-notice" role="status">
            登录已失效，请重新登录。已保存的工单不受影响。
          </div>
        )}
        <Login
          onLogin={(s) => {
            setExpired(false);
            setSession(s);
          }}
        />
      </>
    );
  return (
    <Workspace
      key={session.token}
      session={session}
      onLogout={() => {
        void api("/auth/logout", session.token, {}).catch(() => {});
        setSession(null);
      }}
    />
  );
}

function Workspace({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
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
  const [runningTicket, setRunningTicket] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditQuery, setAuditQuery] = useState("");
  const [search, setSearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const listSequence = useRef(0);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const runKeys = useRef<Record<string, string>>({});
  const knownRuns = useRef<Record<string, string>>({});
  const PAGE_SIZE = 20;
  const [showCreate, setShowCreate] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const detailSequence = useRef(0);
  const filtersRef = useRef({
    search,
    filter,
    offset,
    auditSearch,
    auditOffset,
  });
  filtersRef.current = { search, filter, offset, auditSearch, auditOffset };
  const token = session.token;
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAuditSearch(auditQuery.trim());
      setAuditOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [auditQuery]);
  async function refresh() {
    const { search, filter, offset, auditSearch, auditOffset } =
      filtersRef.current;
    const seq = ++listSequence.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: search,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filter !== "all") params.set("status", filter);
      const [ts, st, ap, kn, au] = await Promise.all([
        api<PageResult<Ticket>>(`/tickets?${params}`, token),
        api<Stats>("/stats", token),
        api<{ items: Approval[] }>("/approvals", token),
        api<{ items: Knowledge[] }>("/knowledge", token),
        api<PageResult<Audit>>(
          `/audit?${new URLSearchParams({ q: auditSearch, limit: String(PAGE_SIZE), offset: String(auditOffset) })}`,
          token,
        ),
      ]);
      if (seq !== listSequence.current) return;
      setTickets(ts.items);
      setTotal(ts.total);
      setStats(st);
      setApprovals(ap.items);
      setKnowledge(kn.items);
      setAudit(au.items);
      setAuditTotal(au.total);
      setSelected((current) => current ?? ts.items[0]?.id ?? null);
      if (offset > 0 && !ts.items.length)
        setOffset(Math.max(0, offset - PAGE_SIZE));
      if (auditOffset > 0 && !au.items.length)
        setAuditOffset(Math.max(0, auditOffset - PAGE_SIZE));
    } catch (e) {
      if (seq === listSequence.current) setError((e as Error).message);
    } finally {
      if (seq === listSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      listSequence.current++;
    };
  }, [search, filter, offset, auditSearch, auditOffset, revision]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<NonNullable<typeof health>>("/health", undefined, undefined, {
        signal: controller.signal,
      }),
      api<{ items: Order[] }>("/orders", token, undefined, {
        signal: controller.signal,
      }),
    ])
      .then(([h, o]) => {
        setHealth(h);
        setOrders(o.items);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [token, revision]);
  async function loadDetail(id: string, clear = true) {
    const seq = ++detailSequence.current;
    if (clear) setDetail(null);
    setDetailLoading(true);
    try {
      const data = await api<TicketDetailData>(
        `/tickets/${encodeURIComponent(id)}`,
        token,
      );
      if (seq === detailSequence.current && selectedRef.current === id) {
        setDetail(data);
        if (
          knownRuns.current[id] &&
          data.runs.some(
            (r) => r.id === knownRuns.current[id] && r.status !== "running",
          )
        ) {
          delete runKeys.current[id];
          delete knownRuns.current[id];
        }
      }
    } catch (e) {
      if (seq === detailSequence.current) setError((e as Error).message);
    } finally {
      if (seq === detailSequence.current) setDetailLoading(false);
    }
  }
  useEffect(() => {
    if (selected) void loadDetail(selected);
    return () => {
      detailSequence.current++;
    };
  }, [selected]);
  const observedRunning =
    detail?.runs.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!selected || !observedRunning) return;
    const timer = setInterval(() => {
      void loadDetail(selected, false);
    }, 2000);
    return () => clearInterval(timer);
  }, [selected, observedRunning]);
  async function afterMutation(id?: string) {
    await refresh();
    if (id && selectedRef.current === id) await loadDetail(id, false);
  }
  async function runAgent() {
    if (!selected || runningTicket) return;
    const id = selected;
    setRunningTicket(id);
    setError("");
    setNotice("");
    runKeys.current[id] ??= crypto.randomUUID();
    try {
      const result = await api<{ run: Run }>(`/tickets/${id}/runs`, token, {
        idempotencyKey: runKeys.current[id],
      });
      if (result.run.status !== "running") delete runKeys.current[id];
      else knownRuns.current[id] = result.run.id;
      await afterMutation(id);
      setNotice(
        result.run.status === "running"
          ? "此运行仍在进行，正在同步已保存的步骤。"
          : "运行结果已保存，请查看处理方案和执行轨迹。",
      );
    } catch (e) {
      setError((e as Error).message);
      await afterMutation(id);
    } finally {
      setRunningTicket(null);
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
    await afterMutation(selectedRef.current ?? undefined);
    setNotice(
      decision === "approve"
        ? "审批通过，模拟退款已写入账本。"
        : "方案已拒绝，审批意见已留档。",
    );
  }
  const filtered = tickets;
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
            onClick={onLogout}
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
            {health ? (health.demoMode ? "演示模式" : "模型模式") : "连接中"}
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
          <div className="workspace-toolbar">
            <span>
              {session.user.role === "reviewer"
                ? "审批主管 · 可复核方案与发布规则"
                : "客服专员 · 可创建、补充与处理工单"}
            </span>
            <button
              className="text-button"
              onClick={() => {
                setError("");
                setRevision((x) => x + 1);
                if (selected) void loadDetail(selected, false);
              }}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
              刷新数据
            </button>
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
                        工单队列 <span>{total}</span>
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
                        maxLength={180}
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
                        ["rejected", "已拒绝"],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          className={filter === v ? "active" : ""}
                          onClick={() => {
                            setFilter(v);
                            setOffset(0);
                          }}
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
                  <Pagination
                    total={total}
                    offset={offset}
                    limit={PAGE_SIZE}
                    loading={loading}
                    onChange={setOffset}
                    label="工单"
                  />
                  <div className="queue-footer">
                    <i />
                    全部数据按工作空间隔离
                  </div>
                </div>
                <div className="detail-panel">
                  {detail ? (
                    <TicketDetail
                      key={detail.ticket.id}
                      detail={detail}
                      token={token}
                      orders={orders}
                      onChanged={() => afterMutation(detail.ticket.id)}
                      running={runningTicket === detail.ticket.id}
                      runDisabled={!!runningTicket}
                      onRun={runAgent}
                      isReviewer={session.user.role === "reviewer"}
                      onApproval={() => setPage("approvals")}
                    />
                  ) : (
                    <Empty
                      text={
                        detailLoading
                          ? "正在读取工单…"
                          : selected
                            ? "工单读取失败，请点击刷新数据重试"
                            : "创建第一张工单，开始处理"
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
            <KnowledgePanel
              items={knowledge}
              token={token}
              isReviewer={session.user.role === "reviewer"}
              onChanged={refresh}
            />
          )}
          {page === "audit" && (
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    操作记录 <span>{auditTotal}</span>
                  </h2>
                  <p>记录来自后端持久化审计表；不触发任何业务重放。</p>
                </div>
                <Terminal size={21} />
              </div>
              <label className="search-box audit-search">
                <Search size={17} />
                <input
                  aria-label="搜索审计记录"
                  maxLength={180}
                  placeholder="搜索操作、对象或操作人…"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                />
              </label>
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
              <Pagination
                total={auditTotal}
                offset={auditOffset}
                limit={PAGE_SIZE}
                loading={loading}
                onChange={setAuditOffset}
                label="审计"
              />
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
            setQuery("");
            setSearch("");
            setFilter("all");
            setOffset(0);
            await refresh();
            setSelected(t.id);
            setNotice("工单已创建，可以运行 Agent 生成处理方案。");
          }}
        />
      )}
    </div>
  );
}
