import { useEffect, useRef, useState } from "react";
import { Check, Clock3, FileCheck2, LoaderCircle, X } from "lucide-react";
import { api, type Approval, type Run, type Ticket, type User } from "../api";
import { date, money } from "../lib/format";
import { Badge } from "./ui";

export function ApprovalCard({
  approval: a,
  ticket,
  user,
  token,
  decide,
}: {
  approval: Approval;
  ticket?: Ticket;
  run?: Run;
  user: User;
  token: string;
  decide: (
    id: string,
    decision: "approve" | "reject",
    reason: string,
    key: string,
  ) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [relatedTicket, setRelatedTicket] = useState<Ticket | undefined>(
    ticket,
  );
  const [run, setRun] = useState<Run | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const keys = useRef<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    setEvidenceLoading(true);
    setError("");
    Promise.all([
      api<{ run: Run }>(`/runs/${a.runId}`, token),
      ticket
        ? Promise.resolve({ ticket })
        : api<{ ticket: Ticket }>(`/tickets/${a.ticketId}`, token),
    ])
      .then(([r, t]) => {
        if (active) {
          setRun(r.run);
          setRelatedTicket(t.ticket);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [a.runId, token, attempt]);
  async function submit(decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    const keyName = `${decision}:${reason}`;
    keys.current[keyName] ??= crypto.randomUUID();
    try {
      await decide(a.id, decision, reason, keys.current[keyName]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="approval-card">
      <header>
        <span className="approval-icon">
          <FileCheck2 size={21} />
        </span>
        <Badge status={a.status} />
      </header>
      <h2>{relatedTicket?.subject || a.ticketId}</h2>
      <span className="muted">
        {relatedTicket?.customerName} · {relatedTicket?.orderId}
      </span>
      <div className="approval-amount">
        <span>申请模拟退款</span>
        <strong>{money(a.amountCents)}</strong>
      </div>
      <p>{a.reason}</p>
      <details className="approval-evidence">
        <summary>
          {evidenceLoading
            ? "正在载入证据…"
            : `复核规则与依据（${run?.evidence.length ?? 0} 条）`}
        </summary>
        {run?.evidence.map((e) => (
          <div key={e.chunkId}>
            <strong>
              {e.title} · v{e.version}
            </strong>
            <p>{e.text}</p>
          </div>
        ))}
      </details>
      {a.status === "pending" && user.role === "reviewer" ? (
        <>
          <label>
            审批意见
            <textarea
              aria-label={`审批意见 ${a.id}`}
              placeholder="说明批准或拒绝的依据（至少 3 个字）"
              value={reason}
              minLength={3}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </label>
          <div className="approval-actions">
            <button
              className="secondary danger"
              onClick={() => void submit("reject")}
              disabled={busy || reason.trim().length < 3}
            >
              <X size={16} />
              拒绝方案
            </button>
            <button
              className="primary"
              onClick={() => void submit("approve")}
              disabled={
                busy || reason.trim().length < 3 || !run || evidenceLoading
              }
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              批准并执行
            </button>
          </div>
        </>
      ) : a.status === "pending" ? (
        <div className="approval-wait">
          <Clock3 size={16} />
          等待主管审批；客服身份无法执行退款。
        </div>
      ) : (
        <div className="decision-record">
          <strong>{a.status === "approved" ? "审批通过" : "审批拒绝"}</strong>
          <p>{a.decisionReason}</p>
          <span>{date(a.decidedAt)}</span>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          {!run && (
            <button
              className="text-button"
              onClick={() => setAttempt((x) => x + 1)}
            >
              重新读取证据
            </button>
          )}
        </div>
      )}
      <footer>
        <code>{a.id.slice(-12)}</code>
        <span>{date(a.createdAt)}</span>
      </footer>
    </article>
  );
}
