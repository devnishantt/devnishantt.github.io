#!/usr/bin/env python3
"""Write site/data/status.json: recent main-branch CI history for each featured repository.

Runs in the Pages deploy workflow (and locally) with GITHUB_TOKEN set. Standard library only.
If a lookup fails, the repository keeps whatever the previous status.json said, so a flaky API
call never blanks the status page.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

USER = os.environ.get("PROFILE_USER", "devnishantt")
OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "status.json"
HISTORY = 30
REPOS = ["ledgerline", "aftermark", "Pactrail", "tracebench", "bank-management-system", "Hospital-Management"]


def get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Authorization": f"bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "portfolio-status"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def seconds(run: dict) -> int:
    start = datetime.fromisoformat((run.get("run_started_at") or run["created_at"]).replace("Z", "+00:00"))
    end = datetime.fromisoformat(run["updated_at"].replace("Z", "+00:00"))
    return max(0, int((end - start).total_seconds()))


def repo_status(repo: str, token: str) -> dict:
    meta = get(f"https://api.github.com/repos/{USER}/{repo}", token)
    runs = get(f"https://api.github.com/repos/{USER}/{repo}/actions/runs"
               f"?branch=main&status=completed&exclude_pull_requests=true&per_page={HISTORY}", token)["workflow_runs"]
    history = [{"conclusion": r["conclusion"], "sha": r["head_sha"][:7], "at": r["updated_at"],
                "seconds": seconds(r), "url": r["html_url"], "workflow": r["name"]} for r in runs]
    passed = sum(1 for h in history if h["conclusion"] == "success")
    return {
        "repo": repo, "url": meta["html_url"], "description": meta.get("description") or "",
        "language": meta.get("language"), "stars": meta.get("stargazers_count", 0),
        "pushed_at": meta.get("pushed_at"),
        "latest": history[0] if history else None,
        "history": history[::-1],  # oldest first, for left-to-right bars
        "pass_rate": round(passed / len(history), 4) if history else None,
    }


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        print("GITHUB_TOKEN is not set", file=sys.stderr)
        return 1
    previous = {}
    if OUT.exists():
        previous = {r["repo"]: r for r in json.loads(OUT.read_text(encoding="utf-8")).get("repos", [])}
    repos = []
    for repo in REPOS:
        try:
            repos.append(repo_status(repo, token))
        except Exception as exc:  # keep the last known state rather than publishing a gap
            print(f"warning: {repo}: {exc}", file=sys.stderr)
            if repo in previous:
                repos.append(previous[repo])
    green = sum(1 for r in repos if r.get("latest") and r["latest"]["conclusion"] == "success")
    data = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "user": USER,
            "green": green, "total": sum(1 for r in repos if r.get("latest")), "repos": repos}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"{green}/{data['total']} pipelines green, written to {OUT.relative_to(OUT.parent.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
