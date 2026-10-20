#!/usr/bin/env python3
"""One public API smoke pass; no tuning, GPU allocation, or performance ranking."""
import argparse
import concurrent.futures
import json
import time
import urllib.request
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--br-url", default="http://127.0.0.1:1919/v1")
parser.add_argument("--strata-url", default="http://127.0.0.1:18080/v1")
parser.add_argument("--engine", choices=("br", "strata", "both"), default="both")
parser.add_argument("--long-prompts", action="store_true", help="Send two concurrent prompts requiring >=8192 reported input tokens")
args = parser.parse_args()
engines = [("BR", args.br_url, "flash-next-paper2"),
           ("Strata", args.strata_url, "qwen3.8-flash-next-iq2_xs")]
engines = [engine for engine in engines if args.engine == "both" or engine[0].lower() == args.engine]

def request(base, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base.rstrip("/") + path, data=data,
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=120)

def probe(engine, base, model, kind):
    started = time.monotonic()
    report = {"engine": engine, "request": kind}
    try:
        payload = {"model": model, "stream": True, "stream_options": {"include_usage": True},
                   "reasoning_effort": "medium", "max_tokens": 512 if kind == "tool" else 128,
                   "messages": [{"role": "user", "content": "Reply with the word ready."}]}
        if kind.startswith("long-"):
            payload["messages"][0]["content"] = (
                "amber birch cedar drift elm frost grove hazel ivory juniper.\n" * 1024
                + f"\nIndependent request {kind}: acknowledge this neutral word list briefly.")
        if kind == "tool":
            payload["messages"][0]["content"] = "Call report_result with value 7; do not explain."
            payload["tool_choice"] = "auto"
            payload["tools"] = [{"type": "function", "function": {"name": "report_result",
                "description": "Report the requested numeric result.",
                "parameters": {"type": "object", "properties": {"value": {"type": "integer"}},
                               "required": ["value"], "additionalProperties": False}}}]
        text, reasoning, calls, usage, finish, done = "", "", {}, None, None, False
        with request(base, "/chat/completions", payload) as response:
            for line in response:
                line = line.decode().strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    done = True
                    break
                chunk = json.loads(data)
                if chunk.get("error"):
                    raise ValueError(str(chunk["error"]))
                usage = chunk.get("usage") or usage
                for choice in chunk.get("choices", []):
                    finish = choice.get("finish_reason") or finish
                    delta = choice.get("delta", {})
                    text += delta.get("content") or ""
                    reasoning += delta.get("reasoning_content") or delta.get("reasoning") or ""
                    for part in delta.get("tool_calls", []):
                        call = calls.setdefault(part["index"], {"id": "", "name": "", "arguments": ""})
                        call["id"] = part.get("id") or call["id"]
                        function = part.get("function", {})
                        call["name"] += function.get("name") or ""
                        call["arguments"] += function.get("arguments") or ""
        assert done and finish, "Stream must terminate with a finish reason and [DONE]"
        assert usage is not None, "Requested stream usage was not returned"
        for field in ("prompt_tokens", "completion_tokens"):
            assert type(usage.get(field)) is int and usage[field] >= 0, f"Invalid {field}"
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
        if cached is not None:
            assert type(cached) is int and 0 <= cached <= usage["prompt_tokens"], "Invalid reported cached_tokens"
        report.update(usage=usage, finish_reason=finish, text_chars=len(text), reasoning_chars=len(reasoning))
        if kind == "tool":
            if finish == "length":
                report.update(status="inconclusive", detail="Tool response hit its output limit; API support is not determined.")
            else:
                assert calls, "Model did not emit the requested tool call"
                for call in calls.values():
                    assert call["id"] and call["name"] == "report_result", "Tool identity is not usable"
                    assert json.loads(call["arguments"]) == {"value": 7}, "Tool arguments are not usable"
                report.update(status="passed", tool_calls=len(calls))
        elif kind == "normal":
            assert text or reasoning, "Normal response contained neither content nor reasoning"
            report["status"] = "passed"
        else:
            assert usage["prompt_tokens"] >= 8192, "Long prompt did not reach 8192 actual input tokens"
            report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", detail=str(error))
    report["elapsed_s"] = round(time.monotonic() - started, 3)
    return report
statuses = []
for engine, base, model in engines:
    try:
        with request(base, "/models") as response:
            ids = [entry["id"] for entry in json.load(response)["data"]]
        assert model in ids, f"Expected model {model!r}; received {ids!r}"
        print(json.dumps({"engine": engine, "models": ids, "status": "passed"}), flush=True)
    except Exception as error:
        print(json.dumps({"engine": engine, "status": "failed", "detail": str(error)}), flush=True)
        raise SystemExit(1)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    kinds = ("long-1", "long-2") if args.long_prompts else ("normal", "tool")
    futures = [pool.submit(probe, *engine, kind) for engine in engines for kind in kinds]
    for future in concurrent.futures.as_completed(futures):
        report = future.result()
        statuses.append(report["status"])
        print(json.dumps(report), flush=True)
raise SystemExit(1 if "failed" in statuses else 2 if "inconclusive" in statuses else 0)
