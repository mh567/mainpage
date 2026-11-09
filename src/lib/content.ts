export interface NoteMeta {
  date: string;
  title: string;
  images: string[];
  link: string;
  tags: string[];
  draft: boolean;
}

export interface NoteDoc {
  meta: NoteMeta;
  body: string;
}

export type ProjectStatus = 'active' | 'maintained' | 'wip' | 'archived';

export const PROJECT_STATUSES: ProjectStatus[] = [
  'active',
  'maintained',
  'wip',
  'archived',
];

export interface ProjectMeta {
  title: string;
  summary: string;
  url: string;
  repo: string;
  tags: string[];
  status: ProjectStatus;
  featured: boolean;
  order: number;
  started: string;
  cover: string;
}

export interface ProjectDoc {
  meta: ProjectMeta;
  body: string;
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

type Raw = Record<string, string | string[]>;

function unquote(value: string): string {
  const text = value.trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  }
  return text;
}

function splitInlineList(value: string): string[] {
  const inner = value.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

function readFrontmatter(source: string): { raw: Raw; body: string } {
  const match = FRONTMATTER.exec(source);
  if (!match) return { raw: {}, body: source.trim() };

  const raw: Raw = {};
  let key: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const bucket = raw[key];
      if (Array.isArray(bucket)) bucket.push(unquote(item[1]));
      else raw[key] = [unquote(item[1])];
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;

    const [, name, rest] = pair;
    const value = rest.trim();
    if (value === '') {
      raw[name] = [];
      key = name;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      raw[name] = splitInlineList(value);
      key = null;
    } else {
      raw[name] = unquote(value);
      key = null;
    }
  }

  return { raw, body: source.slice(match[0].length).trim() };
}

function text(raw: Raw, key: string): string {
  const value = raw[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function list(raw: Raw, key: string): string[] {
  const value = raw[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function flag(raw: Raw, key: string): boolean {
  return text(raw, key).toLowerCase() === 'true';
}

function numeric(raw: Raw, key: string): number {
  const value = Number(text(raw, key));
  return Number.isFinite(value) ? value : 0;
}

function isoDate(raw: Raw, key: string): string {
  const value = text(raw, key);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function yamlScalar(value: string): string {
  const plain =
    /^[A-Za-z0-9\u4e00-\u9fff/][A-Za-z0-9\u4e00-\u9fff ._/:+-]*$/.test(value) &&
    !value.endsWith(' ') &&
    !/:\s/.test(value);
  return plain ? value : JSON.stringify(value);
}

function blockList(key: string, values: string[]): string[] {
  return [key + ':', ...values.map((value) => '  - ' + yamlScalar(value))];
}

export function parseNote(source: string): NoteDoc {
  const { raw, body } = readFrontmatter(source);

  return {
    meta: {
      date: isoDate(raw, 'date'),
      title: text(raw, 'title'),
      images: list(raw, 'images'),
      link: text(raw, 'link'),
      tags: list(raw, 'tags'),
      draft: flag(raw, 'draft'),
    },
    body,
  };
}

export function serializeNote(doc: NoteDoc): string {
  const { meta } = doc;
  const lines = ['---', `date: ${meta.date}`];

  if (meta.title.trim()) lines.push(`title: ${yamlScalar(meta.title.trim())}`);
  if (meta.tags.length) {
    lines.push(`tags: [${meta.tags.map(yamlScalar).join(', ')}]`);
  }
  if (meta.images.length) lines.push(...blockList('images', meta.images));
  if (meta.link.trim()) lines.push(`link: ${yamlScalar(meta.link.trim())}`);
  if (meta.draft) lines.push('draft: true');

  lines.push('---', '');
  if (doc.body.trim()) lines.push(doc.body.trim());

  return lines.join('\n') + '\n';
}

export function parseProject(source: string): ProjectDoc {
  const { raw, body } = readFrontmatter(source);
  const status = text(raw, 'status') as ProjectStatus;

  return {
    meta: {
      title: text(raw, 'title'),
      summary: text(raw, 'summary'),
      url: text(raw, 'url'),
      repo: text(raw, 'repo'),
      tags: list(raw, 'tags'),
      status: PROJECT_STATUSES.includes(status) ? status : 'active',
      featured: flag(raw, 'featured'),
      order: numeric(raw, 'order'),
      started: isoDate(raw, 'started'),
      cover: text(raw, 'cover'),
    },
    body,
  };
}

export function serializeProject(doc: ProjectDoc): string {
  const { meta } = doc;
  const lines = ['---', `title: ${yamlScalar(meta.title.trim())}`];

  lines.push(`summary: ${yamlScalar(meta.summary.trim())}`);
  if (meta.url.trim()) lines.push(`url: ${yamlScalar(meta.url.trim())}`);
  if (meta.repo.trim()) lines.push(`repo: ${yamlScalar(meta.repo.trim())}`);
  if (meta.tags.length) {
    lines.push(`tags: [${meta.tags.map(yamlScalar).join(', ')}]`);
  }
  lines.push(`status: ${meta.status}`);
  if (meta.featured) lines.push('featured: true');
  if (meta.order !== 0) lines.push(`order: ${meta.order}`);
  if (meta.started) lines.push(`started: ${meta.started}`);
  if (meta.cover.trim()) lines.push(`cover: ${yamlScalar(meta.cover.trim())}`);

  lines.push('---', '');
  if (doc.body.trim()) lines.push(doc.body.trim());

  return lines.join('\n') + '\n';
}
