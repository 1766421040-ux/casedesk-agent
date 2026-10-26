"""Business lifecycle regressions: edits, state transitions, policy history and migration."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.db import Database, SCHEMA, dumps
from app.main import create_app


def detail(client, auth, ticket_id="aurora-ticket-1"):
    return client.get(f"/api/tickets/{ticket_id}", headers=auth()).json()


def update(client, auth, ticket_id="aurora-ticket-1", **fields):
    return client.patch(f"/api/tickets/{ticket_id}", headers=auth(), json={"expectedVersion": detail(client, auth, ticket_id)["ticket"]["version"], **fields})


def transition(client, auth, action, ticket_id="aurora-ticket-1", **fields):
    return client.post(f"/api/tickets/{ticket_id}/transition", headers=auth(), json={"expectedVersion": detail(client, auth, ticket_id)["ticket"]["version"], "action": action, "reason": "人工核实后继续处理", **fields})


def decision(client, auth, approval_id, action="approve", key="v2-decision-key"):
    return client.post(f"/api/approvals/{approval_id}/decision", headers=auth("reviewer"), json={"decision": action, "reason": "已核实订单与当前政策", "idempotencyKey": key})


def knowledge(client, auth, category="refund"):
    return next(item for item in client.get("/api/knowledge", headers=auth()).json()["items"] if item["category"] == category)


def publish(client, auth, document, **fields):
    return client.post(f"/api/knowledge/{document['id']}/publish", headers=auth("reviewer"), json={"expectedVersion": document["version"], "title": document["title"] + "（复核版）", "body": document["body"], "reason": "明确人工复核与引用说明", **fields})


def test_ticket_optimistic_lock_prevents_lost_updates(client, auth):
    before = detail(client, auth)["ticket"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda text: client.patch("/api/tickets/aurora-ticket-1", headers=auth(), json={"expectedVersion": before["version"], "subject": text}), ["已核实耳机退款申请", "已补充耳机退款资料"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert next(response for response in responses if response.status_code == 409).json()["error"]["code"] == "VERSION_CONFLICT"
    result = detail(client, auth)
    assert result["ticket"]["version"] == before["version"] + 1
    events = [event for event in result["history"] if event["action"] == "ticket.updated"]
    assert len(events) == 1 and events[0]["detail"]["changes"]["subject"]["before"] == before["subject"]


def test_supplemental_information_is_used_by_next_run(client, auth):
    ticket = client.post("/api/tickets", headers=auth(), json={"subject": "客户补充资料", "description": "先记录客户问题，等待核实", "customerName": "测试客户"}).json()["ticket"]
    first = client.post(f"/api/tickets/{ticket['id']}/runs", headers=auth(), json={}).json()["run"]
    assert first["proposal"]["action"] == "abstain"
    response = update(client, auth, ticket["id"], note="客户补充：未使用耳机申请退货退款，已核实订单。", orderId="AURORA-1001")
    assert response.status_code == 200
    assert "客户补充" in response.json()["ticket"]["description"]
    second = client.post(f"/api/tickets/{ticket['id']}/runs", headers=auth(), json={}).json()["run"]
    assert second["approvalId"] and second["proposal"]["action"] == "refund"
    assert len(detail(client, auth, ticket["id"])["runs"]) == 2


def test_pending_approval_blocks_edits_and_manual_close(client, auth, refund_run):
    assert update(client, auth, description="审批中尝试修改退款依据").json()["error"]["code"] == "PENDING_APPROVAL"
    for action in ["resolve", "reopen"]:
        response = transition(client, auth, action)
        assert response.status_code == 409 and response.json()["error"]["code"] == "PENDING_APPROVAL"
    assert detail(client, auth)["ticket"]["status"] == "awaiting_approval"


def test_running_task_blocks_mutations_without_erasing_history(client, auth, app):
    with app.state.db.connect(write=True) as con:
        con.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?)", ("inflight-v2", "aurora", "aurora-ticket-1", "aurora-agent", "inflight-v2-key", "running", dumps({"status": "running"})))
    assert update(client, auth, note="请求运行期间追加资料").json()["error"]["code"] == "RUN_IN_PROGRESS"
    assert transition(client, auth, "resolve").json()["error"]["code"] == "RUN_IN_PROGRESS"
    assert len(detail(client, auth)["history"]) == 1


def test_manual_resolution_and_reopen_require_valid_state_and_version(client, auth):
    original = detail(client, auth)["ticket"]
    closed = transition(client, auth, "resolve")
    assert closed.status_code == 200 and closed.json()["ticket"]["status"] == "resolved"
    assert update(client, auth, note="结案后直接修改应失败").status_code == 409
    stale = transition(client, auth, "reopen", expectedVersion=original["version"])
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"
    reopened = transition(client, auth, "reopen")
    assert reopened.status_code == 200 and reopened.json()["ticket"]["status"] == "open"
    assert transition(client, auth, "reopen").status_code == 409
    assert [item["action"] for item in detail(client, auth)["history"][:2]] == ["ticket.reopened", "ticket.resolved"]


def test_reopening_refunded_ticket_preserves_ledger_and_old_approval(client, auth, refund_run, app):
    approved = decision(client, auth, refund_run["approvalId"])
    assert approved.status_code == 200
    assert transition(client, auth, "reopen").status_code == 200
    assert decision(client, auth, refund_run["approvalId"], key="another-v2-decision").json()["error"]["code"] == "APPROVAL_ALREADY_DECIDED"
    replay = decision(client, auth, refund_run["approvalId"])
    assert replay.json() == approved.json()
    assert detail(client, auth)["ticket"]["status"] == "open", "Idempotent replay must not close a reopened ticket"
    rerun = client.post("/api/tickets/aurora-ticket-1/runs", headers=auth(), json={}).json()["run"]
    assert rerun["approvalId"] is None and rerun["proposal"]["amountCents"] == 0
    with app.state.db.connect() as con:
        assert con.execute("SELECT COUNT(*) FROM refunds").fetchone()[0] == 1
        assert con.execute("SELECT refunded_cents FROM orders WHERE id='AURORA-1001'").fetchone()[0] == 29900


def test_rejected_ticket_can_be_corrected_and_reprocessed(client, auth, refund_run):
    assert decision(client, auth, refund_run["approvalId"], action="reject").status_code == 200
    assert transition(client, auth, "reopen").status_code == 200
    assert update(client, auth, note="已补齐客户原始凭证，重新请求审核").status_code == 200
    next_run = client.post("/api/tickets/aurora-ticket-1/runs", headers=auth(), json={}).json()["run"]
    assert next_run["approvalId"] != refund_run["approvalId"]
    assert decision(client, auth, next_run["approvalId"], key="new-review-after-reject").status_code == 200
    statuses = {item["id"]: item["status"] for item in detail(client, auth)["approvals"]}
    assert statuses[refund_run["approvalId"]] == "rejected" and statuses[next_run["approvalId"]] == "approved"


def test_patch_requires_update_and_tenant_owned_order(client, auth):
    assert update(client, auth).status_code == 422
    assert update(client, auth, subject=None).status_code == 422
    assert update(client, auth, orderId="HARBOR-1001").status_code == 404
    assert update(client, auth, orderId=None).json()["ticket"]["orderId"] is None
    assert client.patch("/api/tickets/harbor-ticket-1", headers=auth(), json={"expectedVersion": 1, "note": "跨租户修改不能发生"}).status_code == 404
    assert client.post("/api/tickets/harbor-ticket-1/transition", headers=auth(), json={"expectedVersion": 1, "action": "resolve", "reason": "跨租户修改不能发生"}).status_code == 404


def test_knowledge_publish_is_reviewer_only_and_retains_history(client, auth, app):
    before = knowledge(client, auth, "shipping")
    payload = {"expectedVersion": before["version"], "title": "物流与配送人工核验指南", "body": before["body"] + "\n\n客户可补充收货时间和物流异常截图，供客服人工核对。", "reason": "增加资料补充流程"}
    assert client.post(f"/api/knowledge/{before['id']}/publish", headers=auth(), json=payload).status_code == 403
    result = client.post(f"/api/knowledge/{before['id']}/publish", headers=auth("reviewer"), json=payload)
    assert result.status_code == 201 and result.json()["document"]["version"] == 2
    history = client.get(f"/api/knowledge/{before['id']}/history", headers=auth()).json()
    assert history["currentVersion"] == 2 and [entry["version"] for entry in history["items"]] == [2, 1]
    assert history["items"][1]["body"] == before["body"]
    assert history["items"][1]["chunks"] == before["chunks"]
    assert history["items"][0]["isCurrent"] and not history["items"][1]["isCurrent"]
    assert client.post(f"/api/knowledge/{before['id']}/publish", headers=auth("reviewer"), json=payload).json()["error"]["code"] == "VERSION_CONFLICT"
    with app.state.db.connect() as con:
        assert con.execute("SELECT COUNT(*) FROM audit WHERE action='knowledge.published'").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError), app.state.db.connect(write=True) as con:
        con.execute("UPDATE document_versions SET body='changed'")


def test_refund_policy_body_cannot_diverge_from_server_rules(client, auth):
    document = knowledge(client, auth)
    assert document["bodyEditable"] is False
    response = publish(client, auth, document, body=document["body"].replace("30 天", "300 天"))
    assert response.status_code == 422 and response.json()["error"]["code"] == "REFUND_POLICY_SERVER_CONTROLLED"
    assert publish(client, auth, document, category="shipping").status_code == 422
    assert knowledge(client, auth)["version"] == 1


def test_policy_publish_invalidates_existing_approval_and_new_run_uses_latest(client, auth, refund_run):
    original = knowledge(client, auth)
    assert publish(client, auth, original).status_code == 201
    response = decision(client, auth, refund_run["approvalId"])
    assert response.status_code == 409 and response.json()["error"]["code"] == "POLICY_VERSION_CHANGED"
    assert decision(client, auth, refund_run["approvalId"], action="reject", key="stale-policy-reject").status_code == 200
    assert transition(client, auth, "reopen").status_code == 200
    new_run = client.post("/api/tickets/aurora-ticket-1/runs", headers=auth(), json={}).json()["run"]
    assert new_run["approvalId"] and all(item["version"] == 2 for item in new_run["evidence"])
    assert client.get(f"/api/runs/{refund_run['id']}", headers=auth()).json()["run"]["evidence"] == refund_run["evidence"]


def test_knowledge_history_and_publish_are_tenant_scoped(client, auth):
    original = knowledge(client, auth)
    payload = {"expectedVersion": 1, "title": "跨租户修改测试", "body": original["body"], "reason": "不应该写入另一租户"}
    assert client.get(f"/api/knowledge/{original['id']}/history", headers=auth("reviewer", "harbor")).status_code == 404
    assert client.post(f"/api/knowledge/{original['id']}/publish", headers=auth("reviewer", "harbor"), json=payload).status_code == 404


def test_ticket_and_audit_filters_paginate_without_cross_tenant_leakage(client, auth):
    for index in range(5):
        response = client.post("/api/tickets", headers=auth(), json={"subject": f"分页样本工单 {index}", "description": "用于检验过滤和稳定分页", "customerName": "分页客户"})
        assert response.status_code == 201
    pages = [client.get("/api/tickets", headers=auth(), params={"q": "分页样本", "status": "open", "limit": 2, "offset": offset}).json() for offset in (0, 2, 4)]
    assert [len(page["items"]) for page in pages] == [2, 2, 1]
    assert all(page["total"] == 5 for page in pages)
    assert len({item["id"] for page in pages for item in page["items"]}) == 5
    assert client.get("/api/tickets", headers=auth("agent", "harbor"), params={"q": "分页样本"}).json()["total"] == 0
    assert client.get("/api/tickets", headers=auth(), params={"q": "%"}).json()["total"] == 0, "Search wildcards must be treated literally"
    assert client.get("/api/tickets", headers=auth(), params={"status": "invalid"}).status_code == 422
    assert client.get("/api/tickets", headers=auth(), params={"limit": 1000}).status_code == 422
    audit = client.get("/api/audit", headers=auth(), params={"status": "created", "limit": 2, "offset": 2}).json()
    assert audit["total"] == 5 and len(audit["items"]) == 2
    assert all(item["action"] == "ticket.created" for item in audit["items"])
    hidden = client.get("/api/audit", headers=auth("agent", "harbor"), params={"q": audit["items"][0]["entityId"]}).json()
    assert hidden["items"] == [] and hidden["total"] == 0


def test_actual_delivery_date_revalidated_at_approval(client, auth, refund_run, app):
    with app.state.db.connect(write=True) as con:
        con.execute("UPDATE orders SET delivered_at=? WHERE id='AURORA-1001'", ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(),))
        assert con.execute("SELECT delivery_days FROM orders WHERE id='AURORA-1001'").fetchone()[0] == 7
    response = decision(client, auth, refund_run["approvalId"])
    assert response.status_code == 409 and response.json()["error"]["code"] == "ORDER_INELIGIBLE"
    assert client.get("/api/stats", headers=auth()).json()["totalRefundCents"] == 0


def test_elapsed_time_changes_delivery_age_without_database_writes(client, auth, monkeypatch):
    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) + timedelta(days=24)
    monkeypatch.setattr("app.db.datetime", Later)
    monkeypatch.setattr("app.main.datetime", Later)
    orders = client.get("/api/orders", headers=auth()).json()["items"]
    assert next(order for order in orders if order["id"] == "AURORA-1001")["deliveryDays"] == 31
    run = client.post("/api/tickets/aurora-ticket-1/runs", headers=auth(), json={}).json()["run"]
    assert run["approvalId"] is None and run["proposal"]["amountCents"] == 0


def test_schema_migration_is_idempotent_and_preserves_legacy_data(tmp_path):
    path = str(tmp_path / "legacy.sqlite3")
    with sqlite3.connect(path) as con:
        con.executescript(SCHEMA)
        con.execute("INSERT INTO tenants VALUES('legacy','历史租户',100000)")
        con.execute("INSERT INTO orders VALUES('ORDER-1','legacy','客户','耳机',29900,0,7,1,'delivered')")
        con.execute("INSERT INTO documents VALUES('doc-1','legacy','历史知识',1,'refund','历史政策正文','2026-10-01T00:00:00+00:00')")
        con.execute("INSERT INTO chunks VALUES('doc-1:v1:1','legacy','doc-1',1,'历史政策正文')")
        con.execute("INSERT INTO tickets VALUES('ticket-1','legacy','original-agent','历史工单','历史问题描述','客户','ORDER-1','open','2026-10-01T00:00:00+00:00','2026-10-01T00:00:00+00:00',NULL)")
        con.execute("INSERT INTO audit(tenant_id,actor_id,actor_name,action,entity_type,entity_id,detail,created_at) VALUES('legacy','agent','客服','ticket.created','ticket','ticket-1','{}','2026-10-01T00:00:00+00:00')")
    database = Database(path)
    database.initialize()
    with database.connect() as con:
        delivered_at = con.execute("SELECT delivered_at FROM orders").fetchone()[0]
    database.initialize()
    with database.connect() as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == 2
        assert con.execute("SELECT COUNT(*) FROM tenants").fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM audit").fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM ticket_events").fetchone()[0] == 1
        assert con.execute("SELECT version FROM tickets").fetchone()[0] == 1
        assert con.execute("SELECT delivered_at FROM orders").fetchone()[0] == delivered_at
        assert con.execute("SELECT body FROM document_versions").fetchone()[0] == "历史政策正文"
    with pytest.raises(sqlite3.IntegrityError), database.connect(write=True) as con:
        con.execute("DELETE FROM ticket_events")


def test_startup_recovers_interrupted_tools_and_records_history_once(client, auth, app):
    headers = auth()
    payload = {"id": "run-interrupted-v2", "ticketId": "aurora-ticket-1", "status": "running", "steps": [{"id": "step-interrupted", "status": "running"}], "toolCalls": [{"id": "tool-interrupted", "name": "search_policy", "status": "running"}]}
    with app.state.db.connect(write=True) as con:
        con.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?)", (payload["id"], "aurora", "aurora-ticket-1", "aurora-agent", "restart-tool-key", "running", dumps(payload)))
    for _ in range(2):
        with TestClient(create_app(app.state.settings)) as restarted:
            run = restarted.get(f"/api/runs/{payload['id']}", headers=headers).json()["run"]
            assert run["status"] == "failed" and run["terminationReason"] == "process_interrupted"
            assert run["toolCalls"][0]["status"] == "failed" and run["toolCalls"][0]["completedAt"]
            events = restarted.get("/api/tickets/aurora-ticket-1", headers=headers).json()["history"]
            assert len([event for event in events if event["action"] == "agent.interrupted"]) == 1
