"""Reproducible synthetic workflow evaluation, with an explicit real-network opt-in.

Default: python evaluate.py --output evidence/eval-demo.json
Real endpoint configured by env (can incur cost):
  python evaluate.py --provider configured --allow-model-network --output evidence/eval-model.json

Every invocation uses an isolated temporary SQLite database. No approval is accepted,
no payment is sent, and the running development server/database is untouched.
"""
import argparse
from dataclasses import replace
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import tempfile
import time

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def evaluate(cases, settings):
    results = []
    with TestClient(create_app(settings)) as client:
        session = client.post("/api/auth/login", json={"email": "agent@aurora.demo", "password": "DemoPass!2026"})
        session.raise_for_status()
        headers = {"Authorization": "Bearer " + session.json()["token"]}
        for case in cases:
            ticket = client.post("/api/tickets", headers=headers, json={"subject": case["subject"], "description": case["description"], "customerName": "合成评估客户", "orderId": case["orderId"]})
            ticket.raise_for_status()
            started = time.monotonic()
            response = client.post(f"/api/tickets/{ticket.json()['ticket']['id']}/runs", headers=headers, json={"idempotencyKey": "eval-" + case["id"]})
            elapsed_ms = round((time.monotonic() - started) * 1000, 2)
            response.raise_for_status()
            run = response.json()["run"]
            proposal = run.get("proposal") or {}
            evidence_ids = {entry["chunkId"] for entry in run["evidence"]}
            declared = set(proposal.get("citations", []))
            in_answer = set(re.findall(r"\[([^\[\]\n]{1,200})\]", run["answer"]))
            evidence_tenant = all(entry["documentId"].startswith("aurora-") for entry in run["evidence"])
            citations_valid = declared.issubset(evidence_ids) and in_answer.issubset(evidence_ids) and evidence_tenant
            if proposal.get("action") not in (None, "abstain"):
                citations_valid = citations_valid and bool(declared) and declared == in_answer
            checks = {
                "runCompleted": run["status"] == "completed",
                "expectedAction": proposal.get("action") == case["expectedAction"],
                "expectedApproval": bool(run["approvalId"]) == case["expectedApproval"],
                "validCitations": bool(citations_valid),
                "integerAmount": type(proposal.get("amountCents")) is int,
                "noAutomaticRefund": client.get("/api/stats", headers=headers).json()["totalRefundCents"] == 0,
            }
            results.append({
                "id": case["id"], "name": case["name"], "passed": all(checks.values()), "checks": checks,
                "expectedAction": case["expectedAction"], "actualAction": proposal.get("action"),
                "expectedApproval": case["expectedApproval"], "actualApproval": bool(run["approvalId"]),
                "runStatus": run["status"], "runId": run["id"], "localElapsedMs": elapsed_ms,
                "answer": run["answer"], "proposal": run["proposal"], "evidenceIds": sorted(evidence_ids),
                "steps": [{"name": step["name"], "status": step["status"]} for step in run["steps"]],
                "terminationReason": run.get("terminationReason"),
                "metrics": run.get("metrics"),
                "toolCalls": [{"id": entry["id"], "name": entry["name"], "source": entry["source"], "status": entry["status"]} for entry in run.get("toolCalls", [])],
                "error": run["error"],
            })
        totals = client.get("/api/stats", headers=headers).json()
    return {
        "schemaVersion": 2, "executedAt": datetime.now(timezone.utc).isoformat(),
        "evaluationType": "synthetic-engineering-regression",
        "provider": settings.provider, "model": settings.model_name if settings.provider != "demo" else None,
        "disclaimer": "合成场景上的工程回归。demo 为确定性规则，不代表真实模型效果；本报告不是生产安全审计、负载测试或模型质量基准。",
        "networkModelCallsAllowed": settings.provider != "demo",
        "databaseIsolation": "temporary SQLite database removed after evaluation",
        "realPayments": False, "approvalsExecuted": 0, "totalRefundCents": totals["totalRefundCents"],
        "summary": {"total": len(results), "passed": sum(item["passed"] for item in results), "failed": sum(not item["passed"] for item in results)},
        "runtime": {"python": sys.version.split()[0], **{name: importlib.metadata.version(name) for name in ("fastapi", "langgraph", "rank-bm25", "pydantic")}},
        "cases": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", choices=["demo", "configured"], default="demo", help="demo always uses offline rules; configured reads CASEDESK_* environment")
    parser.add_argument("--allow-model-network", action="store_true", help="Explicitly authorize potentially paid calls to the configured model endpoint")
    parser.add_argument("--cases", type=Path, default=Path(__file__).parent / "evals" / "cases.json")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "evidence" / "eval-demo.json")
    args = parser.parse_args()
    settings = Settings() if args.provider == "demo" else Settings.from_env()
    if settings.provider != "demo" and not args.allow_model_network:
        parser.error("真实模型可能产生费用。需要显式添加 --allow-model-network；默认 demo 不调用模型。")
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or not cases or len(cases) > 100:
        parser.error("评估集必须包含 1–100 条固定场景")
    if len({case["id"] for case in cases}) != len(cases):
        parser.error("评估场景 id 必须唯一")
    with tempfile.TemporaryDirectory(prefix="casedesk-evaluation-") as folder:
        report = evaluate(cases, replace(settings, database_path=str(Path(folder) / "eval.sqlite3"), demo_seed=True))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.output.resolve()), "provider": report["provider"], **report["summary"], "totalRefundCents": report["totalRefundCents"]}, ensure_ascii=False))
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
