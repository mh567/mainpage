import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseProject, serializeProject } from '../src/lib/content.ts';

const read = (path) => readFileSync(new URL(`../dist/${path}`, import.meta.url), 'utf8');

test('admin preserves the full site configuration when editing and moving a project', () => {
  const source = readFileSync(new URL('../src/content/projects/aria-pilot.md', import.meta.url), 'utf8');
  const doc = parseProject(source);
  const updated = serializeProject({ ...doc, meta: { ...doc.meta, order: 8, title: 'AriaPilot Download' } });
  assert.match(updated, /^title: AriaPilot Download$/m);
  assert.match(updated, /^order: 8$/m);
  assert.equal(updated.split('\nsite:\n')[1], source.split('\nsite:\n')[1]);
});

test('homepage links to three project sites and keeps existing external links', () => {
  const home = read('index.html');
  for (const slug of ['habu', 'ariapilot', 'inkbuddy']) {
    assert.equal([...home.matchAll(new RegExp(`href="/${slug}/"`, 'g'))].length, 1, slug);
  }
  assert.doesNotMatch(home, /AriaPilot for fnOS/);
  assert.match(home, /href="https:\/\/pabu\.emolu\.cn"/);
  assert.match(home, /href="https:\/\/blog\.emolu\.cn"/);
});

test('project pages have distinct metadata and valid local images and anchors', () => {
  for (const slug of ['habu', 'ariapilot', 'inkbuddy']) {
    const page = read(`${slug}/index.html`);
    assert.ok(page.includes(`rel="canonical" href="https://emolu.cn/${slug}/"`), slug);
    assert.match(page, /property="og:image"/);
    assert.equal([...page.matchAll(/<h1[ >]/g)].length, 1);
    for (const [, anchor] of page.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(page.includes(`id="${anchor}"`), `${slug}#${anchor}`);
    }
    for (const [, src] of page.matchAll(/<img[^>]* src="(\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(`../dist${src}`, import.meta.url)), src);
    }
  }
});

test('one AriaPilot page exposes both platforms and all three artifacts', () => {
  const page = read('ariapilot/index.html');
  assert.match(page, /href="#macos"/);
  assert.match(page, /href="#fnos"/);
  assert.match(page, /href="https:\/\/github\.com\/mh567\/AriaPilot\/releases\/download\/[^"]+\.zip"/);
  assert.match(page, /href="https:\/\/github\.com\/mh567\/AriaPilot-fnos\/releases\/download\/[^"]+_x86\.fpk"/);
  assert.match(page, /href="https:\/\/github\.com\/mh567\/AriaPilot-fnos\/releases\/download\/[^"]+_arm\.fpk"/);
  assert.equal(existsSync(new URL('../dist/ariapilot-fnos/index.html', import.meta.url)), false);
});

test('demo, installation, notes, RSS and admin remain reachable from static output', () => {
  assert.match(read('habu/index.html'), /href="https:\/\/habu\.emolu\.cn\/demo\/"/);
  assert.match(read('inkbuddy/index.html'), /InkBuddy-macOS-arm64\.dmg/);
  assert.match(read('inkbuddy/index.html'), /href="https:\/\/github\.com\/mh567\/inkbuddy"/);
  assert.match(read('rss.xml'), /<rss/);
  assert.match(read('notes/2026-11-08-hello/index.html'), /2026/);
  assert.match(read('admin/index.html'), /id="project-form"/);
});
