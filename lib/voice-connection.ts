// Four bounded images plus an audio SDP and JSON escaping fit within this limit.
const MAX_CONNECTION_BYTES = 512 * 1024;

/** Two bounded NDJSON frames; no provider identifier, transcript or audio reaches this request. */
export function voiceConnectionReader(response: Response) {
  if (!response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson')) throw new Error('Voice connection confirmation is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', bytes = 0;
  return {
    async next(): Promise<Record<string, unknown>> {
      try {
        while (!pending.includes('\n')) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('The voice connection ended before confirmation.');
          bytes += chunk.value.length; if (bytes > MAX_CONNECTION_BYTES) throw new Error('Invalid voice confirmation.');
          pending += decoder.decode(chunk.value, { stream: true });
        }
        const newline = pending.indexOf('\n'), value = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new Error('The voice connection could not be confirmed.');
        return value;
      } catch (error) {
        void reader.cancel().catch(() => undefined);
        throw error;
      }
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

/** Bound the non-streaming connection response before parsing it. */
export async function voiceConnectionJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Voice connection confirmation is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let body = '', bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > MAX_CONNECTION_BYTES) throw new Error('Invalid voice confirmation.');
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
}
