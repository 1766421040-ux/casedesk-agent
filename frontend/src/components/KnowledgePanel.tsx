import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, History, LoaderCircle, Pencil, X } from "lucide-react";
import { api, ApiError, type Knowledge, type KnowledgeVersion } from "../api";
import { date } from "../lib/format";

export function KnowledgePanel({
  items,
  token,
  isReviewer,
  onChanged,
}: {
  items: Knowledge[];
  token: string;
  isReviewer: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <>
      <div className="info-strip">
        <BookOpen size={20} />
        <div>
          <strong>当前检索范围：{items.length} 份规则文档</strong>
          <p>
            新版本发布后用于后续检索；已有运行保留引用快照。退款规则变更会使旧方案无法直接批准。
          </p>
        </div>
      </div>
      <div className="knowledge-grid">
        {items.map((item) => (
          <KnowledgeCard
            key={item.id}
            item={item}
            token={token}
            isReviewer={isReviewer}
            onChanged={onChanged}
          />
        ))}
      </div>
    </>
  );
}
function KnowledgeCard({
  item: k,
  token,
  isReviewer,
  onChanged,
}: {
  item: Knowledge;
  token: string;
  isReviewer: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState<KnowledgeVersion[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const historySequence = useRef(0);
  useEffect(() => {
    historySequence.current++;
    setVersions(null);
    setLoading(false);
  }, [k.version]);
  async function history() {
    const sequence = ++historySequence.current;
    if (versions) {
      setVersions(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<{ items: KnowledgeVersion[] }>(
        `/knowledge/${k.id}/history`,
        token,
      );
      if (sequence === historySequence.current) setVersions(result.items);
    } catch (e) {
      if (sequence === historySequence.current) setError((e as Error).message);
    } finally {
      if (sequence === historySequence.current) setLoading(false);
    }
  }
  return (
    <article className="knowledge-card">
      <div className="knowledge-icon">
        <BookOpen size={22} />
      </div>
      <div className="knowledge-header">
        <h2>{k.title}</h2>
        <span className="version">v{k.version}</span>
      </div>
      <p className="knowledge-body">{k.body}</p>
      {!k.bodyEditable && (
        <p className="form-help">
          退款正文由服务端规则约束；可更新标题，金额与期限需随代码和测试一起变更。
        </p>
      )}
      <div className="knowledge-actions">
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void history()}
        >
          <History size={15} />
          {loading ? "载入中…" : versions ? "收起历史" : "版本历史"}
        </button>
        {isReviewer && (
          <button className="text-button" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            发布新版本
          </button>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {versions && (
        <div className="version-history">
          {versions.map((v) => (
            <details key={v.version}>
              <summary>
                v{v.version} {v.isCurrent ? "· 当前" : ""} ·{" "}
                {date(v.publishedAt)}
              </summary>
              <p>{v.reason}</p>
              <p className="knowledge-body">{v.body}</p>
            </details>
          ))}
        </div>
      )}
      <footer>
        <span>规则 ID · {k.id}</span>
        <span>{date(k.updatedAt)}</span>
      </footer>
      {editing && (
        <KnowledgeEditor
          item={k}
          token={token}
          onClose={() => setEditing(false)}
          onChanged={async () => {
            setVersions(null);
            await onChanged();
          }}
        />
      )}
    </article>
  );
}
function KnowledgeEditor({
  item: k,
  token,
  onClose,
  onChanged,
}: {
  item: Knowledge;
  token: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [baseVersion] = useState(k.version);
  const [title, setTitle] = useState(k.title);
  const [body, setBody] = useState(k.body);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/knowledge/${k.id}/publish`, token, {
        expectedVersion: baseVersion,
        title,
        body,
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
      aria-labelledby="publish-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">PUBLISH · BASE v{k.version}</span>
          <h2 id="publish-title">发布规则新版本</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label="关闭规则发布"
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          规则标题
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            maxLength={180}
            required
          />
        </label>
        <label>
          规则正文
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            minLength={10}
            maxLength={8000}
            required
            readOnly={!k.bodyEditable}
          />
        </label>
        {!k.bodyEditable && (
          <p className="form-help">此规则的正文受服务端约束，只能修改标题。</p>
        )}
        <label>
          发布说明
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            minLength={3}
            maxLength={1000}
            required
            placeholder="说明修改内容与复核依据"
          />
        </label>
        <p className="form-help">
          旧版本将永久保留。已引用此规则的待审批方案需要重新复核；版本冲突时不会覆盖他人的修改。
        </p>
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
            加载最新版本后重新编辑
          </button>
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
          <button
            className="primary"
            disabled={
              busy || conflict || (title === k.title && body === k.body)
            }
          >
            {busy && <LoaderCircle size={16} className="spin" />}确认发布
          </button>
        </div>
      </form>
    </dialog>
  );
}
