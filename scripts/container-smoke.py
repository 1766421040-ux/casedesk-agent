"""Verify the deployed nginx proxy, API workflow and persisted volume in CI."""
import argparse
import json
from pathlib import Path
import time
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:8080")
parser.add_argument("--state", default="/tmp/casedesk-container-smoke.json")
parser.add_argument("--verify", action="store_true")
args = parser.parse_args()
base = args.base_url.rstrip("/")


def request(path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


for attempt in range(30):
    try:
        health = request("/api/health")
        break
    except (OSError, ValueError):
        if attempt == 29:
            raise
        time.sleep(1)
assert health["status"] == "ok" and health["realPayments"] is False
assert health["demoMode"] is True, "Smoke test requires an isolated demo environment"
with urllib.request.urlopen(base, timeout=10) as response:
    assert b'<div id="root"></div>' in response.read(), "nginx did not serve the frontend"
login = request("/api/auth/login", {"email": "agent@harbor.demo", "password": "DemoPass!2026"})
token = login["token"]
try:
    if args.verify:
        saved = json.loads(Path(args.state).read_text())
        result = request(f"/api/tickets/{saved['ticketId']}", token=token)
        assert result["ticket"]["subject"] == saved["subject"]
        assert result["runs"][0]["id"] == saved["runId"]
        assert result["runs"][0]["status"] == "completed"
        assert len(result["history"]) >= 3
        print("PASS: frontend, proxy, saved ticket, run and history survived backend restart")
    else:
        subject = "Container persistence " + uuid.uuid4().hex[:8]
        ticket = request("/api/tickets", {"subject": subject, "description": "请查询物流配送状态并提供当前政策说明。", "customerName": "CI demo", "orderId": "HARBOR-1004"}, token)["ticket"]
        run = request(f"/api/tickets/{ticket['id']}/runs", {"idempotencyKey": uuid.uuid4().hex}, token)["run"]
        assert run["status"] == "completed" and run["proposal"]["action"] == "reply"
        assert run["toolCalls"] and run["evidence"]
        Path(args.state).write_text(json.dumps({"ticketId": ticket["id"], "runId": run["id"], "subject": subject}))
        print("PASS: nginx frontend, authenticated API, Agent tools and persisted records")
finally:
    request("/api/auth/logout", {}, token)
