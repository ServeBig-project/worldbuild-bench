/**
 * Server-sent events for streamed OpenAI-compatible Chat Completions.
 * Streaming keeps a long local generation from looking like a dead connection
 * (headers arrive at once, then one chunk per token) and lets the agent report
 * live progress and first-token latency.
 */

/** Split a buffer into complete SSE events' data payloads; the partial tail is returned as `rest`. */
export function splitSSE(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: string[] = [];
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) events.push(data);
  }
  return { events, rest };
}

export interface StreamProgress {
  /** Stream chunks with any delta so far (about one per generated token). */
  chunks: number;
  reasoningChars: number;
  contentChars: number;
  toolArgChars: number;
  /** ms from request start to the first delta; null until one arrives. */
  firstTokenMs: number | null;
  elapsedMs: number;
}

interface PartialToolCall {
  id?: string;
  name?: string;
  args: string;
}

/** Folds streamed chunks back into the shape of a non-streamed completion. */
export class ChatStreamAccumulator {
  private reasoning = "";
  private content = "";
  private calls = new Map<number, PartialToolCall>();
  private finishReason: string | null = null;
  private usage: unknown = undefined;
  private model: string | undefined;
  private chunks = 0;
  private firstTokenAt: number | null = null;
  private readonly startedAt = Date.now();

  push(json: any): void {
    if (typeof json?.model === "string") this.model = json.model;
    if (json?.usage) this.usage = json.usage;
    const choice = json?.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    let any = false;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      this.reasoning += delta.reasoning_content;
      any = true;
    }
    if (typeof delta.content === "string" && delta.content) {
      this.content += delta.content;
      any = true;
    }
    for (const tc of delta.tool_calls ?? []) {
      const index = typeof tc.index === "number" ? tc.index : this.calls.size;
      const call = this.calls.get(index) ?? { args: "" };
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name = tc.function.name;
      if (typeof tc.function?.arguments === "string") call.args += tc.function.arguments;
      this.calls.set(index, call);
      any = true;
    }
    if (any) {
      this.chunks += 1;
      if (this.firstTokenAt === null) this.firstTokenAt = Date.now();
    }
  }

  progress(): StreamProgress {
    let toolArgChars = 0;
    for (const c of this.calls.values()) toolArgChars += c.args.length;
    return {
      chunks: this.chunks,
      reasoningChars: this.reasoning.length,
      contentChars: this.content.length,
      toolArgChars,
      firstTokenMs: this.firstTokenAt === null ? null : this.firstTokenAt - this.startedAt,
      elapsedMs: Date.now() - this.startedAt,
    };
  }

  /** The reply as a non-streamed /chat/completions body, so one parser serves both modes. */
  toCompletionJson(): any {
    const toolCalls = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
    const message: Record<string, unknown> = { role: "assistant", content: this.content || null };
    if (this.reasoning) message.reasoning_content = this.reasoning;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    return {
      choices: [{ message, finish_reason: this.finishReason }],
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.model ? { model: this.model } : {}),
    };
  }
}
