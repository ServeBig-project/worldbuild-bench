import fs from "node:fs";
import path from "node:path";

export function decodeMedianStore(file) {
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  function record(engine, key, reading, now) {
    const changed = saved[engine]?.key !== key;
    if (changed) saved[engine] = { key, samples: [] };
    const value = reading?.outputTps;
    const valid = Number.isFinite(value) && value > 0;
    if (valid) saved[engine].samples.push([now, value]);
    if (changed || valid) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(saved));
      fs.renameSync(file + ".tmp", file);
    }
  }
  function snapshot(engine, key, sourceWindowSeconds) {
    const samples = saved[engine]?.key === key ? saved[engine].samples : [];
    const values = samples.map(([, value]) => value).sort((a, b) => a - b);
    const n = values.length, mid = Math.floor(n / 2);
    return {
      outputTps: n ? (n % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2) : null,
      samples: n, firstSampleAt: samples[0]?.[0] ?? null,
      lastSampleAt: samples.at(-1)?.[0] ?? null,
      samplingIntervalSeconds: 5, sourceWindowSeconds,
    };
  }
  return { record, snapshot };
}
