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
  orderId: string | null;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string | null;
};
export type Evidence = {
  documentId: string;
  title: string;
  version: number;
  chunkId: string;
  text: string;
  score: number;
};
export type Run = {
  id: string;
  ticketId: string;
  status: string;
  provider: string;
  ticketVersion?: number;
  createdAt: string;
  completedAt: string | null;
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
    completedAt: string | null;
    input: unknown;
    output: unknown;
  }[];
  toolCalls?: ToolCall[];
  terminationReason?: string;
  metrics?: {
    providerCalls: number;
    usageReportedCalls?: number;
    toolCalls: number;
    durationMs: number;
    tokenUsage: Record<string, number> | null;
  };
  approvalId?: string | null;
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
  id: number;
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
  version: number;
  body: string;
  updatedAt: string;
  bodyEditable: boolean;
  publicationPolicy: string;
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
export type ToolCall = {
  id: string;
  name: string;
  source: string;
  status: string;
  arguments: unknown;
  output: unknown;
  round?: number;
  startedAt?: string;
  completedAt?: string | null;
  error?: unknown;
  durationMs?: number;
};
export type TicketHistory = {
  id: number;
  action: string;
  actorName: string;
  actorId: string;
  ticketVersion: number;
  detail: Record<string, unknown>;
  createdAt: string;
};
export type KnowledgeVersion = {
  documentId: string;
  title: string;
  version: number;
  body: string;
  publishedAt: string;
  publishedBy: string;
  reason: string;
  isCurrent: boolean;
};
export type PageResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
  options: { method?: string; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      signal: options.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "无法连接服务。请检查网络后刷新；提交操作的结果请先查看记录再重试。",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token)
      window.dispatchEvent(
        new CustomEvent("casedesk:session-expired", { detail: token }),
      );
    throw new ApiError(
      response.status,
      data?.error?.code || "REQUEST_FAILED",
      data?.error?.message ||
        data?.detail?.[0]?.msg ||
        `请求失败 (${response.status})`,
    );
  }
  if (data === null)
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "服务返回了无法读取的响应，请刷新后重试。",
    );
  return data;
}
