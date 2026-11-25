import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { isHeic, noteMedia, NOTE_MEDIA_SOURCE } from '../../lib/note-media';

type MediaFile = { source: string; format: 'jpeg' | 'mp4' | 'original' };

export const getStaticPaths = (async () => {
  const notes = await getCollection('notes', ({ data }) => !data.draft);
  const assets = new Map<string, MediaFile>();
  for (const note of notes) {
    for (const src of note.data.images) {
      const { image, motion } = noteMedia(src);
      const name = src.split('/').at(-1)!;
      if (image !== src || motion) {
        const directory = src.startsWith('/media/') ? NOTE_MEDIA_SOURCE : 'public/uploads';
        assets.set(image.slice('/media/'.length), {
          source: join(directory, name),
          format: isHeic(name) ? 'jpeg' : 'original',
        });
      }
      if (motion) {
        const filename = motion.slice('/media/'.length);
        assets.set(filename, {
          source: join(NOTE_MEDIA_SOURCE, filename.replace(/\.mp4$/, '.mov')),
          format: 'mp4',
        });
      }
    }
  }
  return Array.from(assets, ([file, props]) => ({ params: { file }, props }));
}) satisfies GetStaticPaths;

const run = promisify(execFile);
const imageTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

export const GET: APIRoute = async ({ props }) => {
  const { source, format } = props as MediaFile;
  if (format === 'original') {
    const extension = source.split('.').at(-1) ?? '';
    return new Response(new Uint8Array(await readFile(source)), {
      headers: { 'Content-Type': imageTypes[extension.toLowerCase()] ?? 'application/octet-stream' },
    });
  }

  const directory = await mkdtemp(join(tmpdir(), 'note-media-'));
  try {
    const input = resolve(source);
    const output = join(directory, format === 'jpeg' ? 'photo.jpg' : 'motion.mp4');
    const options = { timeout: 120_000 };
    if (format === 'jpeg') {
      await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', input, '--out', output], options);
    } else {
      await run('avconvert', ['--source', input, '--preset', 'Preset1280x720', '--output', output], options);
    }
    return new Response(new Uint8Array(await readFile(output)), {
      headers: { 'Content-Type': format === 'jpeg' ? 'image/jpeg' : 'video/mp4' },
    });
  } catch (error) {
    throw new Error('无法转换图片附件 ' + source + '。请检查源文件，并在 macOS 上构建。', { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
