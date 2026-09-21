import 'server-only';
import type { WebsiteEntry } from '@thevoice/platform-ui';
import type { CanonicalRecord } from '@thevoice/platform-ui/collection-space';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { TypedValue } from '@thevoice/platform-ui/query';
import { websiteValueRole } from '@thevoice/platform-ui/site-design';
import { projectField } from './catalog-query';
import type { CompiledQueryIndex } from './catalog-query-index';

const displayValue = (value: TypedValue | null) => value ? `${value.currency ? `${value.currency} ` : ''}${Array.isArray(value.value) ? value.value.join(', ') : String(value.value)}${value.unit ? ` ${value.unit}` : ''}${value.basis ? ` / ${value.basis}` : ''}` : 'Unknown';

/** Projects only the supplied page or detail from an already-authorized index. */
export function websiteCatalogEntry(record: CanonicalRecord, index: CompiledQueryIndex, options: { detail?: boolean; media?: MediaLibrary | null; asOf?: string } = {}): WebsiteEntry {
  const asOf = options.asOf ?? new Date().toISOString();
  const values = index.space.fields.flatMap(field => {
    const result = projectField(index, record.id, field.id, asOf);
    if (!result.assertionIds.length) return [];
    const assertions = (index.assertions.get(record.id)?.get(field.id) ?? []).filter(fact => result.assertionIds.includes(fact.id));
    const detail = assertions.map(fact => `${fact.polarity === 'denied' ? 'Not asserted: ' : ''}${displayValue(fact.value)}${fact.conditions.length ? ` — ${fact.conditions.join('; ')}` : ''}${fact.validFrom ? ` · from ${fact.validFrom}` : ''}${fact.validTo ? ` · until ${fact.validTo}` : ''}`).join('. ');
    return [{ label: field.label, role: websiteValueRole(field), text: result.state === 'known' ? displayValue(result.value) : result.state === 'stale' ? 'Unknown at this time' : `${result.state === 'conflicting' ? 'Conflicting approved assertions' : result.state === 'conditional' ? 'Conditions apply' : 'Unknown'}${detail ? `. ${detail}` : ''}` }];
  });
  // Important pricing conditions must not disappear behind unrelated metadata.
  const visibleValues = options.detail ? values : [...values.filter(value => value.role), ...values.filter(value => !value.role)].slice(0, 4);
  const isVideo = record.type === 'published-video';
  const video = isVideo ? options.media?.videos?.find(video => video.id === record.media?.assetId) : undefined;
  const kind = record.type.replace(/^type-(?=service$|project$|product$|offering$|article$|story$|guide$|faq$|information$|policy$|place$)/, '');
  return { id: `catalog:${record.id}`, recordId: record.id, kind, name: record.name, body: record.summary,
    ...(options.detail ? { blocks: record.blocks.filter(block => block.kind === 'paragraph' || block.kind === 'heading').map(block => ({ ...block, kind: block.kind as 'paragraph' | 'heading' })) } : {}),
    ...(record.media ? isVideo ? { videoId: record.media.assetId, ...(video?.posterAssetId ? { imageAssetId: video.posterAssetId } : {}) } : { imageAssetId: record.media.assetId, example: record.media.role === 'example' } : {}),
    eyebrow: isVideo ? 'Watch' : index.space.memberships.filter(member => member.recordId === record.id).map(member => index.space.collections.find(collection => collection.id === member.collectionId)?.name).find(Boolean),
    values: visibleValues,
  };
}
