import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, X } from "lucide-react";
import { api, type Order, type Ticket } from "../api";

export function CreateTicket({
  orders,
  token,
  onClose,
  onCreated,
}: {
  orders: Order[];
  token: string;
  onClose: () => void;
  onCreated: (t: Ticket) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ticket } = await api<{ ticket: Ticket }>("/tickets", token, {
        subject,
        description,
        customerName,
        orderId: orderId || null,
      });
      await onCreated(ticket);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="create-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="create-title"
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">NEW CASE</span>
          <h2 id="create-title">新建工单</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭新建工单"
          disabled={busy}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          工单标题
          <input
            required
            minLength={3}
            maxLength={180}
            autoFocus
            placeholder="例如：蓝牙耳机存在质量问题，申请退款"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            客户姓名
            <input
              required
              maxLength={100}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="客户称呼"
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
                <option value={o.id} key={o.id}>
                  {o.id} · {o.customerName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          问题描述
          <textarea
            required
            minLength={5}
            maxLength={8000}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="描述商品问题、购买情况与客户诉求。Agent 将依据规则和订单信息判断。"
          />
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy && <LoaderCircle size={16} className="spin" />}创建工单
          </button>
        </div>
      </form>
    </dialog>
  );
}
