'use client';

import { Square, Volume2 } from 'lucide-react';
import { useGreetingPlayback } from '@/lib/use-greeting-playback';

export default function GreetingPlayer({ text, label = 'Listen to preview', disabled = false, className = 'button secondary' }: {
  text: string; label?: string; disabled?: boolean; className?: string;
}) {
  const { playing, error, play, stop } = useGreetingPlayback(text);
  return <div>
    <button type="button" className={className} disabled={disabled && !playing} onClick={playing ? stop : play}>
      {playing ? <Square size={15} aria-hidden="true"/> : <Volume2 size={15} aria-hidden="true"/>}
      {playing ? 'Stop playback' : label}
    </button>
    {error && <p className="field-help" role="status">{error}</p>}
  </div>;
}
