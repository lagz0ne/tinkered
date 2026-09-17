"""Reads a `scip print --json` document on stdin; prints definitions + per-file reference counts
(mode `refs`) or the distinct matching symbol strings (mode `symbols`) for a symbol regex."""

import collections
import json
import re
import sys

mode, pattern = sys.argv[1], re.compile(sys.argv[2])
data = json.load(sys.stdin)

if mode == "symbols":
    seen = sorted({o["symbol"] for d in data["documents"] for o in d["occurrences"] if pattern.search(o["symbol"])})
    for s in seen:
        print(" ", s)
    print(f"  ({len(seen)} distinct)")
    sys.exit(0)

defs: dict[str, str] = {}
refs: collections.Counter = collections.Counter()
for d in data["documents"]:
    path = d["relative_path"]
    if path.startswith("dist/"):
        continue
    for o in d["occurrences"]:
        m = pattern.search(o["symbol"])
        if not m:
            continue
        short = m.group(0)
        if o.get("symbol_roles", 0) & 1:
            defs[short] = f"{path}:{o['range'][0] + 1}"
        else:
            refs[(short, path)] += 1

print("  definitions")
for k, v in sorted(defs.items()):
    print(f"    {k}  ->  {v}")
print("  references (count  symbol  file)")
for (sym, path), n in sorted(refs.items()):
    print(f"    {n:>5}  {sym}  {path}")
if not defs and not refs:
    print("    (none)")
