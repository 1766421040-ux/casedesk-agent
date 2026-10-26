import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  History,
  LoaderCircle,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { api, ApiError, type Order } from "../api";
import type { TicketDetailData } from "../types";
import { date } from "../lib/format";
import { Json } from "./ui";

const eventNames: Record<string, string> = {
  "ticket.created": "创建工单",
  "ticket.updated": "补充与修改",
  "ticket.resolved": "人工结案",
  "ticket.reopened": "重新打开",
  "agent.started": "开始处理",
  "agent.completed": "处理完成",
  "agent.failed": "处理失败",
  "approval.requested": "提交审批",
  "approval.approved": "审批通过",
  "approval.rejected": "审批拒绝",
};
export function TicketActions({
  detail,
  token,
  orders,
  busy,
  onChanged,
}: {
  detail: TicketDetailData;
  token: string;
  orders: Order[];
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"edit" | "resolve" | "reopen" | null>(null);
  const t = detail.ticket;
  const locked =
    busy ||
    detail.runs.some((r) => r.status === "running") ||
    detail.approvals.some((a) => a.status === "pending");
  return (
    <>
      <div className="ticket-actions">
        <span>工单版本 v{t.version}</span>
        {t.status === "open" && (
          <>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => setMode("edit")}
            >
              <Pencil size={14} />
              补充 / 修改
            </button>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => setMode("resolve")}
            >
              <CheckCircle2 size={14} />
              人工结案
            </button>
          </>
        )}
        {["resolved", "rejected"].includes(t.status) && (
          <button
            className="text-button"
            disabled={locked}
            onClick={() => setMode("reopen")}
          >
            <RotateCcw size={14} />
            重新打开
          </button>
        )}
      </div>
      {!!detail.history?.length && (
        <details className="ticket-history">
          <summary>
            <History size={14} />
            工单记录 · {detail.history.length} 条
          </summary>
          <ol>
            {detail.history.map((h) => (
              <li key={h.id}>
                <div>
                  <strong>{eventNames[h.action] || h.action}</strong>
                  <span>
                    {date(h.createdAt)} · {h.actorName || h.actorId} · v
                    {h.ticketVersion}
                  </span>
                </div>
                {!!h.detail.reason && <p>{String(h.detail.reason)}</p>}
                {!!h.detail.note && <p>{String(h.detail.note)}</p>}
                <details>
                  <summary>记录详情</summary>
                  <Json value={h.detail} />
                </details>
              </li>
            ))}
          </ol>
        </details>
      )}
      {mode && (
        <TicketEditDialog
          key={`${mode}:${t.version}`}
          detail={detail}
          token={token}
          orders={orders}
          mode={mode}
          onClose={() => setMode(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
function TicketEditDialog({
  detail,
  token,
  orders,
  mode,
  onClose,
  onChanged,
}: {
  detail: TicketDetailData;
  token: string;
  orders: Order[];
  mode: "edit" | "resolve" | "reopen";
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = detail.ticket;
  const [subject, setSubject] = useState(t.subject);
  const [description, setDescription] = useState(t.description);
  const [orderId, setOrderId] = useState(t.orderId || "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const title =
    mode === "edit"
      ? "补充与修改工单"
      : mode === "resolve"
        ? "人工结案"
        : "重新打开工单";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "edit")
        await api(
          `/tickets/${t.id}`,
          token,
          {
            expectedVersion: t.version,
            subject,
            description,
            orderId: orderId || null,
            ...(note.trim() ? { note } : {}),
          },
          { method: "PATCH" },
        );
      else
        await api(`/tickets/${t.id}/transition`, token, {
          expectedVersion: t.version,
          action: mode,
          reason,
        });
      await onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="create-dialog"
      aria-labelledby="edit-ticket-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">CASE UPDATE · V{t.version}</span>
          <h2 id="edit-ticket-title">{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭工单修改"
          disabled={busy}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={submit}>
        {mode === "edit" ? (
          <>
            <label>
              工单标题
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                minLength={3}
                maxLength={180}
                required
              />
            </label>
            <label>
              关联订单
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">暂不关联订单</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id} · {o.customerName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              问题描述
              <textarea
                aria-label="问题描述"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                minLength={5}
                maxLength={8000}
                required
              />
            </label>
            <label>
              追加信息（可选）
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                minLength={3}
                maxLength={2000}
                placeholder="客户补充的事实，将追加到描述并用于下次运行"
              />
            </label>
            <p className="form-help">
              修改不改变历史运行。保存后需重新运行，才能基于新信息生成方案。
            </p>
          </>
        ) : (
          <>
            <p className="form-help">
              {mode === "reopen"
                ? "保留此前的方案、审批和退款账本，重新进入待处理队列。已退款金额仍受订单额度约束。"
                : "记录人工处理结果并结束工单。此操作不会发送消息或执行退款。"}
            </p>
            <label>
              处理说明
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                minLength={3}
                maxLength={2000}
                required
              />
            </label>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {conflict && (
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              await onChanged();
              onClose();
            }}
          >
            加载最新工单后重新编辑
          </button>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button className="primary" disabled={busy || conflict}>
            {busy && <LoaderCircle size={16} className="spin" />}
            {mode === "edit"
              ? "保存修改"
              : mode === "resolve"
                ? "确认结案"
                : "确认重新打开"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
