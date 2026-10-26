import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { statuses } from "../lib/labels";

export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>{statuses[status] || status}</span>
  );
}

export function Empty({
  text,
  icon = <Inbox size={30} />,
}: {
  text: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <p>{text}</p>
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="json">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Stat({
  label,
  value,
  note,
  icon,
  amber = false,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  amber?: boolean;
}) {
  return (
    <div className={`stat-card ${amber ? "amber" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
