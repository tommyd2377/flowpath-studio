import KnowledgeSettings from '@/components/KnowledgeSettings';
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  return <KnowledgeSettings waveformId={id} />;
}
