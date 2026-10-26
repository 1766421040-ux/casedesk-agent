export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  tenantName: string;
};
export type Ticket = {
  id: string;
  subject: string;
  description: string;
  customerName: string;
  orderId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
};
export type Evidence = {
  documentId: string;
  title: string;
  version: string;
  chunkId: string;
  text: string;
  score: number;
};
export type Run = {
  id: string;
  ticketId: string;
  status: string;
  provider: string;
  createdAt: string;
  completedAt: string;
  answer: string;
  evidence: Evidence[];
  proposal: {
    action: string;
    amountCents: number;
    reason: string;
    citations: string[];
  } | null;
  steps: {
    id: string;
    name: string;
    status: string;
    startedAt: string;
    completedAt: string;
    input: unknown;
    output: unknown;
  }[];
  approvalId?: string;
  error?: { code: string; message: string; type?: string };
};
export type Approval = {
  id: string;
  ticketId: string;
  runId: string;
  status: string;
  amountCents: number;
  reason: string;
  requestedBy: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
};
export type Audit = {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  detail: unknown;
  createdAt: string;
};
export type Knowledge = {
  id: string;
  title: string;
  version: string;
  body: string;
  updatedAt: string;
};
export type Order = {
  id: string;
  customerName?: string;
  amountCents?: number;
  status?: string;
  [key: string]: unknown;
};
export type Stats = {
  tickets: number;
  awaitingApproval: number;
  resolved: number;
  totalRefundCents: number;
  knowledgeDocuments: number;
};
export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        data.detail?.[0]?.msg ||
        `请求失败 (${response.status})`,
    );
  return data;
}
