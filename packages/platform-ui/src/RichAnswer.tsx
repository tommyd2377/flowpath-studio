'use client';

import { useMemo, type ComponentProps } from 'react';
import { useReducedMotion } from 'motion/react';
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins } from 'streamdown';
import { prepareCitedAnswer, publicAnswerUrl, type AnswerCitation, type AnswerSource } from './answer-model.js';
import { Sources, SourcesContent, SourcesTrigger } from './AnswerSources.js';

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };
// Model-supplied HTML remains readable text, including during partial streaming.
function literalHtml() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => { if (node.type === 'html') node.type = 'text'; node.children?.forEach(visit); };
    visit(tree);
  };
}
const remarkPlugins = [defaultRemarkPlugins.gfm, literalHtml];
const rehypePlugins = [defaultRehypePlugins.sanitize];
const allowedElements = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'input'];
const cellAlign = (value: unknown): 'left' | 'center' | 'right' | undefined => value === 'left' || value === 'center' || value === 'right' ? value : undefined;
const components: ComponentProps<typeof Streamdown>['components'] = {
  h1: ({ children }) => <h3>{children}</h3>, h2: ({ children }) => <h3>{children}</h3>, h3: ({ children }) => <h3>{children}</h3>,
  h4: ({ children }) => <h4>{children}</h4>, h5: ({ children }) => <h4>{children}</h4>, h6: ({ children }) => <h4>{children}</h4>,
  p: ({ children }) => <p>{children}</p>, strong: ({ children }) => <strong>{children}</strong>, em: ({ children }) => <em>{children}</em>, del: ({ children }) => <del>{children}</del>,
  ul: ({ children }) => <ul>{children}</ul>, ol: ({ children, start }) => <ol start={start}>{children}</ol>, li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>, hr: () => <hr/>, br: () => <br/>,
  a: ({ href, children }) => href && publicAnswerUrl(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  // Photos must come from the published-media/search contracts, never Markdown URLs.
  img: ({ alt }) => <span className="platform-answer-image-label">{alt || 'Image'}</span>,
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={checked ? 'Completed item' : 'Incomplete item'}/>,
  code: ({ children }) => <code>{children}</code>, pre: ({ children }) => <pre>{children}</pre>,
  table: ({ children }) => <div className="platform-answer-table" role="region" aria-label="Answer table" tabIndex={0}><table>{children}</table></div>,
  thead: ({ children }) => <thead>{children}</thead>, tbody: ({ children }) => <tbody>{children}</tbody>, tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children, align, style }) => <th scope="col" style={{ textAlign: cellAlign(align ?? style?.textAlign) }}>{children}</th>, td: ({ children, align, style }) => <td style={{ textAlign: cellAlign(align ?? style?.textAlign) }}>{children}</td>,
};

/** Shared answer formatting; the host continues to own evidence, history and tasks. */
export function RichAnswer({ text, sources = [], citations = [], streaming = false, onInteraction }: {
  text: string; sources?: readonly AnswerSource[]; citations?: readonly AnswerCitation[]; streaming?: boolean; onInteraction?: () => void;
}) {
  const reduced = useReducedMotion();
  const prepared = useMemo(() => prepareCitedAnswer(text, sources, citations), [text, sources, citations]);
  return <div className="platform-rich-answer" data-streaming={streaming || undefined}>
    <Streamdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
      allowedElements={allowedElements} urlTransform={(url, key) => key === 'href' && publicAnswerUrl(url) ? url : ''}
      mode={streaming ? 'streaming' : 'static'} parseIncompleteMarkdown={streaming} isAnimating={streaming}
      animated={streaming && reduced === false ? { animation: 'fadeIn', duration: 160 } : false} controls={false}>
      {prepared.markdown}
    </Streamdown>
    {prepared.sources.length > 0 && <Sources key={prepared.sources.map(source => source.url).join('|')} onToggle={onInteraction}>
      <SourcesTrigger count={prepared.sources.length}/><SourcesContent sources={prepared.sources}/>
    </Sources>}
  </div>;
}
