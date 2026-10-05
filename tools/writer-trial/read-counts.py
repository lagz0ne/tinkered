"""Count explicit cat/sed/rg file requests in native pi sessions, without changing trials.

Bytes are request counts times saved file sizes, not delivered output bytes.
Partial reads, pipes and files edited during a try make this a workload estimate.
The full JSON keeps per-file rows; --summary saves only top docs and totals.
"""

import argparse
import collections
import fnmatch
import glob
import json
import os
import re
import shlex
import tarfile


def patterns(value):
    match = re.search(r"\{([^{}]+)\}", value)
    if not match:
        return [value]
    return [
        expanded
        for choice in match[1].split(",")
        for expanded in patterns(value[: match.start()] + choice + value[match.end() :])
    ]


def shell_words(command):
    lines, end = [], None
    for line in command.replace("\\\n", "").splitlines():
        if end:
            if line.strip() == end:
                end = None
            continue
        match = re.search(r"<<-?\s*['\"]?(\w+)['\"]?", line)
        if match:
            end = match[1]
            line = line[: match.start()]
        lines.append(line)
    lexer = shlex.shlex(";".join(lines), posix=True, punctuation_chars=";&|<>()")
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        return list(lexer)
    except ValueError:
        return []


def read_paths(command, sizes):
    words = shell_words(command)
    variables = {}
    for match in re.finditer(r"for (\w+) in ([^;]+);", command):
        variables["$" + match[1]] = shlex.split(match[2])
    found = []
    for i, tool in enumerate(words):
        if tool not in ("cat", "sed", "rg"):
            continue
        args = []
        for word in words[i + 1 :]:
            if word in (";", "&&", "||", "|", "&", ")", "("):
                break
            args.append(word)
        if tool == "cat" and args and args[0] in (">", ">>", "<", "<<"):
            continue
        for arg in args:
            for value in variables.get(arg, [arg]):
                value = value.removeprefix("/work/").removeprefix("./")
                if value.startswith(("-", "/", "$")):
                    continue
                for pattern in patterns(value):
                    if pattern in sizes:
                        found.append(pattern)
                    elif any(c in pattern for c in "*?["):
                        found.extend(fnmatch.filter(sizes, pattern))
                    elif tool == "rg":
                        found.extend(p for p in sizes if p.startswith(pattern + "/"))
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sessions", required=True, help="Native pi sessions root")
    parser.add_argument("--trials", required=True, help="Saved trials root (read only)")
    parser.add_argument("--summary", action="store_true", help="Print top docs and totals only")
    args = parser.parse_args()
    native = {}
    for path in sorted(glob.glob(os.path.join(args.sessions, "*deepseek-0[12]*/*.jsonl"))):
        with open(path) as stream:
            native[json.loads(stream.readline())["id"]] = path
    rows = []
    for trial in ("01", "02"):
        root = os.path.join(args.trials, "flight-deepseek-" + trial)
        for saved in sorted(glob.glob(root + "/results/round-*/worker-1-attempt-*")):
            with open(saved + "/session.jsonl") as stream:
                session_id = json.loads(stream.readline())["id"]
            with tarfile.open(saved + "/archive.tar") as archive:
                sizes = {
                    member.name.removeprefix("./"): member.size
                    for member in archive.getmembers()
                    if member.isfile() and not member.name.startswith("./.git/")
                }
            counts = collections.Counter()
            usage = collections.Counter()
            read_calls = 0
            with open(native[session_id]) as stream:
                for line in stream:
                    message = json.loads(line).get("message", {})
                    if message.get("role") == "assistant":
                        for name in ("input", "output", "cacheRead", "cacheWrite", "totalTokens"):
                            usage[name] += message.get("usage", {}).get(name, 0)
                    for block in message.get("content", []):
                        if block.get("type") == "toolCall" and block.get("name") == "work_shell":
                            paths = read_paths(block.get("arguments", {}).get("command", ""), sizes)
                            counts.update(paths)
                            read_calls += bool(paths)
            files = [
                {"path": path, "reads": count, "savedBytes": sizes[path], "requestBytes": count * sizes[path]}
                for path, count in sorted(counts.items())
            ]
            docs = sum(f["requestBytes"] for f in files if f["path"].endswith(".md"))
            rows.append({
                "trial": trial,
                "try": os.path.relpath(saved, root + "/results").replace("worker-1-attempt-", "try-"),
                "session": session_id,
                "readCalls": read_calls,
                "fileReads": sum(counts.values()),
                "uniqueFiles": len(counts),
                "requestBytes": sum(f["requestBytes"] for f in files),
                "docRequestBytes": docs,
                "docTokensEstimate": round(docs / 4),
                "usage": dict(usage),
                "files": files,
            })
    result = {
        "method": "Explicit cat/sed/rg requests; saved archive sizes; full file weight for partial reads; bytes/4 is only a token estimate. Excludes stdin, unresolved paths and other readers (including grep).",
        "tries": rows,
    }
    if args.summary:
        totals = {
            "tries": len(rows),
            "fileReads": sum(r["fileReads"] for r in rows),
            "requestBytes": sum(r["requestBytes"] for r in rows),
            "docRequestBytes": sum(r["docRequestBytes"] for r in rows),
            "reportedTokens": sum(r["usage"]["totalTokens"] for r in rows),
        }
        totals["docTokensEstimate"] = round(totals["docRequestBytes"] / 4)
        totals["docReadTokenSharePercent"] = round(
            totals["docRequestBytes"] / totals["requestBytes"] * 100, 2
        )
        top = {}
        for row in rows:
            for file in row["files"]:
                if not file["path"].endswith(".md"):
                    continue
                item = top.setdefault(file["path"], {
                    "path": file["path"], "tries": 0, "reads": 0, "requestBytes": 0,
                })
                item["tries"] += 1
                item["reads"] += file["reads"]
                item["requestBytes"] += file["requestBytes"]
        for item in top.values():
            item["tokensEstimate"] = round(item["requestBytes"] / 4)
        result = {
            "method": result["method"],
            "rebuildCommand": 'python3 tools/writer-trial/read-counts.py --summary --sessions "$HOME/.pi/agent/sessions" --trials "$HOME/.local/share/tinker-writer-trial" > docs/roadmap/flight-trial/round-lessons-reads.json',
            "totals": totals,
            "topFiles": sorted(top.values(), key=lambda f: -f["requestBytes"])[:6],
        }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
