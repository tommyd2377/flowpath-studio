'use client';

import type { DisplayImageContent, DisplayTextContent } from '@/lib/visual-display';
import StreamingText from './StreamingText';

export function DisplayText({ content }: { content: DisplayTextContent }) {
  return <StreamingText text={content.text} />;
}
export function DisplayImage({ content }: { content: DisplayImageContent }) {
  // Validated, server-normalized inline raster; never a remote/model-selected URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="display-image" src={content.src} alt={content.description} />;
}
/** A small fixed responsive layout, chosen automatically from the supplied content. */
export function MixedDisplayContent({ image, text }: { image: DisplayImageContent; text?: DisplayTextContent }) {
  return <div className="display-mixed" data-has-text={Boolean(text?.text)}>
    <figure><DisplayImage content={image} /></figure>
    {text?.text ? <div className="display-mixed__text"><DisplayText content={text} /></div>
      : <p className="display-mixed__caption" aria-hidden="true">{image.description}</p>}
  </div>;
}
