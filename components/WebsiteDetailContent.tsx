import type { WebsiteEntry } from '@thevoice/platform-ui';

/** Keep approved values and their qualifications ahead of long reading blocks. */
export default function WebsiteDetailContent({ entry }: { entry: WebsiteEntry }) {
  const hasValues = !!entry.values?.length;
  return <div className="website-detail-content">
    {hasValues && <section aria-label="Details and conditions">
      <h3>Details and conditions</h3>
      <dl>{entry.values!.map((value, index) => <div key={`${value.label}-${index}`}><dt>{value.label}</dt><dd>{value.text}</dd></div>)}</dl>
    </section>}
    {!entry.blocks?.length && <p>{entry.body}</p>}
    {!!entry.blocks?.length && <>
      {hasValues && <h3>Full description</h3>}
      {entry.blocks.map(block => block.kind === 'heading' ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>)}
    </>}
  </div>;
}
