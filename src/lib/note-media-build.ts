import { readFile } from 'node:fs/promises';
import { findEmbeddedMotion } from './motion-photo';
import { isHeic, noteMedia } from './note-media';

const legacyRanges = new Map<string, Promise<ReturnType<typeof findEmbeddedMotion>>>();

export async function noteMediaForBuild(src: string) {
  const local = /^\/(media|uploads)\/([a-z0-9_-][a-z0-9_.-]*\.(?:hei[cf]|avif|jpe?g|png|webp))$/i.exec(src);
  const thumbnail = local ? `/media/thumb-${local[1]}~${local[2]}.webp` : undefined;
  const media = { ...noteMedia(src), thumbnail };
  const name = /^\/uploads\/([a-z0-9_-][a-z0-9_.-]*\.(?:heic|heif|avif|jpe?g))$/i.exec(src)?.[1];
  if (!name) return { ...media, range: undefined };

  if (!legacyRanges.has(src)) {
    legacyRanges.set(src, readFile('public/uploads/' + name).then(findEmbeddedMotion, (error) => {
      if (error.code !== 'ENOENT') throw error;
    }));
  }
  const range = await legacyRanges.get(src);
  if (!range) return { ...media, range };

  return {
    ...media,
    image: isHeic(name) ? media.image : '/media/' + name,
    motion: '/media/' + name + '.mp4',
    range,
  };
}
