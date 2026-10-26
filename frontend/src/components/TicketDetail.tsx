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
import type { TicketDetailData } from "../types";
import { date, money } from "../lib/format";
import { stageNames } from "../lib/labels";
import { Badge, Empty, Json } from "./ui";

export function TicketDetail({
  detail,
  running,
  onRun,
  isReviewer,
  onApproval,
}: {
  detail: TicketDetailData;
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
    detail.runs[detail.runs.length - 1];
  const canRun = t.status === "open" && !isReviewer;
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
            订单 <strong>{t.orderId}</strong>
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
          disabled={running || !canRun}
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
            <div className="result-tabs">
              {[
                ["answer", "处理方案"],
                ["evidence", `引用证据 ${run.evidence.length}`],
                ["trace", `执行轨迹 ${run.steps.length}`],
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
                        <span className="version">{e.version}</span>
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
