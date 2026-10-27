/** Two small NDJSON frames; no provider identifier, transcript or audio reaches this request. */
export function voiceConnectionReader(response: Response) {
  if (!response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson')) throw new Error('Voice connection confirmation is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', bytes = 0;
  return {
    async next(): Promise<Record<string, unknown>> {
      while (!pending.includes('\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('The voice connection ended before confirmation.');
        bytes += chunk.value.length; if (bytes > 4096) throw new Error('Invalid voice confirmation.');
        pending += decoder.decode(chunk.value, { stream: true });
      }
      const newline = pending.indexOf('\n'), value = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new Error('The voice connection could not be confirmed.');
      return value;
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}
