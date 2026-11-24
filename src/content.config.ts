import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '请使用小写字母、数字或连字符');
const webUrl = z.url({ protocol: /^https?$/ });
const localImage = z.string().refine((path) => {
  if (!path.startsWith('/')) return false;
  try {
    return path.slice(1).split('/').every((part) => {
      const name = decodeURIComponent(part);
      return name && name !== '.' && name !== '..' && !/[/?#\\\u0000-\u001f\u007f]/.test(name);
    });
  } catch {
    return false;
  }
}, '图片须使用站内文件路径，例如 /uploads/project.png');
const picture = z.object({
  src: localImage,
  alt: z.string().trim().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  caption: z.string().optional(),
});
const externalLink = z.object({ label: z.string().trim().min(1), href: webUrl });

const projectSite = z.object({
  slug,
  headline: z.string().trim().min(1),
  platform: z.string().optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4a7099'),
  icon: localImage.optional(),
  image: picture.optional(),
  shareImage: localImage.optional(),
  actions: z.array(externalLink.extend({
    href: z.union([webUrl, z.string().regex(/^#[a-z0-9]+(?:-[a-z0-9]+)*$/)]),
  })).min(1),
  sections: z.array(z.object({
    id: slug,
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    requirements: z.array(z.string()).default([]),
    image: picture.optional(),
    links: z.array(externalLink).default([]),
  })).default([]),
  links: z.array(externalLink).default([]),
}).superRefine((site, ctx) => {
  const ids = new Set(['features', 'main-content']);
  for (const [index, section] of site.sections.entries()) {
    if (ids.has(section.id)) {
      ctx.addIssue({ code: 'custom', path: ['sections', index, 'id'], message: `重复或保留的章节 ID：${section.id}` });
    }
    ids.add(section.id);
  }
  for (const [index, action] of site.actions.entries()) {
    if (action.href.startsWith('#') && !site.sections.some(({ id }) => action.href === `#${id}`)) {
      ctx.addIssue({ code: 'custom', path: ['actions', index, 'href'], message: `章节不存在：${action.href}` });
    }
  }
});

/**
 * 项目入口。每个项目一个 Markdown 文件，正文可选（写详细介绍时用）。
 * 字段刻意保持克制：名称 + 一句话 + 链接是底线，其余按需。
 */
const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(), // 一句话，建议不超过 15 个词
    url: z.url().optional(), // 线上地址
    repo: z.url().optional(), // 仓库地址
    tags: z.array(z.string()).default([]), // 技术栈 / 关键词
    status: z.enum(['active', 'maintained', 'wip', 'archived']).default('active'),
    featured: z.boolean().default(false), // 是否在首页精选区展示
    order: z.number().default(0), // 越小越靠前
    started: z.coerce.date().optional(),
    cover: z.string().optional(), // 截图路径，如 /uploads/xxx.png
    site: projectSite.optional(),
  }),
});

/**
 * 短帖。一条随记就是一段正文，图片、外链、标签都是它的元素，
 * 不区分类型。字段对齐 JSON Feed 1.1 与 Memos 的 Memo 结构：
 * date / content(正文) / images[] / tags。
 */
const notes = defineCollection({
  loader: glob({ base: './src/content/notes', pattern: '**/*.md' }),
  schema: z.object({
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    images: z.array(z.string()).default([]),
    link: z.url().optional(), // 正文里附带的外部地址
    title: z.string().optional(), // 可选标题，短帖通常不写
    draft: z.boolean().default(false),
  }),
});

export const collections = { projects, notes };
