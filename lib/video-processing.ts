import { AppError } from './errors';

/** Bounded ISO BMFF metadata inspection. No decoding, execution, or network requests. */
export function inspectMp4(bytes: Buffer) {
  let duration = 0, width = 0, height = 0, h264 = false, boxes = 0;
  const walk = (start: number, end: number, depth = 0) => {
    if (depth > 8) throw new AppError('The MP4 structure is too complex.');
    for (let offset = start; offset < end;) {
      if (++boxes > 10000 || offset + 8 > end) throw new AppError('Invalid MP4 container.');
      const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (size < 8 || offset + size > end) throw new AppError('Unsupported or truncated MP4 container.');
      const body = offset + 8;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(kind)) walk(body, offset + size, depth + 1);
      if (kind === 'mvhd') {
        const version = bytes[body], scaleOffset = body + (version === 1 ? 20 : 12), durationOffset = scaleOffset + 4;
        if (durationOffset + (version === 1 ? 8 : 4) > offset + size) throw new AppError('Invalid MP4 duration.');
        const scale = bytes.readUInt32BE(scaleOffset), ticks = version === 1 ? Number(bytes.readBigUInt64BE(durationOffset)) : bytes.readUInt32BE(durationOffset);
        duration = scale ? ticks / scale : 0;
      }
      if (kind === 'tkhd' && size >= 84) { width = Math.max(width, bytes.readUInt32BE(offset + size - 8) / 65536); height = Math.max(height, bytes.readUInt32BE(offset + size - 4) / 65536); }
      if (kind === 'stsd' && size >= 24) { const codec = bytes.toString('ascii', body + 12, body + 16); if (['avc1', 'avc3'].includes(codec)) h264 = true; }
      offset += size;
    }
  };
  if (bytes.length < 24 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new AppError('Choose an MP4 video.');
  walk(0, bytes.length);
  if (!h264 || !Number.isFinite(duration) || duration <= 0 || duration > 600 || width <= 0 || height <= 0 || width > 4096 || height > 4096) throw new AppError('Use an H.264 MP4 up to 10 minutes and 4096 pixels per side.');
  return { duration, width, height };
}
