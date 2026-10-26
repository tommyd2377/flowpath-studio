import PaidExperience from '@/components/PaidExperience';
export default async function PublishedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaidExperience key={id} id={id} />;
}
