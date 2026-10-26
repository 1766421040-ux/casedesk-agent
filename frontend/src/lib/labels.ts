export const statuses: Record<string, string> = {
  open: "待处理",
  awaiting_approval: "待审批",
  resolved: "已完成",
  rejected: "已拒绝",
  pending: "待审批",
  approved: "已批准",
  completed: "已完成",
  failed: "执行失败",
  running: "执行中",
  success: "已完成",
  abstained: "转人工",
  blocked: "已拦截",
};
export const stageNames: Record<string, string> = {
  intake: "解析工单",
  retrieve: "检索知识",
  order_lookup: "查询订单",
  draft: "生成方案",
  policy_guard: "规则校验",
};
