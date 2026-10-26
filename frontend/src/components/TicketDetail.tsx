import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { Order } from "../api";
import { TicketActions } from "./TicketActions";
import type { TicketDetailData } from "../types";
import { date, money } from "../lib/format";
import { stageNames } from "../lib/labels";
import { Badge, Empty, Json } from "./ui";

const terminationLabels: Record<string, string> = {
  proposal_submitted: "方案已提交",
  final_response: "最终结构化方案已提交",
  insufficient_evidence: "证据不足，转交人工",
  injection_flagged: "检测到越权指令",
  policy_rejected: "方案未通过规则校验",
  proposal_rejected: "提案未通过规则校验",
  tool_budget_exceeded: "达到工具调用上限",
  round_budget_exceeded: "达到模型请求上限",
  timeout: "达到运行时限",
  provider_or_workflow_failed: "模型或工作流异常",
  invalid_tool_arguments: "工具参数不合规",
  unknown_tool: "请求了未授权工具",
  order_scope_denied: "订单不属于此工单",
  invalid_tool_call_id: "调用标识不合规",
  duplicate_tool_call_id: "调用标识重复",
  invalid_tool_call: "工具调用格式错误",
  invalid_provider_response: "模型协议不合规",
  ambiguous_submission: "提案与读取调用混在同一批次",
};

