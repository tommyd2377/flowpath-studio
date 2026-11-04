import type { PracticeDisplay as View } from '@/lib/practice-session';
import DisplayFrame from './DisplayFrame';

export default function PracticeDisplay({ view }: { view: View }) {
  return <DisplayFrame title={view.name} status={view.progress} contentKey={view.prompt}>
    {view.title && <h3>{view.title}</h3>}
    {view.prompt && <p className="display-mixed__text">{view.prompt}</p>}
    {view.detail && <p className="display-mixed__text">{view.detail}</p>}
    {view.source && <details>
      <summary>Source · {view.source.filename}</summary>
      <blockquote>{view.source.quote}</blockquote>
    </details>}
  </DisplayFrame>;
}
