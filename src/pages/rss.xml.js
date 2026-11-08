import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const notes = (await getCollection('notes', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const items = notes.map((note) => ({
    title: note.data.title ?? `${note.data.kind} · ${note.id}`,
    pubDate: note.data.date,
    link: `/notes/${note.id}/`,
    description: note.body?.trim() ?? '',
    categories: note.data.tags,
  }));

  return rss({
    title: 'harris',
    description: '个人项目与短帖',
    site: context.site ?? 'https://emolu.cn',
    items,
    customData: '<language>zh-cn</language>',
  });
}