export function TicketDetail({
  detail,
  token,
  orders,
  onChanged,
  runDisabled,
  running,
  onRun,
  isReviewer,
  onApproval,
}: {
  detail: TicketDetailData;
  token: string;
  orders: Order[];
  onChanged: () => Promise<void>;
  runDisabled: boolean;
  running: boolean;
  onRun: () => void;
  isReviewer: boolean;
  onApproval: () => void;
}) {
  const [tab, setTab] = useState("answer");
  const [runId, setRunId] = useState("");
  const t = detail.ticket;
  const run =
    detail.runs.find((r) => r.id === runId) ||
    detail.runs.find((r) => r.id === t.latestRunId) ||
    detail.runs[0];
  const activeRun = detail.runs.some((r) => r.status === "running");
  const canRun = t.status === "open" && !isReviewer && !activeRun;
  const inputChanged =
    run &&
    detail.history?.some(
      (h) =>
        h.action === "ticket.updated" &&
        h.ticketVersion > (run.ticketVersion ?? 0),
    );
  return (
    <>
      <div className="detail-heading">
        <div className="detail-kicker">
          <span>工单详情</span>
          <Badge status={t.status} />
        </div>
        <h2>{t.subject}</h2>
        <div className="detail-facts">
          <span>
            客户 <strong>{t.customerName}</strong>
          </span>
          <span>
            订单 <strong>{t.orderId || "未关联"}</strong>
          </span>
          <span>
            创建于 <strong>{date(t.createdAt)}</strong>
          </span>
        </div>
        <div className="customer-message">
          <span>客户描述</span>
          <p>{t.description}</p>
        </div>
      </div>
      <TicketActions
        detail={detail}
        token={token}
        orders={orders}
        busy={running}
        onChanged={onChanged}
      />
      <div className="agent-heading">
        <div>
          <span className="sparkle-box">
            <Sparkles size={20} />
          </span>
          <div>
            <h3>Agent 处理台</h3>
            <p>
              {run ? "已保存完整处理轨迹" : "读取规则与订单，生成可复核的方案"}
            </p>
          </div>
        </div>
        <button
          className="primary small"
          disabled={runDisabled || !canRun}
          onClick={onRun}
        >
          {running ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}{" "}
          {running ? "正在分析…" : run ? "重新运行" : "运行 Agent"}
        </button>
      </div>
      {!canRun && (
        <p className="read-only-hint">
          {isReviewer
            ? "主管可查看处理记录，请到审批中心复核方案。"
            : activeRun
              ? "此工单已有运行中的任务，正在同步处理记录。"
              : "此工单已进入审批或结案状态，处理记录以只读方式保留。"}
        </p>
      )}
      {running && (
        <div className="run-progress" role="status">
          <LoaderCircle className="spin" size={18} />
          <div>
            <strong>正在检索规则并校验方案</strong>
            <p>完成后展示持久化步骤。模型调用可能需要片刻。</p>
          </div>
        </div>
      )}
      {!run && !running ? (
        <div className="agent-empty">
          <div className="agent-orbit">
            <Sparkles size={30} />
          </div>
          <h3>先查证，再行动</h3>
          <p>
            Agent 将检索规则、读取订单，
            <br />
            并将需要退款的方案提交人工审批。
          </p>
          <div>
            <span>
              <BookOpen size={15} />
              规则引用
            </span>
            <span>
              <ShieldCheck size={15} />
              受控执行
            </span>
            <span>
              <Activity size={15} />
              全程留痕
            </span>
          </div>
        </div>
      ) : (
        run && (
          <div className="run-result">
            <div className="run-meta">
              <span>
                <i />
                {run.provider === "demo"
                  ? "确定性演示模式"
                  : `模型：${run.provider}`}
              </span>
              {detail.runs.length > 1 ? (
                <select
                  aria-label="历史运行"
                  value={run.id}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  {detail.runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {date(r.createdAt)} · {r.id.slice(-6)}
                    </option>
                  ))}
                </select>
              ) : (
                <span>RUN · {run.id.slice(-8)}</span>
              )}
            </div>
            {run.id !== t.latestRunId && (
              <div className="snapshot-hint">
                正在查看历史运行；此记录不会随当前工单修改而变化。
              </div>
            )}
            {run.ticketVersion !== undefined && inputChanged && (
              <div className="snapshot-hint">
                此方案基于工单 v{run.ticketVersion}。当前为 v{t.version}
                ，请结合工单记录复核。
              </div>
            )}
            {run.metrics && (
              <div className="run-metrics">
                <span>
                  耗时{" "}
                  <strong>{(run.metrics.durationMs / 1000).toFixed(2)}s</strong>
                </span>
                <span>
                  模型请求 <strong>{run.metrics.providerCalls}</strong>
                </span>
                <span>
                  工具调用 <strong>{run.metrics.toolCalls}</strong>
                </span>
                <span>
                  已报告 Token{" "}
                  <strong>
                    {run.metrics.tokenUsage?.total_tokens ?? "未报告"}
                  </strong>
                </span>
              </div>
            )}
            <div className="result-tabs">
              {[
                ["answer", "处理方案"],
                ["evidence", `引用证据 ${run.evidence.length}`],
                ["trace", `执行轨迹 ${run.steps.length}`],
                ["tools", `工具调用 ${run.toolCalls?.length ?? 0}`],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={tab === v ? "active" : ""}
                  onClick={() => setTab(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            {tab === "answer" && (
              <div className="answer-content">
                <div className="answer-label">
                  <CheckCircle2 size={17} />
                  <strong>处理建议</strong>
                  <Badge status={run.status} />
                </div>
                <p className="answer-text">
                  {run.answer || run.error?.message || "本次运行未生成方案。"}
                </p>
                {run.proposal && (
                  <div className={`proposal-card ${run.proposal.action}`}>
                    <span className="eyebrow">PROPOSED ACTION</span>
                    <div>
                      <h3>
                        {run.proposal.action === "refund"
                          ? "申请模拟退款"
                          : run.proposal.action === "abstain"
                            ? "转交人工处理"
                            : "回复客户"}
                      </h3>
                      {run.proposal.action === "refund" && (
                        <strong>{money(run.proposal.amountCents)}</strong>
                      )}
                    </div>
                    <p>{run.proposal.reason}</p>
                    {run.approvalId && (
                      <button className="text-button" onClick={onApproval}>
                        前往审批中心 <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )}
                <div className="evidence-summary">
                  <BookOpen size={16} />
                  <span>{run.evidence.length} 个规则片段作为依据</span>
                  <button onClick={() => setTab("evidence")}>
                    查看证据
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
            {tab === "evidence" && (
              <div className="evidence-list">
                {run.evidence.length ? (
                  run.evidence.map((e, i) => (
                    <article key={e.chunkId}>
                      <div>
                        <span className="citation-number">{i + 1}</span>
                        <h4>{e.title}</h4>
                        <span className="version">v{e.version}</span>
                      </div>
                      <p>{e.text}</p>
                      <footer>
                        <code>{e.chunkId}</code>
                        <span>检索分值 {e.score.toFixed(3)}</span>
                      </footer>
                    </article>
                  ))
                ) : (
                  <Empty text="未检索到足够依据，系统不应据此执行退款。" />
                )}
              </div>
            )}
            {tab === "tools" && (
              <div className="tool-list">
                <p className="trace-footnote">
                  {run.provider === "demo"
                    ? "演示策略通过工具边界执行，无真实模型请求。"
                    : "包含工作流预检和模型主动调用；仅允许读取当前工单的数据并提交方案。"}
                </p>
                {run.toolCalls?.length ? (
                  run.toolCalls.map((call, index) => (
                    <details key={`${call.id}:${index}`}>
                      <summary>
                        <code>{call.name}</code>
                        <span>
                          {call.source === "model"
                            ? "模型选择"
                            : call.source === "demo"
                              ? "演示策略"
                              : "工作流预检"}
                        </span>
                        <Badge status={call.status} />
                      </summary>
                      <div className="trace-payload">
                        <small>CALL · {call.id}</small>
                        <p>参数</p>
                        <Json value={call.arguments} />
                        <p>结果</p>
                        <Json value={call.output} />
                      </div>
                    </details>
                  ))
                ) : (
                  <Empty text="此运行没有工具调用记录" />
                )}
                {run.terminationReason && (
                  <p className="trace-footnote">
                    停止原因：
                    {terminationLabels[run.terminationReason] ||
                      run.terminationReason}
                  </p>
                )}
              </div>
            )}
            {tab === "trace" && (
              <div className="trace-list">
                {run.steps.map((s, i) => (
                  <details key={s.id}>
                    <summary>
                      <span className="trace-number">
                        {s.status === "failed" ? (
                          <X size={14} />
                        ) : (
                          <Check size={14} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {String(i + 1).padStart(2, "0")} ·{" "}
                          {stageNames[s.name] || s.name}
                        </strong>
                        <small>{date(s.startedAt)}</small>
                      </div>
                      <Badge status={s.status} />
                      <ChevronRight size={15} />
                    </summary>
                    <div className="trace-payload">
                      <span>输入</span>
                      <Json value={s.input} />
                      <span>输出</span>
                      <Json value={s.output} />
                    </div>
                  </details>
                ))}
                <p className="trace-footnote">
                  回放展示已保存的输入输出，不会再次执行工具或退款。
                </p>
              </div>
            )}
          </div>
        )
      )}
    </>
  );
}
