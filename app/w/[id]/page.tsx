import OwnerWaveform from '@/components/OwnerWaveform';

export default async function WaveformPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerWaveform key={id} id={id} />;
}
