"""Preflight for the racing-4w demo: a tool call parses, and 4 concurrent requests decode together (FreeToken's own
'Decode batch, #running-req' log must show 4)."""
import json, re, subprocess, threading, time, urllib.request
URL = "http://127.0.0.1:1919/v1/chat/completions"
def post(body, timeout=900):
    req = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())
tools = [{"type": "function", "function": {"name": "write_file", "description": "write a file",
          "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                         "required": ["path", "content"]}}}]
r = post({"model": "nvfp4", "messages": [{"role": "user", "content": "Create js/hello.js exporting a function hello() that returns 'hi'. Use the write_file tool."}],
          "tools": tools, "max_tokens": 1024, "reasoning_effort": "medium"})
m = r["choices"][0]["message"]; tc = m.get("tool_calls") or []
args = json.loads(tc[0]["function"]["arguments"]) if tc else None
print("tool call:", bool(tc), "| name:", tc[0]["function"]["name"] if tc else None, "| args parse:", sorted(args) if args else None,
      "| finish:", r["choices"][0]["finish_reason"], "| usage:", r["usage"])
since = time.strftime("%Y-%m-%dT%H:%M:%S")
res = [None] * 4
def one(i):
    t = time.time()
    out = post({"model": "nvfp4", "max_tokens": 600, "reasoning_effort": "medium", "messages": [{"role": "user",
          "content": f"[{i}] In about 300 words, describe a coastal low-poly racing track for a browser game, variant {i}."}]})
    res[i] = (round(time.time() - t, 1), out["usage"]["completion_tokens"], out["choices"][0]["finish_reason"])
ts = [threading.Thread(target=one, args=(i,)) for i in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
print("4 concurrent:", res)
log = subprocess.run(["docker", "logs", "--since", since, "wb-freetoken"], capture_output=True, text=True)
runs = [int(x) for x in re.findall(r"Decode batch, #running-req: (\d+)", log.stdout + log.stderr)]
print("decode log #running-req histogram:", {k: runs.count(k) for k in sorted(set(runs))}, "| max:", max(runs) if runs else None)
