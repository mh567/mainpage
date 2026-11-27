import { getCollection } from 'astro:content';

export const NOTES_PER_PAGE = 20;

export async function getPublishedNotes() {
  return (await getCollection('notes', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
}
