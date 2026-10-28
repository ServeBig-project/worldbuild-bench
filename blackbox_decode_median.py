"""Exercise only the dashboard CLI, HTTP API, rendered UI, and public fixtures."""

import argparse
import concurrent.futures
import datetime
import http.server
import json
from pathlib import Path
import socket
import statistics
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def available_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dashboard', type=Path, required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--playwright', required=True)
    parser.add_argument('--browser', required=True)
    parser.add_argument('--remaining', action='store_true')
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='case-', dir=args.artifacts.resolve()))
    rates = {'A': 10, 'B': 100, 'W': 50}
    observations = []
    process = None
    log = None

    class Source(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            label = self.path.strip('/')
            value = rates[label]
            status = 503 if value == 'error' else 200
            if value in ('missing', 'error'):
                payload = {}
            elif label == 'B':
                payload = {'hardware': {'tok_s': value}}
            else:
                payload = {'throughput': {'decode_tps': value}}
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    source = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Source)
    threading.Thread(target=source.serve_forever, daemon=True).start()
    port = available_port()
    base = f'http://127.0.0.1:{port}'
    manifest = root / 'manifest.json'
    manifest.write_text(json.dumps({
        'runs': [{'id': k.lower(), 'engine': k, 'task': 'racing', 'dir': str(root / k)}
                 for k in rates],
        'realtime': {k: {'format': 'strata' if k == 'B' else 'br',
                        'url': f'http://127.0.0.1:{source.server_port}/{k}'} for k in rates},
    }))

    def start_run(label):
        directory = root / label
        directory.mkdir(exist_ok=True)
        directory.joinpath('transcript.jsonl').write_text(json.dumps({
            'type': 'request', 'agent': 'agent', 'depth': 0, 'ts': timestamp(), 'turn': 1,
        }) + '\n')

    def stop_dashboard():
        nonlocal process, log
        if process:
            process.terminate()
            process.wait(timeout=10)
            process = None
        if log:
            log.close()
            log = None

    def start_dashboard():
        nonlocal process, log
        log = root.joinpath('dashboard.log').open('a')
        process = subprocess.Popen([
            'node', str(args.dashboard.resolve()), '--runs', str(manifest), '--port', str(port),
        ], stdout=log, stderr=log)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(base, timeout=1) as response:
                    assert response.status == 200
                return
            except (urllib.error.URLError, TimeoutError):
                if process.poll() is not None:
                    raise AssertionError('Dashboard exited; see public process log')
                time.sleep(0.1)
        raise AssertionError('Dashboard did not become reachable')

    def state(label):
        with urllib.request.urlopen(base + '/api/state?engine=' + urllib.parse.quote(label),
                                    timeout=4) as response:
            result = json.load(response)
        median = result['decodeMedian']
        assert median['samplingIntervalSeconds'] == 5, median
        assert median['sourceWindowSeconds'] == (2 if label == 'B' else 5), median
        assert type(median['samples']) is int and median['samples'] >= 0, median
        observations.append({'label': label, 'time': time.time(), 'median': median})
        return median

    def next_sample(label, previous):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            current = state(label)
            if current['samples'] > previous:
                return current
            time.sleep(0.15)
        raise AssertionError(f'No background sample for {label} after count {previous}')

    def empty(median):
        assert median['samples'] == 0 and median['outputTps'] is None, median
        assert median['firstSampleAt'] is None and median['lastSampleAt'] is None, median

    def passed(message):
        print('PASS:', message, flush=True)

    try:
        start_run('A')
        start_run('B')
        launched = time.time() * 1000
        start_dashboard()
        if args.remaining:
            current = next_sample('A', 0)
        else:
            time.sleep(11)
            a, b = state('A'), state('B')
            assert 2 <= a['samples'] <= 3 and 2 <= b['samples'] <= 3, (a, b)
            assert a['outputTps'] == 10 and b['outputTps'] == 100, (a, b)
            assert launched <= a['firstSampleAt'] <= a['lastSampleAt'], a
            empty(state('W'))
            passed('all engines sample without any API/browser polling; waiting engine stays empty')

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                list(pool.map(state, ['A'] * 30))
            current = state('A')
            assert current['samples'] <= a['samples'] + 1, (a, current)
            history = [10] * current['samples']
            passed('30 API requests do not inflate sample count')

            for value in [30, 50, 90, 110]:
                previous = current['samples']
                rates['A'] = value
                current = next_sample('A', previous)
                assert current['samples'] == previous + 1, current
                history.append(value)
                assert current['outputTps'] == statistics.median(history), (history, current)
            passed('odd and even medians match positive engine-total windows')

        ui_script = r"""
const {chromium} = require(process.argv[1]);
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.argv[3]}); const p=await b.newPage();
await p.goto(process.argv[2],{waitUntil:'networkidle'});
for (const label of ['A','B','W']) { await p.locator('select').first().selectOption(label);
await p.waitForTimeout(500); console.log(JSON.stringify({engine:label,text:await p.locator('body').innerText()})); }
await b.close();})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        rendered = subprocess.check_output(['node', '-e', ui_script, args.playwright, base, args.browser],
                                           text=True, timeout=30)
        root.joinpath('rendered-ui.jsonl').write_text(rendered)
        for line in rendered.splitlines():
            entry = json.loads(line)
            text = entry['text'].lower()
            assert 'median' in text, entry
            assert any(term in text for term in ['non-zero', 'nonzero', 'positive', '>0', '> 0']), entry
            assert 'samples' in text or 'n=' in text or 'n =' in text, entry
            if entry['engine'] == 'W':
                assert '—' in text, entry
            else:
                assert 'since' in text, entry
        passed('rendered median cards disclose positive-window, count and since semantics')

        current = state('A')
        for value in [0, 'missing', 'error', -7, float('inf')]:
            rates['A'] = value
            b_before = state('B')['samples']
            next_sample('B', b_before)
            observed = state('A')
            assert observed == current, (value, current, observed)
        passed('zero, unavailable, HTTP error, negative and nonfinite values are skipped')

        start_run('W')
        w = next_sample('W', 0)
        assert w['outputTps'] == 50, w
        with (root / 'A' / 'transcript.jsonl').open('a') as transcript:
            transcript.write(json.dumps({'type': 'generation_end', 'agent': 'runner',
                             'ts': timestamp(), 'inputTokens': 100, 'outputTokens': 10,
                             'cachedInputTokens': 0}) + '\n')
        rates['A'] = 999
        next_sample('B', state('B')['samples'])
        assert state('A') == current, (current, state('A'))
        passed('waiting-to-started begins sampling; generation end retains and freezes median')

        rates['B'] = rates['W'] = 0
        saved = {label: state(label) for label in rates}
        stop_dashboard()
        sidecar = Path(str(manifest.resolve()) + '.decode-median.json')
        assert sidecar.is_file(), sidecar
        json.loads(sidecar.read_text())
        start_dashboard()
        assert {label: state(label) for label in rates} == saved, saved
        passed('sidecar preserves completed and active-run medians across dashboard restart')

        stop_dashboard()
        start_run('A')
        rates['A'] = 0
        start_dashboard()
        empty(state('A'))
        assert state('B') == saved['B'] and state('W') == saved['W'], saved
        rates['A'] = 55
        reset = next_sample('A', 0)
        assert reset['samples'] == 1 and reset['outputTps'] == 55, reset
        assert reset['firstSampleAt'] > current['lastSampleAt'], (current, reset)
        passed('new start identity resets only that engine; no prior history is reconstructed')

        rates['A'] = 0
        stop_dashboard()
        changed_manifest = json.loads(manifest.read_text())
        changed_manifest['runs'][1]['id'] = 'b-new-identity'
        manifest.write_text(json.dumps(changed_manifest))
        start_dashboard()
        empty(state('B'))
        assert state('A') == reset and state('W') == saved['W'], saved
        passed('changed manifest run identity resets only that engine with unchanged timestamps')
        print('ALL CHECKS PASSED; artifacts:', root, flush=True)
    finally:
        root.joinpath('observations.json').write_text(json.dumps(observations, indent=2))
        stop_dashboard()
        source.shutdown()
        source.server_close()


if __name__ == '__main__':
    main()
