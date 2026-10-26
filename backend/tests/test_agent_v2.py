"""Offline tool-protocol and authorization tests. No paid model calls."""
from dataclasses import replace
import json

import httpx
import pytest


def tool(call_id, name, arguments):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments if isinstance(arguments, str) else json.dumps(arguments)}}


def refund_proposal():
    citations = ["aurora-refund:v1:1", "aurora-refund:v1:2"]
    return {"answer": "建议申请退款，需独立人工审批。 " + " ".join(f"[{value}]" for value in citations), "proposal": {"action": "refund", "amountCents": 29900, "reason": "符合退款政策，尚未执行。", "citations": citations}}


def model_stub(app, monkeypatch, messages):
    observed = []
    settings = replace(app.state.settings, provider="openai-compatible", model_name="offline-protocol-test", model_key="never-send-secret", model_url="https://offline.example/v1")
    app.state.workflow.settings = settings
    original_client = httpx.Client

    def handler(request):
        observed.append(json.loads(request.content))
        index = len(observed) - 1
        item = messages(index, observed[-1]) if callable(messages) else messages[index]
        if isinstance(item, Exception):
            raise item
        if isinstance(item, httpx.Response):
            return item
        return httpx.Response(200, json={"choices": [{"message": item}], "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}})

    monkeypatch.setattr("app.agent.httpx.Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    return observed


def run_ticket(client, auth):
    response = client.post("/api/tickets/aurora-ticket-1/runs", headers=auth(), json={})
    assert response.status_code == 200, response.text
    return response.json()["run"]


def test_demo_trace_uses_same_validated_tool_boundary(client, auth):
    run = run_ticket(client, auth)
    assert [entry["name"] for entry in run["toolCalls"]] == ["search_policies", "lookup_order", "submit_proposal"]
    assert [entry["source"] for entry in run["toolCalls"]] == ["bootstrap", "bootstrap", "demo"]
    assert all(entry["status"] == "completed" and entry["completedAt"] for entry in run["toolCalls"])
    assert run["metrics"]["providerCalls"] == 0 and run["metrics"]["toolCalls"] == 3
    assert run["metrics"]["tokenUsage"] is None and run["metrics"]["usageReportedCalls"] == 0
    assert run["terminationReason"] == "proposal_submitted"


def test_model_can_choose_order_and_refine_search_before_submitting(client, auth, app, monkeypatch):
    observed = model_stub(app, monkeypatch, [
        {"tool_calls": [tool("read_order", "lookup_order", {"orderId": "AURORA-1001"})]},
        {"tool_calls": [tool("refine_policy", "search_policies", {"query": "退货 退款 预算", "category": "refund", "limit": 4})]},
        {"tool_calls": [tool("submit", "submit_proposal", refund_proposal())]},
    ])
    run = run_ticket(client, auth)
    assert run["status"] == "completed" and run["approvalId"]
    assert run["metrics"]["providerCalls"] == 3 and run["metrics"]["toolCalls"] == 5
    assert run["metrics"]["tokenUsage"] == {"prompt_tokens": 300, "completion_tokens": 60, "total_tokens": 360}
    assert run["metrics"]["usageReportedCalls"] == 3
    definitions = observed[0]["tools"]
    assert {entry["function"]["name"] for entry in definitions} == {"search_policies", "lookup_order", "submit_proposal"}
    for entry in definitions:
        assert "tenantId" not in entry["function"]["parameters"]["properties"]
    assistant = observed[1]["messages"][-2]
    result = observed[1]["messages"][-1]
    assert assistant["role"] == "assistant" and assistant["tool_calls"][0]["id"] == "read_order"
    assert result["role"] == "tool" and result["tool_call_id"] == "read_order"
    assert json.loads(result["content"])["order"]["id"] == "AURORA-1001"
    assert json.loads(result["content"])["maxRefundCents"] == 29900
    assert json.loads(result["content"])["untrustedData"] is True
    assert "never-send-secret" not in json.dumps(run)
    assert client.get("/api/stats", headers=auth()).json()["totalRefundCents"] == 0


@pytest.mark.parametrize("name,args,reason", [
    ("execute_refund", {"amountCents": 1}, "unknown_tool"),
    ("lookup_order", {"orderId": "HARBOR-1001"}, "order_scope_denied"),
    ("lookup_order", {"orderId": "AURORA-1002"}, "order_scope_denied"),
    ("search_policies", {"query": "退款", "tenantId": "harbor"}, "invalid_tool_arguments"),
    ("search_policies", {"query": "退款", "limit": True}, "invalid_tool_arguments"),
    ("search_policies", "{bad json", "invalid_tool_arguments"),
    ("search_policies", '{"query":"退款","query":"其他"}', "invalid_tool_arguments"),
])
def test_tool_allowlist_and_scope_fail_closed(client, auth, app, monkeypatch, name, args, reason):
    model_stub(app, monkeypatch, [{"tool_calls": [tool("unsafe", name, args)]}])
    run = run_ticket(client, auth)
    assert run["status"] == "completed" and run["proposal"]["action"] == "abstain"
    assert run["approvalId"] is None and run["terminationReason"] == reason
    assert run["toolCalls"][-1]["status"] == "rejected"
    assert "order" not in run["toolCalls"][-1]["output"]
    assert client.get("/api/stats", headers=auth()).json()["totalRefundCents"] == 0


def test_reused_call_id_rejected_before_second_read(client, auth, app, monkeypatch):
    call = tool("same_id", "lookup_order", {"orderId": "AURORA-1001"})
    model_stub(app, monkeypatch, [{"tool_calls": [call]}, {"tool_calls": [call]}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "duplicate_tool_call_id"
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]
    assert sum(entry["id"] == "same_id" for entry in run["toolCalls"]) == 1


def test_duplicate_ids_in_batch_have_no_partial_execution(client, auth, app, monkeypatch):
    calls = [tool("dup", "lookup_order", {"orderId": "AURORA-1001"}), tool("dup", "search_policies", {"query": "退款"})]
    model_stub(app, monkeypatch, [{"tool_calls": calls}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "duplicate_tool_call_id" and run["metrics"]["toolCalls"] == 2


def test_submit_must_be_only_call_in_batch(client, auth, app, monkeypatch):
    model_stub(app, monkeypatch, [{"tool_calls": [tool("read", "lookup_order", {"orderId": "AURORA-1001"}), tool("submit", "submit_proposal", refund_proposal())]}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "ambiguous_submission" and not run["approvalId"]
    assert run["metrics"]["toolCalls"] == 2


def test_round_budget_abstains_instead_of_inventing_a_proposal(client, auth, app, monkeypatch):
    observed = model_stub(app, monkeypatch, lambda index, _: {"tool_calls": [tool(f"read_{index}", "lookup_order", {"orderId": "AURORA-1001"})]})
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "round_budget_exceeded"
    assert len(observed) == 6 and run["metrics"]["toolCalls"] == 8
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]


def test_tool_budget_rejects_whole_batch(client, auth, app, monkeypatch):
    calls = [tool(f"lookup_{index}", "lookup_order", {"orderId": "AURORA-1001"}) for index in range(9)]
    model_stub(app, monkeypatch, [{"tool_calls": calls}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "tool_budget_exceeded" and run["metrics"]["toolCalls"] == 2
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]


def test_exhausted_tool_budget_does_not_make_an_extra_model_call(client, auth, app, monkeypatch):
    calls = [tool(f"lookup_{index}", "lookup_order", {"orderId": "AURORA-1001"}) for index in range(8)]
    observed = model_stub(app, monkeypatch, [{"tool_calls": calls}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "tool_budget_exceeded" and run["metrics"]["toolCalls"] == 10
    assert len(observed) == run["metrics"]["providerCalls"] == 1
    assert not run["approvalId"]


@pytest.mark.parametrize("mutation", ["amount", "citation", "float", "reason_citation"])
def test_tool_proposal_schema_and_policy_guard(client, auth, app, monkeypatch, mutation):
    proposal = refund_proposal()
    if mutation == "amount":
        proposal["proposal"]["amountCents"] = 29901
    elif mutation == "float":
        proposal["proposal"]["amountCents"] = 1.5
    elif mutation == "reason_citation":
        proposal["proposal"]["reason"] = "另一来源允许退款 [harbor-refund:v1:1]"
    else:
        proposal["proposal"]["citations"] = ["harbor-refund:v1:1"]
        proposal["answer"] = "请退款 [harbor-refund:v1:1]"
    model_stub(app, monkeypatch, [{"tool_calls": [tool("submit", "submit_proposal", proposal)]}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] in ("proposal_rejected", "invalid_tool_arguments")
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]


def test_model_timeout_persists_failed_trace_without_provider_details(client, auth, app, monkeypatch):
    model_stub(app, monkeypatch, [httpx.ReadTimeout("secret upstream diagnostic")])
    run = run_ticket(client, auth)
    assert run["status"] == "failed" and run["terminationReason"] == "timeout"
    assert run["metrics"]["providerCalls"] == 1 and run["steps"][-1]["status"] == "failed"
    assert not run["approvalId"] and "secret upstream" not in json.dumps(run)


def test_model_can_abstain_without_fabricating_evidence(client, auth, app, monkeypatch):
    proposal = {"answer": "现有证据不足，请转人工核实。", "proposal": {"action": "abstain", "amountCents": 0, "reason": "证据不足", "citations": []}}
    model_stub(app, monkeypatch, [{"tool_calls": [tool("submit", "submit_proposal", proposal)]}])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "proposal_submitted" and run["proposal"]["action"] == "abstain"
    assert not run["approvalId"]


@pytest.mark.parametrize("message,reason", [
    ({"tool_calls": {}}, "invalid_tool_call"),
    ({"tool_calls": [{"type": "function", "id": "read", "function": {"name": "lookup_order", "arguments": {"orderId": "AURORA-1001"}}}]}, "invalid_tool_call"),
    ({"tool_calls": [tool("not a valid id", "lookup_order", {"orderId": "AURORA-1001"})]}, "invalid_tool_call_id"),
    ({"content": None}, "invalid_provider_response"),
    ({"refusal": "Provider refused this request"}, "invalid_provider_response"),
])
def test_malformed_provider_protocol_has_explainable_terminal_state(client, auth, app, monkeypatch, message, reason):
    model_stub(app, monkeypatch, [message])
    run = run_ticket(client, auth)
    assert run["status"] == "completed" and run["terminationReason"] == reason
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]


def test_real_loop_can_recover_from_empty_bootstrap_retrieval(client, auth, app, monkeypatch):
    proposal = {"answer": "只能提供现有国内配送规则，关税问题请转人工核实。 [aurora-shipping:v1:1]", "proposal": {"action": "reply", "amountCents": 0, "reason": "补检索后提供有限答复", "citations": ["aurora-shipping:v1:1"]}}
    observed = model_stub(app, monkeypatch, [
        {"tool_calls": [tool("refine", "search_policies", {"query": "物流 配送 shipping", "category": "shipping"})]},
        {"tool_calls": [tool("submit", "submit_proposal", proposal)]},
    ])
    run = client.post("/api/tickets/aurora-ticket-4/runs", headers=auth(), json={}).json()["run"]
    assert json.loads(observed[0]["messages"][1]["content"])["evidence"] == []
    assert run["status"] == "completed" and run["proposal"]["action"] == "reply"
    assert run["metrics"]["providerCalls"] == 2 and run["metrics"]["toolCalls"] == 2
    assert run["evidence"][0]["documentId"] == "aurora-shipping"


def test_policy_changed_during_model_call_invalidates_proposal(client, auth, app, monkeypatch):
    def respond(_, __):
        with app.state.db.connect(write=True) as con:
            con.execute("UPDATE documents SET version=2 WHERE id='aurora-refund'")
        return {"tool_calls": [tool("submit", "submit_proposal", refund_proposal())]}
    model_stub(app, monkeypatch, respond)
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "proposal_rejected" and not run["approvalId"]
    assert run["proposal"]["action"] == "abstain"


def test_model_can_refresh_updated_policy_without_stale_active_evidence(client, auth, app, monkeypatch):
    def respond(index, _):
        if index == 0:
            with app.state.db.connect(write=True) as con:
                rows = con.execute("SELECT * FROM chunks WHERE document_id='aurora-refund'").fetchall()
                con.execute("UPDATE documents SET version=2 WHERE id='aurora-refund'")
                for row in rows:
                    con.execute("INSERT INTO chunks VALUES(?,?,?,?,?)", (row["id"].replace(":v1:", ":v2:"), "aurora", "aurora-refund", 2, row["text"]))
            return {"tool_calls": [tool("refresh", "search_policies", {"query": "退款 退货 预算", "category": "refund"})]}
        proposal = refund_proposal()
        proposal["answer"] = proposal["answer"].replace(":v1:", ":v2:")
        proposal["proposal"]["citations"] = [value.replace(":v1:", ":v2:") for value in proposal["proposal"]["citations"]]
        return {"tool_calls": [tool("submit", "submit_proposal", proposal)]}
    model_stub(app, monkeypatch, respond)
    run = run_ticket(client, auth)
    assert run["status"] == "completed" and run["approvalId"]
    assert all(entry["version"] == 2 for entry in run["evidence"])
    assert all(entry["version"] == 1 for entry in run["toolCalls"][0]["output"]["evidence"])


def test_demo_reads_current_published_policy_instead_of_canned_terms(client, auth, app):
    with app.state.db.connect(write=True) as con:
        body = "物流 shipping 配送 delivery：配送时效调整为 8–10 个工作日，具体日期请向人工客服核实。"
        con.execute("UPDATE documents SET body=?,version=2 WHERE id='aurora-shipping'", (body,))
        con.execute("INSERT INTO chunks VALUES(?,?,?,?,?)", ("aurora-shipping:v2:1", "aurora", "aurora-shipping", 2, body))
    run = client.post("/api/tickets/aurora-ticket-2/runs", headers=auth(), json={}).json()["run"]
    assert run["status"] == "completed" and run["proposal"]["action"] == "reply"
    assert "8–10" in run["answer"] and "3–5" not in run["answer"]
    assert run["proposal"]["citations"] == ["aurora-shipping:v2:1"]


@pytest.mark.parametrize("payload", [
    {"choices": []},
    {"choices": [{"message": {"content": json.dumps(refund_proposal())}, "finish_reason": "length"}]},
    {"choices": [{"message": {"content": json.dumps(refund_proposal())}}, {"message": {"content": "another choice"}}]},
])
def test_incomplete_or_ambiguous_provider_envelope_is_rejected(client, auth, app, monkeypatch, payload):
    model_stub(app, monkeypatch, [httpx.Response(200, json=payload)])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "invalid_provider_response"
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]


def test_oversized_provider_response_is_bounded(client, auth, app, monkeypatch):
    model_stub(app, monkeypatch, [httpx.Response(200, content=b"x" * 128001)])
    run = run_ticket(client, auth)
    assert run["terminationReason"] == "response_size_exceeded" and run["status"] == "completed"
    assert run["proposal"]["action"] == "abstain" and not run["approvalId"]


def test_http_failure_is_not_retried_or_disguised_as_demo_success(client, auth, app, monkeypatch):
    observed = model_stub(app, monkeypatch, [httpx.Response(429, json={"error": "secret provider diagnostic"})])
    run = run_ticket(client, auth)
    assert len(observed) == 1 and run["status"] == "failed" and not run["approvalId"]
    assert run["error"]["type"] == "HTTPStatusError" and run["terminationReason"] == "provider_or_workflow_failed"
    assert "secret provider" not in json.dumps(run)
