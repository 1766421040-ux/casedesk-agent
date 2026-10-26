"""CaseDesk API. Run one application worker; SQLite is the local demonstration store."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import secrets
import sqlite3
import threading
import time

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .agent import AgentWorkflow
from .config import Settings
from .db import Database, approval_json, audit, dumps, now, order_json, ticket_json, uid
from .models import Decision, Login, RunCreate, TicketCreate
from .security import password_hash, token_hash, verify_password


class APIError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    database = Database(settings.database_path)
    workflow = AgentWorkflow(database, settings)
    attempts, attempts_lock = {}, threading.Lock()
    dummy_password_hash = password_hash("not-a-real-account")

    @asynccontextmanager
    async def lifespan(app):
        database.initialize(settings.demo_seed)
        # Runs interrupted by process exit remain visible and cannot accidentally execute twice.
        # This startup recovery is why the local deployment uses exactly one worker.
        with database.connect(write=True) as con:
            for row in con.execute("SELECT * FROM runs WHERE status='running'").fetchall():
                payload = json.loads(row["payload"])
                payload.update(status="failed", completedAt=now(), error={"code": "PROCESS_INTERRUPTED", "message": "服务在上次运行中重启。该运行已保留为失败记录，请使用新的运行键重试。"})
                for step in payload["steps"]:
                    if step["status"] == "running":
                        step.update(status="failed", completedAt=now(), output={"error": "PROCESS_INTERRUPTED"})
                con.execute("UPDATE runs SET status='failed',payload=? WHERE id=?", (dumps(payload), row["id"]))
                audit(con, {"tenantId": row["tenant_id"], "id": "system", "name": "CaseDesk recovery"}, "agent.interrupted", "run", row["id"], {"reason": "PROCESS_INTERRUPTED"})
        yield

    app = FastAPI(title="CaseDesk · Auditable Service Agent", version="1.0.0", description="A local multi-tenant support workflow. Deterministic demo provider by default. Refunds are local ledger entries, never real payments. All currency uses integer cents. Single-worker SQLite deployment.", lifespan=lifespan)
    app.state.db, app.state.workflow, app.state.settings = database, workflow, settings
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173", "http://localhost:3000"], allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH"}:
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 32768:
                    return JSONResponse(status_code=413, content={"error": {"code": "BODY_TOO_LARGE", "message": "请求体不得超过 32 KiB"}})
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(APIError)
    async def api_error(request, exc):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": "请求字段不符合约束", "details": [{"field": ".".join(str(x) for x in err["loc"]), "message": err["msg"]} for err in exc.errors()]}})

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": "HTTP_ERROR", "message": str(exc.detail)}})

    @app.exception_handler(sqlite3.Error)
    async def database_error(request, exc):
        logging.getLogger("casedesk").exception("Database request failed")
        return JSONResponse(status_code=503, content={"error": {"code": "DATABASE_BUSY", "message": "本地存储暂不可用，请稍后重试"}})

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logging.getLogger("casedesk").exception("Unexpected request failure")
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "服务暂时无法完成该请求"}})

    def current_user(authorization: str | None = Header(default=None)):
        if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 500:
            raise APIError(401, "AUTH_REQUIRED", "请先登录")
        token = authorization[7:]
        with database.connect() as con:
            row = con.execute("SELECT u.*,t.name AS tenant_name FROM sessions s JOIN users u ON s.user_id=u.id JOIN tenants t ON t.id=u.tenant_id WHERE s.token_hash=? AND s.expires_at>?", (token_hash(token), now())).fetchone()
        if not row:
            raise APIError(401, "SESSION_EXPIRED", "登录会话无效或已过期")
        return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"], "tenantId": row["tenant_id"], "tenantName": row["tenant_name"]}

    def ticket_row(con, ticket_id, user):
        row = con.execute("SELECT * FROM tickets WHERE id=? AND tenant_id=?", (ticket_id, user["tenantId"])).fetchone()
        if not row:
            raise APIError(404, "TICKET_NOT_FOUND", "找不到该工单")
        return row

    @app.get("/api/health")
    def health():
        with database.connect() as con:
            con.execute("SELECT 1").fetchone()
        return {"status": "ok", "provider": settings.provider, "demoMode": settings.provider == "demo", "persistence": "sqlite", "realPayments": False, "execution": "synchronous-bounded", "workflow": "LangGraph", "retrieval": "BM25"}

    @app.post("/api/auth/login")
    def login(payload: Login):
        email = payload.email.lower()
        timestamp = time.monotonic()
        with attempts_lock:
            for expired_key in [key for key, values in attempts.items() if timestamp - values[0] > 300]:
                del attempts[expired_key]
            record = attempts.get(email, (timestamp, 0))
            if record[1] >= 8:
                raise APIError(429, "LOGIN_THROTTLED", "登录失败次数过多，请五分钟后重试")
            # Fixed cap avoids unbounded memory growth from invented usernames.
            if len(attempts) >= 1000 and email not in attempts:
                raise APIError(429, "LOGIN_THROTTLED", "登录服务繁忙，请稍后重试")
            attempts[email] = (record[0], record[1] + 1)
        with database.connect() as con:
            row = con.execute("SELECT u.*,t.name AS tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=?", (email,)).fetchone()
        valid = verify_password(payload.password, row["password_hash"] if row else dummy_password_hash)
        if not row or not valid:
            raise APIError(401, "INVALID_CREDENTIALS", "邮箱或密码错误")
        with attempts_lock:
            attempts.pop(email, None)
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(hours=settings.session_hours)).isoformat()
        user = {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"], "tenantId": row["tenant_id"], "tenantName": row["tenant_name"]}
        with database.connect(write=True) as con:
            con.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
            con.execute("INSERT INTO sessions VALUES(?,?,?)", (token_hash(token), row["id"], expires))
            audit(con, user, "auth.login", "user", row["id"], {"role": row["role"]})
        return {"token": token, "user": user, "expiresAt": expires}

    @app.post("/api/auth/logout")
    def logout(user=Depends(current_user), authorization: str = Header()):
        with database.connect(write=True) as con:
            con.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(authorization[7:]),))
        return {"ok": True}

    @app.get("/api/me")
    def me(user=Depends(current_user)):
        return {"user": user}

    @app.get("/api/stats")
    def stats(user=Depends(current_user)):
        with database.connect() as con:
            statuses = dict(con.execute("SELECT status,COUNT(*) FROM tickets WHERE tenant_id=? GROUP BY status", (user["tenantId"],)).fetchall())
            refunded = con.execute("SELECT COALESCE(SUM(amount_cents),0) FROM refunds WHERE tenant_id=?", (user["tenantId"],)).fetchone()[0]
            budget = con.execute("SELECT budget_cents FROM tenants WHERE id=?", (user["tenantId"],)).fetchone()[0]
            docs = con.execute("SELECT COUNT(*) FROM documents WHERE tenant_id=?", (user["tenantId"],)).fetchone()[0]
            pending = con.execute("SELECT COUNT(*) FROM approvals WHERE tenant_id=? AND status='pending'", (user["tenantId"],)).fetchone()[0]
            runs_count = con.execute("SELECT COUNT(*) FROM runs WHERE tenant_id=?", (user["tenantId"],)).fetchone()[0]
        return {"tickets": sum(statuses.values()), "awaitingApproval": pending, "resolved": statuses.get("resolved", 0), "totalRefundCents": refunded, "knowledgeDocuments": docs, "budgetCents": budget, "remainingBudgetCents": budget - refunded, "runs": runs_count}

    @app.get("/api/orders")
    def orders(user=Depends(current_user)):
        with database.connect() as con:
            rows = con.execute("SELECT * FROM orders WHERE tenant_id=? ORDER BY id", (user["tenantId"],)).fetchall()
        return {"items": [order_json(row) for row in rows]}

    @app.get("/api/tickets")
    def tickets(user=Depends(current_user)):
        with database.connect() as con:
            rows = con.execute("SELECT * FROM tickets WHERE tenant_id=? ORDER BY created_at DESC LIMIT 500", (user["tenantId"],)).fetchall()
        return {"items": [ticket_json(row) for row in rows]}

    @app.post("/api/tickets", status_code=201)
    def create_ticket(payload: TicketCreate, user=Depends(current_user)):
        ticket_id, created = uid("ticket"), now()
        with database.connect(write=True) as con:
            if payload.orderId and not con.execute("SELECT id FROM orders WHERE id=? AND tenant_id=?", (payload.orderId, user["tenantId"])).fetchone():
                raise APIError(404, "ORDER_NOT_FOUND", "找不到该订单")
            con.execute("INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?,?,NULL)", (ticket_id, user["tenantId"], user["id"], payload.subject, payload.description, payload.customerName, payload.orderId, "open", created, created))
            audit(con, user, "ticket.created", "ticket", ticket_id, {"orderId": payload.orderId})
            ticket = ticket_json(ticket_row(con, ticket_id, user))
        return {"ticket": ticket}

    @app.get("/api/tickets/{ticket_id}")
    def ticket_detail(ticket_id: str, user=Depends(current_user)):
        with database.connect() as con:
            ticket = ticket_json(ticket_row(con, ticket_id, user))
            runs = [json.loads(row[0]) for row in con.execute("SELECT payload FROM runs WHERE ticket_id=? AND tenant_id=? ORDER BY rowid DESC", (ticket_id, user["tenantId"]))]
            approvals = [approval_json(row) for row in con.execute("SELECT * FROM approvals WHERE ticket_id=? AND tenant_id=? ORDER BY created_at DESC", (ticket_id, user["tenantId"]))]
        return {"ticket": ticket, "runs": runs, "approvals": approvals}

    @app.post("/api/tickets/{ticket_id}/runs")
    def run_agent(ticket_id: str, payload: RunCreate = RunCreate(), user=Depends(current_user)):
        key = payload.idempotencyKey or uid("request")
        with database.connect(write=True) as con:
            ticket = ticket_json(ticket_row(con, ticket_id, user))
            existing = con.execute("SELECT * FROM runs WHERE tenant_id=? AND idempotency_key=?", (user["tenantId"], key)).fetchone()
            if existing:
                if existing["ticket_id"] != ticket_id or existing["created_by"] != user["id"]:
                    raise APIError(409, "IDEMPOTENCY_CONFLICT", "该运行键已被用于另一个请求")
                return {"run": json.loads(existing["payload"]), "idempotentReplay": True}
            if ticket["status"] != "open":
                raise APIError(409, "TICKET_STATE_CONFLICT", "仅待处理工单可以运行 Agent")
            if con.execute("SELECT id FROM runs WHERE ticket_id=? AND tenant_id=? AND status='running'", (ticket_id, user["tenantId"])).fetchone():
                raise APIError(409, "RUN_IN_PROGRESS", "该工单已有运行中的任务")
            run_id = uid("run")
            run = {"id": run_id, "ticketId": ticket_id, "status": "running", "provider": settings.provider, "demoMode": settings.provider == "demo", "createdAt": now(), "completedAt": None, "answer": "", "evidence": [], "proposal": None, "steps": [], "approvalId": None, "error": None}
            con.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?)", (run_id, user["tenantId"], ticket_id, user["id"], key, "running", dumps(run)))
            con.execute("UPDATE tickets SET latest_run_id=?,updated_at=? WHERE id=? AND tenant_id=?", (run_id, now(), ticket_id, user["tenantId"]))
            audit(con, user, "agent.started", "run", run_id, {"ticketId": ticket_id, "provider": settings.provider})
        return {"run": workflow.execute(run_id, ticket, user), "idempotentReplay": False}

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str, user=Depends(current_user)):
        with database.connect() as con:
            row = con.execute("SELECT payload FROM runs WHERE id=? AND tenant_id=?", (run_id, user["tenantId"])).fetchone()
        if not row:
            raise APIError(404, "RUN_NOT_FOUND", "找不到该运行记录")
        return {"run": json.loads(row[0])}

    @app.get("/api/approvals")
    def approvals(user=Depends(current_user)):
        with database.connect() as con:
            rows = con.execute("SELECT * FROM approvals WHERE tenant_id=? ORDER BY created_at DESC LIMIT 500", (user["tenantId"],)).fetchall()
        return {"items": [approval_json(row) for row in rows]}

    @app.post("/api/approvals/{approval_id}/decision")
    def decide(approval_id: str, payload: Decision, user=Depends(current_user)):
        if user["role"] != "reviewer":
            raise APIError(403, "REVIEWER_REQUIRED", "只有审批人可以审批或拒绝退款")
        request_hash = hashlib.sha256(dumps({"approvalId": approval_id, "decision": payload.decision, "reason": payload.reason, "actorId": user["id"]}).encode()).hexdigest()
        with database.connect(write=True) as con:
            row = con.execute("SELECT * FROM approvals WHERE id=? AND tenant_id=?", (approval_id, user["tenantId"])).fetchone()
            if not row:
                raise APIError(404, "APPROVAL_NOT_FOUND", "找不到该审批记录")
            if row["requested_by"] == user["id"]:
                raise APIError(403, "SELF_APPROVAL_FORBIDDEN", "申请人不能审批自己的退款方案")
            replay = con.execute("SELECT * FROM decisions WHERE tenant_id=? AND idempotency_key=?", (user["tenantId"], payload.idempotencyKey)).fetchone()
            if replay:
                if replay["request_hash"] != request_hash:
                    raise APIError(409, "IDEMPOTENCY_CONFLICT", "该幂等键已用于其他审批请求")
                return json.loads(replay["response"])
            if row["status"] != "pending":
                raise APIError(409, "APPROVAL_ALREADY_DECIDED", "审批已经完成，不能再次变更")
            refund = None
            decided_at = now()
            if payload.decision == "approve":
                order = con.execute("SELECT * FROM orders WHERE id=? AND tenant_id=?", (row["order_id"], user["tenantId"])).fetchone()
                if not order or not order["return_eligible"] or order["status"] != "delivered" or not 0 <= order["delivery_days"] <= 30:
                    raise APIError(409, "ORDER_INELIGIBLE", "订单当前状态不满足退款条件")
                amount = row["amount_cents"]
                if amount > 50000 or amount > order["amount_cents"] - order["refunded_cents"]:
                    raise APIError(409, "REFUND_LIMIT_EXCEEDED", "退款金额超过单笔上限或订单剩余可退金额")
                budget = con.execute("SELECT budget_cents FROM tenants WHERE id=?", (user["tenantId"],)).fetchone()[0]
                spent = con.execute("SELECT COALESCE(SUM(amount_cents),0) FROM refunds WHERE tenant_id=?", (user["tenantId"],)).fetchone()[0]
                if spent + amount > budget:
                    raise APIError(409, "TENANT_BUDGET_EXCEEDED", "该租户剩余退款预算不足")
                original_run = json.loads(con.execute("SELECT payload FROM runs WHERE id=? AND tenant_id=?", (row["run_id"], user["tenantId"])).fetchone()[0])
                for citation in original_run["evidence"]:
                    if not con.execute("SELECT id FROM documents WHERE id=? AND tenant_id=? AND version=?", (citation["documentId"], user["tenantId"], citation["version"])).fetchone():
                        raise APIError(409, "POLICY_VERSION_CHANGED", "政策版本已更新，请拒绝本方案并重新核实")
                refund = {"id": uid("refund"), "approvalId": approval_id, "orderId": row["order_id"], "amountCents": amount, "createdAt": decided_at, "simulated": True}
                con.execute("UPDATE orders SET refunded_cents=refunded_cents+? WHERE id=? AND tenant_id=?", (amount, row["order_id"], user["tenantId"]))
                con.execute("INSERT INTO refunds VALUES(?,?,?,?,?,?)", (refund["id"], user["tenantId"], approval_id, row["order_id"], amount, decided_at))
                audit(con, user, "refund.simulated", "refund", refund["id"], {"approvalId": approval_id, "orderId": row["order_id"], "amountCents": amount, "simulated": True})
            status = "approved" if payload.decision == "approve" else "rejected"
            con.execute("UPDATE approvals SET status=?,decided_at=?,decided_by=?,decision_reason=? WHERE id=? AND tenant_id=?", (status, decided_at, user["id"], payload.reason, approval_id, user["tenantId"]))
            con.execute("UPDATE tickets SET status=?,updated_at=? WHERE id=? AND tenant_id=?", ("resolved" if status == "approved" else "rejected", decided_at, row["ticket_id"], user["tenantId"]))
            audit(con, user, f"approval.{status}", "approval", approval_id, {"reason": payload.reason, "amountCents": row["amount_cents"]})
            approval = approval_json(con.execute("SELECT * FROM approvals WHERE id=? AND tenant_id=?", (approval_id, user["tenantId"])).fetchone())
            response = {"approval": approval, "refund": refund}
            con.execute("INSERT INTO decisions VALUES(?,?,?,?)", (user["tenantId"], payload.idempotencyKey, request_hash, dumps(response)))
            return response

    @app.get("/api/knowledge")
    def knowledge(user=Depends(current_user)):
        with database.connect() as con:
            rows = con.execute("SELECT * FROM documents WHERE tenant_id=? ORDER BY title", (user["tenantId"],)).fetchall()
            result = []
            for row in rows:
                chunks = [{"id": chunk["id"], "text": chunk["text"], "version": chunk["version"]} for chunk in con.execute("SELECT * FROM chunks WHERE document_id=? AND tenant_id=? AND version=? ORDER BY id", (row["id"], user["tenantId"], row["version"]))]
                result.append({"id": row["id"], "title": row["title"], "version": row["version"], "body": row["body"], "updatedAt": row["updated_at"], "category": row["category"], "chunks": chunks})
        return {"items": result}

    @app.get("/api/audit")
    def get_audit(user=Depends(current_user)):
        with database.connect() as con:
            rows = con.execute("SELECT * FROM audit WHERE tenant_id=? ORDER BY id DESC LIMIT 500", (user["tenantId"],)).fetchall()
        return {"items": [{"id": row["id"], "action": row["action"], "actorId": row["actor_id"], "actorName": row["actor_name"], "entityType": row["entity_type"], "entityId": row["entity_id"], "detail": json.loads(row["detail"]), "createdAt": row["created_at"]} for row in rows]}

    return app


app = create_app()
