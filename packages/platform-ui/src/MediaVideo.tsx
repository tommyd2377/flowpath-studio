'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsPresent } from 'motion/react';
import { MediaImage, usePublishedMedia } from './MediaViews.js';

export type PlaybackState = { id: string; status: 'paused' | 'playing' | 'ended' | 'unavailable'; seconds: number; volume?: number; muted?: boolean; rate?: number; captions?: string[] };
type YouTubePlayer = { playVideo: () => void; pauseVideo: () => void; destroy: () => void; getCurrentTime: () => number; getPlayerState: () => number; mute: () => void; isMuted: () => boolean; seekTo: (seconds: number, ahead: boolean) => void };
type YouTubeAPI = { Player: new (element: HTMLElement, options: { videoId: string; width: string; height: string; playerVars: Record<string, string | number>; events: { onReady: () => void; onStateChange: (event: { data: number }) => void; onError: () => void } }) => YouTubePlayer };
let youtube: Promise<YouTubeAPI> | undefined;
function loadYouTube(): Promise<YouTubeAPI> {
  const target = window as typeof window & { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void };
  if (target.YT?.Player) return Promise.resolve(target.YT);
  return youtube ??= new Promise((resolve, reject) => {
    const previous = target.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => reject(new Error('YouTube is unavailable.')), 12000);
    target.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); previous?.(); if (target.YT?.Player) resolve(target.YT); else reject(new Error('YouTube is unavailable.')); };
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
    script.onerror = () => { clearTimeout(timeout); reject(new Error('YouTube is unavailable.')); }; document.head.append(script);
  });
}

