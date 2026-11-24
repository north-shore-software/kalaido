// Reads an NDJSON (newline-delimited JSON) HTTP stream, yielding each parsed
// object as it arrives. Blank lines and lines that fail to parse are skipped.
// Callers own their own control flow (return on an error field, throw,
// accumulate a count, …) via the for-await body — see pullModel /
// streamReconcile.
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let item: T;
      try {
        item = JSON.parse(line) as T;
      } catch {
        continue;
      }
      yield item;
    }
  }
}
