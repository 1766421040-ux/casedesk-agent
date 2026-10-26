import type { Approval, Run, Ticket, User } from "./api";

export type Session = { token: string; user: User };

export type TicketDetailData = {
  ticket: Ticket;
  runs: Run[];
  approvals: Approval[];
};
