import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import SiteExperience from '@/components/SiteExperience';
import { getBackendMode } from '@/lib/firebase/config';
import { getPublished } from '@/lib/site-store';
import { getPublishedKnowledgeSnapshot } from '@/lib/knowledge-store';
import { getPublishedMedia } from '@/lib/media-store';

export const dynamic = 'force-dynamic';
export default async function PublicSite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const host = (await headers()).get('host') || '';
  if (getBackendMode() === 'demo' && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) notFound();
  const site = await getPublished(slug);
  if (!site) notFound();
  const catalog = await getPublishedKnowledgeSnapshot(site.siteId, site.content.knowledgeRevisionId);
  const media = await getPublishedMedia(site.siteId, site.content.mediaRevisionId);
  return <main className="published-site"><SiteExperience siteId={site.siteId} content={site.content} publishedSlug={site.slug} catalog={catalog} media={media}/></main>;
}
