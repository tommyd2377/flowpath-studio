"use client";

import { useEffect, useRef } from "react";

export type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type WaveformProps = {
  color?: string;
  phase: VoicePhase;
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
};

export default function Waveform({
  color,
  phase,
  inputAnalyser,
  outputAnalyser,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef({ phase, inputAnalyser, outputAnalyser });

  useEffect(() => {
    audioRef.current = { phase, inputAnalyser, outputAnalyser };
  }, [phase, inputAnalyser, outputAnalyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const palette = document.createElement("canvas");
    const paletteContext = palette.getContext("2d");
    if (!paletteContext) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionQuery.matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let previousDraw = 0;
    let origin = 0;
    let travel = 0;
    let amplitude = 0;
    let sampleAnalyser: AnalyserNode | null = null;
    let samples = new Float32Array(0);
    let stroke: CanvasPattern | string = "#f6eddb";
    let shadow = "rgba(239, 201, 143, 0.3)";

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      // WebKit rounds the layer position for gradient strokes with shadows.
      // A cached gradient pattern keeps the animated path in place with the same glow.
      palette.width = canvas.width;
      palette.height = 1;
      const gradient = paletteContext.createLinearGradient(0, 0, width * dpr, 0);
      // A chosen voice hue keeps the same soft, transparent tails as the default.
      const customColor = color && /^#[\da-f]{6}$/i.test(color) ? color : '';
      const brand = customColor || (canvas.closest('[data-site-template]') ? getComputedStyle(canvas).getPropertyValue('--platform-accent').trim() : '');
      if (/^#[\da-f]{6}$/i.test(brand)) {
        for (const [position, alpha] of [[0, '00'], [.13, '52'], [.36, 'dd'], [.5, 'ff'], [.64, 'dd'], [.87, '52'], [1, '00']] as const) gradient.addColorStop(position, brand + alpha);
        shadow = brand + (customColor ? '33' : '4d');
      } else {
        gradient.addColorStop(0, "rgba(221, 191, 146, 0)");
        gradient.addColorStop(0.13, "rgba(221, 191, 146, 0.32)");
        gradient.addColorStop(0.36, "#d9b98c");
        gradient.addColorStop(0.5, "#fff7e7");
        gradient.addColorStop(0.64, "#e9d6b6");
        gradient.addColorStop(0.87, "rgba(221, 191, 146, 0.32)");
        gradient.addColorStop(1, "rgba(221, 191, 146, 0)");
      }
      paletteContext.fillStyle = gradient;
      paletteContext.fillRect(0, 0, palette.width, 1);
      const pattern = context.createPattern(palette, "repeat-y");
      pattern?.setTransform(new DOMMatrix().scale(1 / dpr, 1));
      stroke = pattern ?? (/^#[\da-f]{6}$/i.test(brand) ? brand : "#f6eddb");
      previousDraw = 0;
      // Resizing clears the bitmap after animation frames have run. Paint before
      // this frame reaches the screen, without creating a second animation loop.
      draw(performance.now(), false);
    };

    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      previousDraw = 0;
    };

    const draw = (timestamp: number, scheduleNext = true) => {
      if (scheduleNext) frame = window.requestAnimationFrame(draw);
      if (!width || !height) return;
      // Reduced motion keeps the geometry still, with a quiet audio update at 6 Hz.
      if (reducedMotion && previousDraw && timestamp - previousDraw < 166) return;
      if (!origin) origin = timestamp;

      const elapsed = previousDraw
        ? Math.min((timestamp - previousDraw) / 1000, 0.25)
        : 1 / 60;
      previousDraw = timestamp;
      const time = reducedMotion ? 0 : (timestamp - origin) / 1000;
      const current = audioRef.current;
      const isLive = current.phase === "listening" || current.phase === "speaking";
      const analyser = isLive
        ? current.phase === "speaking"
          ? current.outputAnalyser ?? current.inputAnalyser
          : current.inputAnalyser
        : null;

      let targetAmplitude = 0;
      if (analyser) {
        if (sampleAnalyser !== analyser || samples.length !== analyser.fftSize) {
          sampleAnalyser = analyser;
          samples = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(samples);
        let squared = 0;
        for (let i = 0; i < samples.length; i += 1) {
          squared += samples[i] * samples[i];
        }
        const rms = Math.sqrt(squared / samples.length);
        // Remove a small room-noise floor; the power curve makes quiet speech visible.
        // Only actual audio drives this envelope; missing audio stays a low filament.
        targetAmplitude = Math.min(1, Math.pow(Math.max(0, rms - 0.006) * 6, 0.7));
      }

      const smoothing = targetAmplitude > amplitude ? 0.075 : 0.24;
      amplitude += (targetAmplitude - amplitude) * (1 - Math.exp(-elapsed / smoothing));

      const isThinking = current.phase === "thinking";
      const isConnecting = current.phase === "connecting";
      const isError = current.phase === "error";
      const idleBreath = isLive || isError ? 0 : 1 + Math.sin(time * 0.85) * 0.6;
      const restingHeight = isError ? 1 : isThinking ? 5 : isConnecting ? 4 : current.phase === "idle" ? 18 : 2;
      const waveHeight = Math.min(height * 0.31, 82) * amplitude + restingHeight + idleBreath;
      const speed = isThinking ? 0.55 : current.phase === "speaking" ? 1.8 : 1.25;
      travel = reducedMotion ? 0 : travel + elapsed * speed;
      const centerY = height * 0.5;
      const pointCount = Math.max(160, Math.min(700, Math.round(width / 2)));

      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";

      context.strokeStyle = stroke;

      // The narrow Gaussian envelope leaves long, nearly weightless horizontal tails.
      // Neighboring strands share the same audio envelope and gently separate at the center.
      for (let strand = 3; strand >= 0; strand -= 1) {
        const isMain = strand === 0;
        context.beginPath();
        context.globalAlpha = isError ? (isMain ? 0.4 : 0.04) : isMain ? 0.95 : 0.12;
        context.lineWidth = isMain ? 1.45 : 0.85;
        context.shadowColor = shadow;
        context.shadowBlur = isMain ? 7 : 0;

        for (let i = 0; i <= pointCount; i += 1) {
          const progress = i / pointCount;
          const centered = progress - 0.5;
          const envelope = Math.exp(-Math.pow(Math.abs(centered) / 0.205, 2.4));
          const strandPhase = strand * 0.27;
          const primary = Math.sin(centered * Math.PI * 9 - travel + strandPhase);
          const secondary = Math.sin(centered * Math.PI * 15 + travel * 0.61 + strandPhase) * 0.24;
          const fine = Math.sin(centered * Math.PI * 23 - travel * 0.3) * 0.07;
          const strandScale = 1 - strand * 0.12;
          const separation = strand * (1.2 + amplitude * 4) * Math.sin(progress * Math.PI);
          const y = centerY + envelope * ((primary + secondary + fine) * waveHeight * strandScale + separation);
          const x = progress * width;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }

      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    motionQuery.addEventListener("change", onMotionChange);
    resize();
    frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, [color]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-wave-color={color}
      // Trim the surrounding vertical space without scaling the drawn strands.
      style={{ display: "block", position: "absolute", top: "50%", transform: "translateY(-50%)",
        width: "100%", height: "calc(100% / var(--wave-vertical-scale, 1))", pointerEvents: "none" }}
    />
  );
}
