// Reader for a text/event-stream response body, as used by the V3 streamed turn
// (docs/v3/voice-rep-contract.md). Only `event:` and `data:` lines are needed.

export type SseEvent = { event: string; data: string };

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const parsed = parseBlock(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (parsed) yield parsed;
        cut = buffer.indexOf("\n\n");
      }
      if (done) {
        const parsed = parseBlock(buffer);
        if (parsed) yield parsed;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
