import { Fragment } from 'react';

/** Small, escaped prose renderer: no HTML, generated styles or executable links. */
export default function AssistantAnswer({ text }: { text: string }) {
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
  return text.split(/\n\s*\n/).map((block, index) => {
    if (/^#{1,6}\s/.test(block) && !block.includes('\n')) return <h3 key={index}>{inline(block.replace(/^#{1,6}\s+/, ''))}</h3>;
    const lines = block.split('\n');
    if (lines.every(line => /^(?:[-*]|\d+[.)])\s/.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^(?:[-*]|\d+[.)])\s+/, ''))}</li>)}</ul>;
    return <p key={index}>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br/>}{inline(line.replace(/^#{1,6}\s+/, ''))}</Fragment>)}</p>;
  });
}
