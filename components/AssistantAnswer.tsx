import { Fragment, type ReactNode } from 'react';
import { publicWebUrl } from '@/lib/explore-model';

/** Escaped prose and public HTTPS citations; no HTML, generated styles or scripts. */
export default function AssistantAnswer({ text }: { text: string }) {
  const inline = (value: string): ReactNode[] => {
    const parts: ReactNode[] = []; let cursor = 0;
    for (const match of value.matchAll(/(\*\*[^*]+\*\*)|(?<!!)\[([^\]\n]+)\]\(([^()\s]+(?:\([^()\s]*\)[^()\s]*)*)\)/g)) {
      const start = match.index!;
      parts.push(value.slice(cursor, start));
      if (match[1]) parts.push(<strong key={start}>{inline(match[1].slice(2, -2))}</strong>);
      else if (match[3].length <= 2048 && publicWebUrl(match[3])) parts.push(<a key={start} href={match[3]} target="_blank" rel="noopener noreferrer">{inline(match[2])}</a>);
      else parts.push(match[0]);
      cursor = start + match[0].length;
    }
    parts.push(value.slice(cursor));
    return parts;
  };
  return text.split(/\n\s*\n/).map((block, index) => {
    if (/^#{1,6}\s/.test(block) && !block.includes('\n')) return <h3 key={index}>{inline(block.replace(/^#{1,6}\s+/, ''))}</h3>;
    const lines = block.split('\n');
    if (lines.every(line => /^(?:[-*]|\d+[.)])\s/.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^(?:[-*]|\d+[.)])\s+/, ''))}</li>)}</ul>;
    return <p key={index}>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br/>}{inline(line.replace(/^#{1,6}\s+/, ''))}</Fragment>)}</p>;
  });
}
