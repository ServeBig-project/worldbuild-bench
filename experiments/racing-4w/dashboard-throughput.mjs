export async function liveThroughput(source) {
  if (!source) return null;
  try {
    const response = await fetch(source.url, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const value = source.format === "br" ? data.throughput?.decode_tps : data.hardware?.tok_s;
    if (!Number.isFinite(value) || value < 0) return null;
    return { outputTps: value, windowSeconds: source.format === "br" ? 5 : 2 };
  } catch {
    return null;
  }
}
