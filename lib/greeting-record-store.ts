import 'server-only';
import type { SiteContent } from './site-model';
import { CatalogRepository, type CatalogManifest } from './catalog-repository';
import { greetingRecordTopic, type GreetingRecordTopic } from './greeting-records';

/** Missing selections can be repaired in Studio; storage/authority failures still fail closed. */
export async function selectedGreetingRecords(repository: CatalogRepository, manifest: CatalogManifest, ids: string[]): Promise<GreetingRecordTopic[]> {
  const selected = [...new Set(ids)].slice(0, 3);
  const records = await Promise.all(selected.map(async id => {
    try { return (await repository.records(manifest, [id]))[0]; }
    catch (error) { if (error instanceof Error && error.message === 'Unavailable record reference.') return null; throw error; }
  }));
  return records.flatMap(record => record ? [greetingRecordTopic(record, manifest.metadata.fields)] : []);
}

/** Resolve only this snapshot's selected introduction records, never the entire catalog. */
export async function loadGreetingRecords(siteId: string, content: Pick<SiteContent, 'catalogPublicationId' | 'greetingPoints'>, repository = new CatalogRepository()): Promise<GreetingRecordTopic[]> {
  const ids = (content.greetingPoints ?? []).flatMap(point => point?.kind === 'record' ? [point.id] : []).slice(0, 3);
  if (!content.catalogPublicationId || !ids.length) return [];
  const manifest = await repository.manifest(siteId, content.catalogPublicationId);
  return selectedGreetingRecords(repository, manifest, ids);
}
