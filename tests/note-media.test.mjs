import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findEmbeddedMotion, splitEmbeddedMotion } from '../src/lib/motion-photo.ts';
import { groupNoteMedia, noteMedia } from '../src/lib/note-media.ts';

test('pairs each original still with its MOV by filename regardless of upload order', () => {
  const files = [
    new File([], 'IMG_0001.MOV'),
    new File([], 'IMG_0002.HEIC'),
    new File([], 'img_0001.heic'),
    new File([], 'unpaired.mov'),
    new File([], 'web.jpg', { type: 'image/jpeg' }),
  ];
  assert.deepEqual(groupNoteMedia(files), {
    items: [
      { image: files[1], motion: undefined },
      { image: files[2], motion: files[0] },
      { image: files[4], motion: undefined },
    ],
    hasUnpairedMotion: true,
  });
});

test('keeps existing image paths and resolves HEIC and Live Photo deliverables', () => {
  assert.deepEqual(noteMedia('/uploads/screenshot.png'), { image: '/uploads/screenshot.png' });
  assert.equal(noteMedia('/uploads/Apple.HEIC').image, '/media/Apple.HEIC.jpg');
  assert.deepEqual(noteMedia('/media/demo.live.heic'), {
    image: '/media/demo.live.heic.jpg',
    motion: '/media/demo.live.mp4',
  });
  assert.deepEqual(noteMedia('/media/demo.live.jpg'), {
    image: '/media/demo.live.jpg',
    motion: '/media/demo.live.mp4',
  });
});

test('thumbnail links on the home and article pages open the shared image preview', () => {
  for (const route of ['index.html', 'notes/2026-11-08-hello/index.html']) {
    const html = readFileSync(new URL('../dist/' + route, import.meta.url), 'utf8');
    assert.match(html, /<dialog\b[^>]*id="media-preview"/);
    if (html.includes('class="media-cell"')) assert.match(html, /<a\b[^>]*data-media-preview/);
  }
});

test('Live Photo preview offers a ring toggle and loops inline without native controls', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const motion = html.match(/<video\b[^>]*class="media-preview-video"[^>]*>/)?.[0];
  assert.ok(motion);
  for (const attribute of ['loop', 'muted', 'playsinline']) {
    assert.match(motion, new RegExp('\\b' + attribute + '\\b'));
  }
  assert.doesNotMatch(motion, /\bcontrols\b/);
  assert.match(html, /<button[^>]*class="media-preview-motion"[^>]*aria-pressed="false"[^>]*>\s*<span[^>]*class="live-photo-mark"/);
  assert.doesNotMatch(html, /class="media-live"[^>]*>Live</);
});

function box(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}

const heic = box('ftyp', Buffer.from('heic\0\0\0\0heic'));
const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom')), box('moov', box('trak')), box('mdat', Buffer.from([1]))]);

test('extracts the video payload from the terminal Android HEIC mpvd box', () => {
  const input = Buffer.concat([heic, box('mdat', box('mpvd', mp4)), box('mpvd', mp4)]);
  const result = findEmbeddedMotion(input);
  assert.deepEqual(result, { stillEnd: input.length - mp4.length - 8, videoStart: input.length - mp4.length, videoEnd: input.length });
  assert.equal(findEmbeddedMotion(Buffer.concat([heic, box('mdat', box('mpvd', mp4))])), undefined);
  assert.equal(findEmbeddedMotion(Buffer.concat([heic, box('mpvd', mp4.subarray(0, -1))])), undefined);
});

test('extracts Android JPEG motion using the XMP container item or legacy offset', () => {
  for (const xml of [
    '<Container:Item Item:Length="' + mp4.length + '" Item:Semantic="MotionPhoto" Item:Mime="video/mp4"/>',
    '<rdf:Description GCamera:MicroVideoOffset="' + mp4.length + '"/>',
  ]) {
    const xmp = Buffer.from('http://ns.adobe.com/xap/1.0/\0' + xml);
    const app = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
    app.writeUInt16BE(xmp.length + 2, 4);
    const still = Buffer.concat([app, xmp, Buffer.from([0xff, 0xd9])]);
    const result = findEmbeddedMotion(Buffer.concat([still, mp4]));
    assert.deepEqual(result, { stillEnd: still.length, videoStart: still.length, videoEnd: still.length + mp4.length });
  }
  assert.equal(findEmbeddedMotion(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mp4])), undefined);
});

test('separates an OpenHarmony live file without passing its trailer to the decoder', () => {
  for (const still of [heic, Buffer.from([0xff, 0xd8, 0xff, 0xd9])]) {
    for (const version of ['', 'v6_f0'.padEnd(20)]) {
      const tail = Buffer.from(version + '0:48'.padEnd(20) + ('LIVE_' + (mp4.length + version.length)).padEnd(20));
      const input = Buffer.concat([still, mp4, tail]);
      assert.deepEqual(findEmbeddedMotion(input), {
        stillEnd: still.length,
        videoStart: still.length,
        videoEnd: still.length + mp4.length,
      });
    }
  }
});

test('preserves the original input when splitting a single-file motion photo', async () => {
  const original = new File([heic, box('mpvd', mp4)], 'original.heic');
  const split = await splitEmbeddedMotion(original);
  assert.equal(split.image.name, original.name);
  assert.deepEqual(Buffer.from(await split.image.arrayBuffer()), heic);
  assert.deepEqual(Buffer.from(await split.motion.arrayBuffer()), mp4);
  assert.equal(original.size, heic.length + mp4.length + 8);
  const still = new File([heic], 'static.heic');
  assert.equal(await splitEmbeddedMotion(still), undefined);
});
