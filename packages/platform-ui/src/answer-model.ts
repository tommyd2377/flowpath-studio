export type AnswerSource = { url: string; title: string };
export type AnswerCitation = AnswerSource & { start: number; end: number };

/** Public, navigable citations only; media and actions use their own contracts. */
export function publicAnswerUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && host.includes('.') && !host.endsWith('.') && !/^[\d.]+$/.test(host) && !host.includes(':')
      && !/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host);
  } catch { return false; }
}

/** Offset annotations are resolved before Markdown parsing; never infer sources from prose. */
export function prepareCitedAnswer(text: string, supplied: readonly AnswerSource[] = [], citations: readonly AnswerCitation[] = []) {
  const sources: AnswerSource[] = [], indices = new Map<string, number>();
  for (const source of supplied.slice(0, 20)) {
    if (!publicAnswerUrl(source.url)) continue;
    const url = new URL(source.url).href;
    if (indices.has(url)) continue;
    sources.push({ url, title: source.title.slice(0, 300) || new URL(url).hostname });
    indices.set(url, sources.length);
  }
  let markdown = '', cursor = 0;
  for (const citation of [...citations].slice(0, 40).sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(citation.start) || !Number.isInteger(citation.end) || citation.start < cursor
      || citation.end <= citation.start || citation.end > text.length || !publicAnswerUrl(citation.url)) continue;
    const url = new URL(citation.url).href, index = indices.get(url);
    if (!index) continue;
    markdown += `${text.slice(cursor, citation.start)}[${index}](<${url.replaceAll('<', '%3C').replaceAll('>', '%3E')}>)`;
    cursor = citation.end;
  }
  return { markdown: markdown + text.slice(cursor), sources };
}
