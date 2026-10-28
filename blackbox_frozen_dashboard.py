"""Verify frozen snapshots and live arms through public dashboard interfaces."""

import argparse
import copy
import http.server
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from blackbox_decode_median import available_port, timestamp


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dashboard', type=Path, required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--playwright', required=True)
    parser.add_argument('--browser', required=True)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='frozen-', dir=args.artifacts.resolve()))
    labels = ['Frozen BR', 'Frozen Strata', 'Live BR', 'Future Strata']
    calls = {str(i): 0 for i in range(4)}

    class Source(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            key = self.path.strip('/')
            calls[key] += 1
            payload = {'hardware': {'tok_s': 73}} if key in ('1', '3') else {'throughput': {'decode_tps': 42}}
            body = json.dumps(payload).encode()
            self.send_response(503 if key in ('0', '1') else 200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    source = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Source)
    threading.Thread(target=source.serve_forever, daemon=True).start()
    captured = int(time.time() * 1000) - 120000
    runs = [{'id': f'run-{i}', 'engine': label, 'task': 'racing', 'dir': str(root / f'run-{i}')}
            for i, label in enumerate(labels)]
    snapshots = {}
    for i in (0, 1):
        directory = Path(runs[i]['dir'])
        workspace = directory / 'workspace'
        workspace.mkdir(parents=True)
        directory.joinpath('transcript.jsonl').write_text(json.dumps({
            'type': 'request', 'agent': 'agent', 'depth': 0, 'turn': 1,
            'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime((captured - 60000) / 1000)),
        }) + '\n')
        workspace.joinpath('index.html').write_text(f'<!doctype html><p>ARCHIVED_PARTIAL_{i}</p>')
        workspace.joinpath('marker.txt').write_text(f'archived-resource-{i}')
        run = {**runs[i], 'status': 'stopped', 'phase': 'Stopped by user · frozen partial results',
               't0': captured - 60000, 'finishedAt': captured, 'elapsedMs': 60000,
               'inputTokens': 1000, 'outputTokens': 200, 'cachedInputTokens': 50,
               'root': None, 'builders': [], 'feed': [], 'live': {'running': 0, 'queue': 0},
               'generationStartedAt': captured - 60000, 'generationFinishedAt': captured,
               'game': {'version': 'archived', 'recent': [], 'url': f'/game/run-{i}/index.html'}}
        throughput = {'inputTps': 1000 / 60, 'outputTps': 200 / 60, 'throughputElapsedMs': 60000,
                      'throughputProvisional': True, 'throughputTimeSource': 'recorded',
                      'throughputUnavailableReason': None}
        run.update(throughput)
        snapshot = {'now': captured, 'hardware': 'Recorded partial comparison', 'engine': labels[i],
                    'engines': labels[:2], 'runs': [run], 'frozenAt': captured,
                    'aggregate': {**throughput, 'activeRequests': 0, 'running': 0, 'queue': 0,
                                  'inputTokens': 1000, 'outputTokens': 200, 'cachedInputTokens': 50,
                                  'elapsedMs': 60000, 'completed': True},
                    'realtime': {'outputTps': 999, 'windowSeconds': 5},
                    'decodeMedian': {'outputTps': 11.5 + i, 'samples': 4,
                                     'firstSampleAt': captured - 60000, 'lastSampleAt': captured - 15000,
                                     'samplingIntervalSeconds': 5, 'sourceWindowSeconds': 5 if i == 0 else 2},
                    'batch': {'series': []}}
        snapshots[labels[i]] = snapshot
        root.joinpath(f'snapshot-{i}.json').write_text(json.dumps(snapshot))
    live = Path(runs[2]['dir'])
    live.mkdir()
    live.joinpath('transcript.jsonl').write_text(json.dumps({
        'type': 'request', 'agent': 'agent', 'depth': 0, 'ts': timestamp(), 'turn': 1,
    }) + '\n')
    manifest = root / 'manifest.json'
    manifest.write_text(json.dumps({
        'runs': runs,
        'realtime': {label: {'format': 'strata' if i in (1, 3) else 'br',
                            'url': f'http://127.0.0.1:{source.server_port}/{i}'} for i, label in enumerate(labels)},
        'frozen': {labels[0]: 'snapshot-0.json', labels[1]: str(root / 'snapshot-1.json')},
    }))
    base = f'http://127.0.0.1:{available_port()}'
    log = root.joinpath('dashboard.log').open('w')
    process = subprocess.Popen(['node', str(args.dashboard.resolve()), '--runs', str(manifest),
                                '--port', base.rsplit(':', 1)[1]], stdout=log, stderr=log)
    observations = []

    def get(path):
        with urllib.request.urlopen(base + path, timeout=4) as response:
            return response.read()

    def state(label):
        value = json.loads(get('/api/state?engine=' + urllib.parse.quote(label)))
        observations.append({'time': time.time(), 'state': value})
        return value

    def frozen_matches():
        for label, snapshot in snapshots.items():
            expected = copy.deepcopy(snapshot)
            expected.update(engines=labels, engine=label, realtime=None)
            actual = state(label)
            assert actual == expected, (label, expected, actual)

    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                get('/')
                break
            except urllib.error.URLError:
                if time.monotonic() >= deadline or process.poll() is not None:
                    raise AssertionError('Dashboard did not start; see public process log')
                time.sleep(0.1)
        frozen_matches()
        for _ in range(10):
            frozen_matches()
        assert calls['0'] == calls['1'] == 0, calls
        time.sleep(11)
        frozen_matches()
        assert calls['0'] == calls['1'] == 0, calls
        current = state(labels[2])
        assert current['decodeMedian']['samples'] >= 2, current
        assert current['decodeMedian']['outputTps'] == 42 and current['realtime']['outputTps'] == 42, current
        assert 'frozenAt' not in current, current
        assert state(labels[3])['decodeMedian']['samples'] == 0
        print('PASS: immutable snapshots/medians, no frozen endpoint requests, live arms keep sampling', flush=True)
        for i in (0, 1):
            assert f'ARCHIVED_PARTIAL_{i}' in get(f'/game/run-{i}/index.html').decode()
            assert get(f'/game/run-{i}/marker.txt').decode() == f'archived-resource-{i}'
        print('PASS: archived game HTML and relative resources remain available', flush=True)
        script = r"""
const {chromium}=require(process.argv[1]);
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.argv[3]});const p=await b.newPage();
await p.goto(process.argv[2],{waitUntil:'networkidle'});
for(const label of ['Frozen BR','Frozen Strata','Live BR']){
await p.locator('select').first().selectOption(label);await p.waitForTimeout(500);
console.log(JSON.stringify({label,text:await p.locator('body').innerText()}));}
await b.close();})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        rendered = subprocess.check_output(['node', '-e', script, args.playwright, base, args.browser],
                                           text=True, timeout=30)
        root.joinpath('rendered-ui.jsonl').write_text(rendered)
        for line in rendered.splitlines():
            entry = json.loads(line)
            text = entry['text'].lower()
            if entry['label'].startswith('Frozen'):
                assert all(term in text for term in ['stopped by user', 'frozen partial results', 'no final score']), entry
            else:
                assert 'stopped by user' not in text, entry
        assert calls['0'] == calls['1'] == 0, calls
        frozen_matches()
        print('PASS: rendered frozen/partial/no-final-score notice; live view remains distinct', flush=True)
        print('ALL CHECKS PASSED; artifacts:', root, flush=True)
    finally:
        root.joinpath('observations.json').write_text(json.dumps(observations, indent=2))
        root.joinpath('endpoint-calls.json').write_text(json.dumps(calls))
        process.terminate()
        process.wait(timeout=10)
        log.close()
        source.shutdown()
        source.server_close()


if __name__ == '__main__':
    main()
