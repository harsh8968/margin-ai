"""Grounding evaluation (PS6 doc section 19.2): numbers for the pitch.

Runs 20 questions against a fresh copy of the seed notebook through the real API and
reports three numbers:
  * grounding-label accuracy  - did the AI say grounded / partial / not_in_notes correctly?
  * citation accuracy         - do the (server-verified) citations point at the right pages?
  * refusal correctness       - on off-topic questions, did it refuse with no made-up answer?

Usage (backend running with a real GEMINI_API_KEY):
    backend/.venv/Scripts/python demo/eval_grounding.py
    backend/.venv/Scripts/python demo/eval_grounding.py --base-url http://localhost:8000 --delay 4

Only uses the standard library. Results are also written to demo/eval_results.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{base}/api{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            envelope = json.load(resp)
    except urllib.error.HTTPError as exc:
        envelope = json.load(exc)
    if not envelope.get("success"):
        raise RuntimeError(envelope.get("error") or "request failed")
    return envelope["data"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between questions (free-tier rate limits)")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    health = call(base, "GET", "/health")
    if health["llm"] != "gemini":
        print(f"Warning: the backend is using the '{health['llm']}' adapter, not Gemini. Numbers won't mean much.")
    spec = json.loads((HERE / "eval_questions.json").read_text(encoding="utf-8"))
    project = call(base, "POST", "/demo/seed")
    pages = call(base, "GET", f"/projects/{project['id']}/pages")
    print(f"Seeded '{project['name']}' ({len(pages)} pages). Model: {health.get('model')}. Asking {len(spec['questions'])} questions...\n")

    rows = []
    for i, q in enumerate(spec["questions"], start=1):
        try:
            out = call(base, "POST", "/ai/ask", {
                "project_id": project["id"], "page_id": pages[0]["id"], "scope": "project",
                "question": q["question"], "mode": "answer", "history": [],
            })
        except RuntimeError as exc:
            print(f"{i:>2}. ERROR {exc}")
            rows.append({**q, "got": "error", "cited": [], "label_ok": False, "cite_ok": None, "refusal_ok": None})
            time.sleep(args.delay)
            continue
        cited = sorted({c["page"] for c in out["citations"]})
        label_ok = out["grounding"] == q["expected"]
        cite_ok = None
        if cited:
            cite_ok = all(p in q["pages"] for p in cited)
        refusal_ok = None
        if q["bucket"] == "not_in_notes":
            refusal_ok = out["grounding"] == "not_in_notes" and not out["answer_markdown"].strip()
        rows.append({**q, "got": out["grounding"], "cited": cited, "label_ok": label_ok, "cite_ok": cite_ok,
                     "refusal_ok": refusal_ok, "dropped": out.get("dropped_citations", 0)})
        mark = "OK " if label_ok else "MISS"
        print(f"{i:>2}. [{mark}] {q['bucket']:<13} expected={q['expected']:<13} got={out['grounding']:<13} cited={cited}")
        time.sleep(args.delay)

    label_acc = sum(r["label_ok"] for r in rows)
    cite_rows = [r for r in rows if r["cite_ok"] is not None]
    cite_acc = sum(r["cite_ok"] for r in cite_rows)
    refusals = [r for r in rows if r["refusal_ok"] is not None]
    refusal_acc = sum(r["refusal_ok"] for r in refusals)
    dropped = sum(r.get("dropped", 0) for r in rows)

    summary = [
        f"Grounding-label accuracy: {label_acc}/{len(rows)}",
        f"Citation accuracy (answers with citations): {cite_acc}/{len(cite_rows)}",
        f"Refusal correctness (not-in-notes bucket): {refusal_acc}/{len(refusals)}",
        f"Citations dropped by the server-side quote check: {dropped}",
    ]
    print("\n" + "\n".join(summary))

    lines = [f"# Grounding eval results\n", f"Model: `{health.get('model')}` · {time.strftime('%Y-%m-%d %H:%M')}\n"]
    lines += [f"- **{s}**" for s in summary]
    lines += ["", "| # | Bucket | Question | Expected | Got | Cited pages | OK |", "|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, start=1):
        ok = "✅" if r["label_ok"] and r["cite_ok"] is not False else "❌"
        lines.append(f"| {i} | {r['bucket']} | {r['question']} | {r['expected']} | {r['got']} | {r['cited']} | {ok} |")
    (HERE / "eval_results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nWrote {HERE / 'eval_results.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
