import { creationReviewExplanation } from '../lib/creation-review-explanations';

/** Describe the policy, not an accusation or an invented model rationale. */
export default function CreationReviewFindings({ categories, expanded = false }: { categories: string[]; expanded?: boolean }) {
  if (!categories.length) return null;
  const explanations = [...new Set(categories)].map(creationReviewExplanation);
  return <details className="creation-review-details" open={expanded}>
    <summary>Review details: {explanations.map(item => item.title).join(' · ')}</summary>
    <p>These labels describe the concerns raised, not a finding of wrongdoing. The automated review does not provide a sentence-by-sentence explanation.</p>
    <dl>{explanations.map(item => <div key={item.title}><dt>{item.title}</dt><dd>{item.detail}</dd></div>)}</dl>
  </details>;
}
