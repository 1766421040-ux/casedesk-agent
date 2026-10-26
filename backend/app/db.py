from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import uuid

from .security import password_hash


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


SCHEMA = """
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,budget_cents INTEGER NOT NULL CHECK(budget_cents>=0));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('agent','reviewer')),password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),customer_name TEXT NOT NULL,product TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0 AND refunded_cents<=amount_cents),delivery_days INTEGER NOT NULL,return_eligible INTEGER NOT NULL,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),title TEXT NOT NULL,version INTEGER NOT NULL,category TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),document_id TEXT NOT NULL REFERENCES documents(id),version INTEGER NOT NULL,text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),created_by TEXT NOT NULL,subject TEXT NOT NULL,description TEXT NOT NULL,customer_name TEXT NOT NULL,order_id TEXT REFERENCES orders(id),status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,latest_run_id TEXT);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),ticket_id TEXT NOT NULL REFERENCES tickets(id),created_by TEXT NOT NULL,idempotency_key TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(tenant_id,idempotency_key));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(ticket_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),ticket_id TEXT NOT NULL REFERENCES tickets(id),run_id TEXT UNIQUE NOT NULL REFERENCES runs(id),order_id TEXT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),reason TEXT NOT NULL,requested_by TEXT NOT NULL,created_at TEXT NOT NULL,decided_at TEXT,decided_by TEXT,decision_reason TEXT);
CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),approval_id TEXT UNIQUE NOT NULL REFERENCES approvals(id),order_id TEXT NOT NULL REFERENCES orders(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions(tenant_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(tenant_id,idempotency_key));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tickets_tenant ON tickets(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id,id);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
"""


class Database:
    def __init__(self, path: str):
        self.path = path

    @contextmanager
    def connect(self, write=False):
        con = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA busy_timeout=15000")
        try:
            if write:
                con.execute("BEGIN IMMEDIATE")
            yield con
            if write:
                con.commit()
        except Exception:
            if write:
                con.rollback()
            raise
        finally:
            con.close()

    def initialize(self, seed=True):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(SCHEMA)
        if seed:
            self.seed()

    def seed(self):
        with self.connect(write=True) as con:
            if con.execute("SELECT COUNT(*) FROM tenants").fetchone()[0]:
                return
            password = password_hash("DemoPass!2026")
            for slug, name in [("aurora", "极光数码"), ("harbor", "海港生活")]:
                con.execute("INSERT INTO tenants VALUES(?,?,?)", (slug, name, 100000))
                for role, person in [("agent", "林晓 · 客服"), ("reviewer", "陈默 · 审批人")]:
                    con.execute("INSERT INTO users(id,tenant_id,email,name,role,password_hash) VALUES(?,?,?,?,?,?)", (f"{slug}-{role}", slug, f"{role}@{slug}.demo", person, role, password))
                order_data = [("1001", "张一", "无线降噪耳机", 29900, 7, 1, "delivered"), ("1002", "李二", "便携蓝牙音箱", 15900, 3, 1, "delivered"), ("1003", "王三", "机械键盘", 49900, 45, 0, "delivered"), ("1004", "赵四", "智能手表", 69900, 0, 0, "shipping")]
                for number, customer, product, amount, days, eligible, status in order_data:
                    con.execute("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?)", (f"{slug.upper()}-{number}", slug, customer, product, amount, 0, days, eligible, status))
                docs = [
                    ("refund", "退款与退货政策", "退款 refund 退货 return：已签收 30 天内且订单标记可退货的商品，可申请退款。是否可退以订单系统校验为准，超期订单转人工复核。\n\n退款金额不得超过订单剩余可退金额，单笔最高 50000 分（500 元）。租户演示累计退款预算为 100000 分（1000 元）。所有退款必须由不同于申请人的 reviewer 审批；模型无审批或执行权限。"),
                    ("shipping", "物流与配送说明", "物流 shipping 配送 delivery：正常配送时效为 3–5 个工作日，可使用订单编号查询配送状态。运输途中不可直接确认退款，遇到丢件须由客服人工核实。"),
                    ("warranty", "质保与维修规则", "质保 warranty 维修 repair：数码产品在签收后 365 天内可申请售后检测。请保留订单凭证和故障描述。是否免费维修取决于检测结果，客服不得保证免费换新。"),
                    ("invoice", "发票与凭证指南", "发票 invoice 收据 receipt：已支付订单可由人工核实抬头后补开发票。个人信息仅用于对应工单处理，系统不提供其他租户的客户或订单信息。"),
                ]
                for category, title, body in docs:
                    did = f"{slug}-{category}"
                    con.execute("INSERT INTO documents VALUES(?,?,?,?,?,?,?)", (did, slug, title, 1, category, body, now()))
                    for i, paragraph in enumerate(body.split("\n\n"), 1):
                        con.execute("INSERT INTO chunks VALUES(?,?,?,?,?)", (f"{did}:v1:{i}", slug, did, 1, paragraph))
                for index, subject, description, order in [
                    (1, "耳机已签收，希望申请退款", "耳机签收 7 天，商品未使用，想按退货政策申请退款，请核对订单并提供处理方案。", "1001"),
                    (2, "查询智能手表配送进度", "我的智能手表还在运输中，请帮忙查询物流状态和预计配送时间。", "1004"),
                    (3, "机械键盘超期退款咨询", "键盘购买 45 天了，现在希望退款。请确认是否符合售后政策。", "1003"),
                    (4, "咨询国际运费与关税", "请确认寄往冰岛的国际运费和进口税具体是多少，目前没有相关订单。", None),
                ]:
                    created = now()
                    con.execute("INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?,?,?)", (f"{slug}-ticket-{index}", slug, f"{slug}-agent", subject, description, "演示客户", f"{slug.upper()}-{order}" if order else None, "open", created, created, None))


def audit(con, user, action, entity_type, entity_id, detail):
    con.execute("INSERT INTO audit(tenant_id,actor_id,actor_name,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?,?)", (user["tenantId"], user["id"], user["name"], action, entity_type, entity_id, dumps(detail), now()))


def ticket_json(row):
    return {"id": row["id"], "subject": row["subject"], "description": row["description"], "customerName": row["customer_name"], "orderId": row["order_id"], "status": row["status"], "createdAt": row["created_at"], "updatedAt": row["updated_at"], "latestRunId": row["latest_run_id"]}


def approval_json(row):
    return {"id": row["id"], "ticketId": row["ticket_id"], "runId": row["run_id"], "orderId": row["order_id"], "status": row["status"], "amountCents": row["amount_cents"], "reason": row["reason"], "requestedBy": row["requested_by"], "createdAt": row["created_at"], "decidedAt": row["decided_at"], "decidedBy": row["decided_by"], "decisionReason": row["decision_reason"]}


def order_json(row):
    return {"id": row["id"], "customerName": row["customer_name"], "product": row["product"], "amountCents": row["amount_cents"], "refundedCents": row["refunded_cents"], "deliveryDays": row["delivery_days"], "returnEligible": bool(row["return_eligible"]), "status": row["status"]}
