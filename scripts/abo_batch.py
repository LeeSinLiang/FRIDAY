#!/usr/bin/env python3
"""Import the products an abo_select.py plan lists, category by category, until each quota is met.

Usage, from backend/:
  uv run --with pillow python ../scripts/abo_batch.py ../.scratch/abo/plan.json [--meta ...] [--work ...] [--dry-run]

Rows are tried in plan order. A refused product (over budget once simplified, not floor-standing, already
listed) is skipped and the next spare takes its place, so one bad file never stops the batch. Every price is
0 with provenance "placeholder": ABO has no price, and 0 means unknown, never free.

Exit codes: 0 every quota met, 1 at least one quota fell short, 2 bad arguments or plan missing.
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import abo_import  # noqa: E402


def import_one(row: dict, args: argparse.Namespace) -> bool:
    argv = [row["asin"], "--category", row["category"], "--price-cents", "0", "--price-provenance", "placeholder",
            "--meta", str(args.meta), "--work", str(args.work)] + (["--dry-run"] if args.dry_run else [])
    return abo_import.main(argv) == 0


def run(plan: dict, args: argparse.Namespace) -> dict[str, tuple[int, int]]:
    """Imported and wanted counts per plan rule (a catalogue category, sometimes split in two)."""
    outcome = {}
    for rule, quota in plan["quotas"].items():
        imported = 0
        for row in (r for r in plan["items"] if r.get("rule", r["category"]) == rule):
            if imported >= quota:
                break
            started = time.monotonic()
            imported += import_one(row, args)
            print(f"  [{rule} {imported}/{quota}] {row['asin']} {time.monotonic() - started:.1f}s", flush=True)
        outcome[rule] = (imported, quota)
    return outcome


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Import an ABO plan.")
    parser.add_argument("plan", type=Path)
    parser.add_argument("--meta", type=Path, default=abo_import.REPO / ".scratch" / "abo" / "meta")
    parser.add_argument("--work", type=Path, default=abo_import.REPO / ".scratch" / "abo")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        with open(args.plan, encoding="utf-8") as f:
            plan = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as problem:
        print(f"cannot read the plan: {problem}", file=sys.stderr)
        return 2
    outcome = run(plan, args)
    print("imported / wanted:", {category: f"{done}/{quota}" for category, (done, quota) in outcome.items()},
          "| total", sum(done for done, _ in outcome.values()))
    return 0 if all(done >= quota for done, quota in outcome.values()) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
