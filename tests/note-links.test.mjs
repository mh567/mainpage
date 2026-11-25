import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLinkMetadata } from '../src/lib/note-link.ts';

test('reads the share title and resolves the site icon against the final page URL', () => {
  const result = readLinkMetadata(`
    <title>Page title</title>
    <meta content="Tom &amp; Jerry" property="og:title">
    <link href="../favicon.svg?x=1&amp;y=2" rel="icon">
  `, new URL('https://example.com/docs/page/'));

  assert.deepEqual(result, {
    title: 'Tom & Jerry',
    icon: 'https://example.com/docs/favicon.svg?x=1&y=2',
  });
});

test('uses the document title when share metadata is missing and ignores unsafe icons', () => {
  const result = readLinkMetadata(`
    <title>  Project
    documentation </title>
    <link rel="icon" href="javascript:alert(1)">
    <link rel="icon" href="/favicon.png">
  `, new URL('https://example.com/docs/'));

  assert.deepEqual(result, {
    title: 'Project documentation',
    icon: 'https://example.com/favicon.png',
  });
});

test('the homepage and detail page render a title and hide the destination from link text', () => {
  const href = 'https://github.com/LNPANDY/NX2Apple';
  const output = [
    '../dist/index.html',
    '../dist/notes/2026-11-10-switch2/index.html',
  ];
  for (const path of output) {
    const html = readFileSync(new URL(path, import.meta.url), 'utf8');
    const link = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
      .find(([anchor]) => anchor.includes(`class="note-link"`) && anchor.includes(`href="${href}"`));
    assert.ok(link, path);
    assert.match(link[1], /GitHub/);
    assert.match(link[1], /<img[^>]+favicon\.svg/);
    assert.doesNotMatch(link[1].replace(/<[^>]*>/g, ''), /https?:\/\//);
  }
});