/** Registered video renderer: one active player, explicit play by default, host-owned references. */
export function MediaVideo({ videoId, active = true, initialSeconds = 0, initialState, resumePaused = false, allowAutoplay = false, onChange, onAudible }: { videoId: string; active?: boolean; initialSeconds?: number; initialState?: PlaybackState; resumePaused?: boolean; allowAutoplay?: boolean; onChange?: (state: PlaybackState) => void; onAudible?: () => void }) {
  const context = usePublishedMedia(), video = context?.library.videos?.find(video => video.id === videoId);
  const present = useIsPresent();
  const [shouldPlay] = useState(() => !!video?.autoplay && allowAutoplay && !resumePaused);
  const played = useRef(false), requested = useRef(false);
  const [started, setStarted] = useState(false), [failed, setFailed] = useState(false);
  const native = useRef<HTMLVideoElement>(null), youtubeHost = useRef<HTMLDivElement>(null), player = useRef<YouTubePlayer | null>(null);
  const change = useRef(onChange), audible = useRef(onAudible), live = useRef(active && present);
  const last = useRef<PlaybackState>({ id: videoId, status: 'paused', seconds: initialSeconds });
  useEffect(() => { change.current = onChange; audible.current = onAudible; live.current = active && present; }, [onChange, onAudible, active, present]);
  function emit(status: PlaybackState['status'], seconds: number) { const element = native.current; last.current = { ...last.current, id: videoId, status, seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0, ...(element ? { volume: element.volume, muted: element.muted, rate: element.playbackRate, captions: Array.from(element.textTracks).filter(track => track.mode === 'showing').map(track => track.language) } : {}) }; change.current?.(last.current); }
  useEffect(() => {
    const element = native.current;
    const pause = () => { if (element) { emit('paused', element.currentTime); element.pause(); } player.current?.pauseVideo(); };
    if (!active || !present) pause();
    window.addEventListener('flowpath:pause-media', pause);
    const hide = () => { if (document.hidden) pause(); }; document.addEventListener('visibilitychange', hide);
    return () => { pause(); window.removeEventListener('flowpath:pause-media', pause); document.removeEventListener('visibilitychange', hide); };
    // The subscription follows presence, not per-render callback identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, present]);
  useEffect(() => {
    if (video?.source.kind !== 'youtube' || !(started || shouldPlay) || !active || !present) return;
    let disposed = false, interval: ReturnType<typeof setInterval> | undefined;
    const host = youtubeHost.current;
    const report = () => { const target = player.current; if (!target) return; const state = target.getPlayerState(); emit(state === 1 ? 'playing' : state === 0 ? 'ended' : 'paused', target.getCurrentTime()); };
    void loadYouTube().then(api => {
      if (disposed || !host) return;
      const element = document.createElement('div'); host.replaceChildren(element);
      const target = new api.Player(element, { videoId: video.source.kind === 'youtube' ? video.source.videoId : '', width: '100%', height: '100%', playerVars: { playsinline: 1, origin: location.origin, rel: 0 }, events: {
        onReady: () => { if (disposed) return; target.seekTo(last.current.seconds, true); if (shouldPlay && !played.current) target.mute(); if (requested.current || shouldPlay && !played.current) { played.current = true; requested.current = false; target.playVideo(); } interval = setInterval(report, 1000); },
        onStateChange: event => { if (event.data === 1 && !live.current) target.pauseVideo(); else if (event.data === 1 && !target.isMuted()) audible.current?.(); report(); },
        onError: () => { setFailed(true); emit('unavailable', target.getCurrentTime()); },
      } }); player.current = target;
    }).catch(() => { if (!disposed) { setFailed(true); emit('unavailable', initialSeconds); } });
    return () => { disposed = true; clearInterval(interval); report(); player.current?.destroy(); player.current = null; };
    // Playback is retained by the host; callback identity must not recreate players.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, started, shouldPlay, active, present]);
  if (!video || !context) return <p role="note">This video is no longer available.</p>;
  const source = video.source.kind === 'file' ? context.resolveAssetUrl(video.source.fileId, 'display') : video.source.kind === 'url' ? video.source.url : undefined;
  return <figure className="platform-video" data-video-id={video.id}>
    {failed ? <p role="status">This video could not be played. Its published description remains available.</p> : video.source.kind === 'youtube' ? <>
      {!(started || shouldPlay) ? <button type="button" className="platform-video-play" onClick={() => { requested.current = true; setStarted(true); }}>{video.posterAssetId && <MediaImage assetId={video.posterAssetId} size="display" interactive={false}/>}<span>Play {video.title}</span></button> : <div className="platform-video-player" ref={youtubeHost} aria-label={video.title}/>}
    </> : <video ref={native} controls playsInline preload="metadata" src={source} autoPlay={shouldPlay && active && present} muted={shouldPlay} aria-label={video.title}
      poster={video.posterAssetId ? context.resolveAssetUrl(video.posterAssetId, 'display') : undefined}
      onLoadedMetadata={event => { const element = event.currentTarget; element.currentTime = initialSeconds; if (initialState) { element.volume = initialState.volume ?? 1; element.muted = initialState.muted ?? false; element.playbackRate = initialState.rate ?? 1; for (const track of Array.from(element.textTracks)) track.mode = initialState.captions?.includes(track.language) ? 'showing' : 'disabled'; } emit('paused', initialSeconds); }}
      onPlay={event => { if (!active || !present) event.currentTarget.pause(); else { if (!event.currentTarget.muted) audible.current?.(); emit('playing', event.currentTarget.currentTime); } }}
      onPause={event => emit('paused', event.currentTarget.currentTime)} onEnded={event => emit('ended', event.currentTarget.currentTime)}
      onTimeUpdate={event => emit(event.currentTarget.paused ? 'paused' : 'playing', event.currentTarget.currentTime)}
      onRateChange={event => emit(event.currentTarget.paused ? 'paused' : 'playing', event.currentTarget.currentTime)}
      onVolumeChange={event => { emit(event.currentTarget.paused ? 'paused' : 'playing', event.currentTarget.currentTime); if (!event.currentTarget.paused && !event.currentTarget.muted) audible.current?.(); }} onError={() => { setFailed(true); emit('unavailable', last.current.seconds); }}/>}
    <figcaption>{video.description}</figcaption>
    {!!video.transcript?.length && <details><summary>Read transcript</summary>{video.transcript.map((cue, index) => <p key={index} data-reading-block={`cue-${index}`}>{cue.text}</p>)}</details>}
  </figure>;
}
