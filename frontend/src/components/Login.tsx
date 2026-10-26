import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Layers3,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import type { Session } from "../types";

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("agent@aurora.demo");
  const [password, setPassword] = useState("DemoPass!2026");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<Session>("/auth/login", undefined, { email, password }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>
          CaseDesk<span className="brand-beta">LAB</span>
        </div>
        <div className="login-copy">
          <span className="eyebrow light">SUPPORT, WITH EVIDENCE.</span>
          <h1>
            让每一次处理，
            <br />
            都有据可循。
          </h1>
          <p>
            从客户问题到可执行方案。
            <br />让 Agent 负责查证，让人掌握决定。
          </p>
          <div className="story-steps">
            <span>
              <BookOpen size={17} />
              检索依据
            </span>
            <ArrowRight size={16} />
            <span>
              <Sparkles size={17} />
              形成方案
            </span>
            <ArrowRight size={16} />
            <span>
              <ShieldCheck size={17} />
              审批执行
            </span>
          </div>
        </div>
        <div className="story-footer">
          <span>01 / CASE OPERATIONS</span>
          <span>可审计的售后 Agent</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">WORKSPACE ACCESS</span>
          <h2>进入工作台</h2>
          <p className="muted">选择一个演示身份，体验完整的工单处理流程。</p>
          <div className="account-tabs">
            <button
              className={email.startsWith("agent@aurora") ? "active" : ""}
              onClick={() => setEmail("agent@aurora.demo")}
            >
              客服专员
            </button>
            <button
              className={email.startsWith("reviewer@aurora") ? "active" : ""}
              onClick={() => setEmail("reviewer@aurora.demo")}
            >
              审批主管
            </button>
            <button
              className={email.includes("harbor") ? "active" : ""}
              onClick={() => setEmail("agent@harbor.demo")}
            >
              另一租户
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              工作邮箱
              <input
                autoComplete="username"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              密码
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  进入 CaseDesk
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="demo-notice">
            <ShieldCheck size={20} />
            <div>
              <strong>本地演示环境</strong>
              <p>
                使用合成工单与模拟退款，不涉及真实客户或资金。默认模型为确定性演示模式。
              </p>
            </div>
          </div>
          <p className="login-hint">
            演示密码：DemoPass!2026
            <br />
            客服提出方案，主管审批；两个租户的数据彼此隔离。
          </p>
        </div>
      </section>
    </div>
  );
}
