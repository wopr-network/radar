import type { INukeEventEmitter, NukeEvent } from "./types.js";

export interface SseEventEmitterConfig {
  baseUrl: string;
  prompt: string;
  modelTier: "opus" | "sonnet" | "haiku";
  sessionId?: string;
  timeoutMs?: number;
  /** Optional external AbortController — caller can check signal.aborted after timeout fires. */
  abortController?: AbortController;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export class SseEventEmitter implements INukeEventEmitter {
  constructor(private config: SseEventEmitterConfig) {}

  async *events(): AsyncIterable<NukeEvent> {
    const { baseUrl, prompt, modelTier, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS, abortController } = this.config;

    const controller = abortController ?? new AbortController();
    // Only arm the internal timer when we own the controller; if the caller
    // passed an external abortController they manage the timeout themselves.
    const timer = abortController ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, modelTier, ...(sessionId ? { sessionId } : {}) }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer ?? undefined);
      throw err;
    }

    if (!res.ok) {
      clearTimeout(timer ?? undefined);
      const text = await res.text().catch(() => "");
      throw new Error(`nuke /dispatch returned ${res.status}: ${text}`);
    }

    if (!res.body) {
      clearTimeout(timer ?? undefined);
      throw new Error("nuke /dispatch response has no body");
    }

    const reader = res.body.getReader();
    try {
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Flush any remaining bytes from the decoder and process any final event in buf
          buf += decoder.decode();
          if (buf.startsWith("data:")) {
            const json = buf.slice(5).trim();
            if (json) {
              try {
                const event = JSON.parse(json) as NukeEvent;
                if (
                  event.type === "system" ||
                  event.type === "tool_use" ||
                  event.type === "text" ||
                  event.type === "result"
                ) {
                  yield event;
                }
              } catch {
                // malformed — ignore
              }
            }
          }
          break;
        }

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch {
            continue;
          }
          const event = parsed as NukeEvent;
          if (
            event.type === "system" ||
            event.type === "tool_use" ||
            event.type === "text" ||
            event.type === "result"
          ) {
            yield event;
          }
        }
      }
    } finally {
      clearTimeout(timer ?? undefined);
      reader.cancel().catch(() => undefined);
    }
  }
}
