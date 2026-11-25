interface MotionRange {
  stillEnd: number;
  videoStart: number;
  videoEnd: number;
}

const decoder = new TextDecoder();
const videoBoxes = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid',
  'moof', 'sidx', 'styp', 'mfra', 'pdin', 'prft', 'emsg', 'meta']);

function readBox(data: DataView, offset: number, limit: number) {
  if (offset < 0 || offset + 8 > limit) return;
  const length = data.getUint32(offset);
  const header = length === 1 ? 16 : 8;
  if (offset + header > limit) return;
  const size = length === 1 ? Number(data.getBigUint64(offset + 8)) : length || limit - offset;
  if (!Number.isSafeInteger(size) || size < header || size > limit - offset) return;
  const type = String.fromCharCode(
    data.getUint8(offset + 4), data.getUint8(offset + 5),
    data.getUint8(offset + 6), data.getUint8(offset + 7),
  );
  return { type, payload: offset + header, end: offset + size, extendsToEnd: length === 0 };
}

function endOfVideo(data: DataView, start: number, limit: number): number | undefined {
  const first = readBox(data, start, limit);
  if (first?.type !== 'ftyp' || first.end - first.payload < 8) return;
  let end = first.end;
  let hasMovie = false;
  let hasMedia = false;
  while (end < limit) {
    const box = readBox(data, end, limit);
    if (!box || !videoBoxes.has(box.type)) break;
    hasMovie ||= box.type === 'moov' && box.end > box.payload;
    hasMedia ||= box.type === 'mdat' && box.end > box.payload;
    end = box.end;
  }
  return hasMovie && hasMedia ? end : undefined;
}

function androidHeif(data: DataView): MotionRange | undefined {
  for (let offset = 0; offset < data.byteLength;) {
    const box = readBox(data, offset, data.byteLength);
    if (!box) return;
    // Android Motion Photo 1.0 puts the MP4 inside the terminal top-level mpvd box.
    if (box.type === 'mpvd' && !box.extendsToEnd && box.end === data.byteLength &&
        endOfVideo(data, box.payload, box.end) === box.end) {
      return { stillEnd: offset, videoStart: box.payload, videoEnd: box.end };
    }
    offset = box.end;
  }
}

function androidJpeg(bytes: Uint8Array, data: DataView): MotionRange | undefined {
  const xmpPrefix = 'http://ns.adobe.com/xap/1.0/\0';
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset] !== 0xff || bytes[offset + 1] === 0xda || bytes[offset + 1] === 0xd9) return;
    if (bytes[offset + 1] === 0xff) {
      offset += 1;
      continue;
    }
    const length = data.getUint16(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return;
    if (bytes[offset + 1] === 0xe1) {
      const packet = decoder.decode(bytes.subarray(offset + 4, end));
      if (packet.startsWith(xmpPrefix)) {
        const motionItem = packet.match(/<[^<>]+\b[\w.-]+:Semantic\s*=\s*["']MotionPhoto["'][^<>]*>/)?.[0];
        const itemLength = motionItem?.match(/\b[\w.-]+:Length\s*=\s*["'](\d+)["']/)?.[1];
        const legacyOffset = packet.match(/\b[\w.-]+:MicroVideoOffset\s*=\s*["'](\d+)["']/)?.[1];
        const fromEnd = Number(itemLength ?? legacyOffset);
        const videoStart = bytes.length - fromEnd;
        if (Number.isSafeInteger(fromEnd) && videoStart >= end &&
            endOfVideo(data, videoStart, bytes.length) === bytes.length) {
          return { stillEnd: videoStart, videoStart, videoEnd: bytes.length };
        }
      }
    }
    offset = end;
  }
}

function openHarmony(bytes: Uint8Array, data: DataView): MotionRange | undefined {
  if (bytes.length <= 60) return;
  const tail = decoder.decode(bytes.subarray(-20)).match(/^LIVE_(\d+) *$/);
  if (!tail) return;

  // The footer counts video and optional extra data, excluding the final two 20-byte tags.
  const limit = bytes.length - 40;
  const videoStart = limit - Number(tail[1]);
  if (!Number.isSafeInteger(videoStart) || videoStart < 4 || videoStart >= limit) return;
  const videoEnd = endOfVideo(data, videoStart, limit);
  if (videoEnd === undefined) return;
  return { stillEnd: videoStart, videoStart, videoEnd };
}

export function findEmbeddedMotion(bytes: Uint8Array): MotionRange | undefined {
  if (bytes.length < 8) return;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jpeg = data.getUint16(0) === 0xffd8;
  const heif = readBox(data, 0, bytes.length)?.type === 'ftyp';
  if (heif) return androidHeif(data) ?? openHarmony(bytes, data);
  if (jpeg) return androidJpeg(bytes, data) ?? openHarmony(bytes, data);
}

export async function splitEmbeddedMotion(file: File) {
  if (!/\.(?:hei[cf]|avif|jpe?g)$/i.test(file.name) &&
      !/^image\/(?:hei[cf](?:-sequence)?|avif|jpeg)$/i.test(file.type)) return;

  const range = findEmbeddedMotion(new Uint8Array(await file.arrayBuffer()));
  if (!range) return;
  return {
    image: new File([file.slice(0, range.stillEnd)], file.name, { type: file.type }),
    motion: file.slice(range.videoStart, range.videoEnd, 'video/mp4'),
  };
}
