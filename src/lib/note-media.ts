export const NOTE_MEDIA_SOURCE = 'src/assets/note-media';

export function isHeic(filename: string): boolean {
  return /\.hei[cf]$/i.test(filename);
}

export function isHeicFile(file: File): boolean {
  return isHeic(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type);
}

export function groupNoteMedia(files: File[]) {
  const stills = files.filter((file) =>
    file.type.startsWith('image/') || /\.(?:heic|heif|jpe?g|png|gif|webp|avif)$/i.test(file.name),
  );
  const videos = files.filter((file) => /\.(?:mov|mp4)$/i.test(file.name));
  const stem = (file: File) => file.name.replace(/\.[^.]+$/, '').toLowerCase();
  const used = new Set<File>();

  const items = stills.map((image) => {
    const name = stem(image);
    const matching = videos.filter((video) => stem(video) === name);
    const motion = matching.length === 1 && stills.filter((still) => stem(still) === name).length === 1
      ? matching[0]
      : undefined;
    if (motion) used.add(motion);
    return { image, motion };
  });

  return { items, hasUnpairedMotion: used.size !== videos.length };
}

export function noteMedia(src: string): { image: string; motion?: string } {
  const path = /^\/(media|uploads)\/([a-z0-9_-][a-z0-9_.-]*)$/i.exec(src);
  if (!path) return { image: src };

  const [, directory, filename] = path;
  const image = isHeic(filename) ? '/media/' + filename + '.jpg' : src;
  const stem = directory === 'media' && /^([a-z0-9_-]+\.live)\.[a-z0-9]+$/i.exec(filename);
  return stem ? { image, motion: '/media/' + stem[1] + '.mp4' } : { image };
}
