import sharp from 'sharp';
import type { VisualDisplayConfiguration } from '../lib/visual-display';

/** Synthetic raster content only; no user files or provider calls. */
export async function visualFixture(): Promise<VisualDisplayConfiguration> {
  const rectangle = (width: number, height: number, background: string) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
  const map = await sharp(await rectangle(640, 360, '#d6d0bd')).composite([
    { input: await rectangle(90, 360, '#548ca7'), left: 460, top: 0 },
    { input: await rectangle(400, 20, '#faf6ec'), left: 20, top: 90 },
    { input: await rectangle(400, 20, '#faf6ec'), left: 20, top: 240 },
    { input: await rectangle(20, 310, '#faf6ec'), left: 170, top: 25 },
    { input: await rectangle(100, 100, '#9db28c'), left: 250, top: 130 },
  ]).png().toBuffer();
  const workshop = await rectangle(480, 360, '#a8754b');
  return { type: 'visual', version: 1, images: [
    { id: 'town-map', title: 'Town map', description: 'Synthetic town map: a blue river to the right, pale streets and a green square.', text: 'The square is west of the river. Walk east from the square to reach the river.', src: `data:image/png;base64,${map.toString('base64')}` },
    { id: 'workshop', title: 'Workshop', description: 'A plain brown synthetic workshop illustration.', text: '', src: `data:image/png;base64,${workshop.toString('base64')}` },
  ] };
}
