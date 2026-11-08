import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

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
  }),
});

/**
 * 短帖。字段对齐 JSON Feed 1.1 与 Memos 的 Memo 结构：
 * date / content(正文) / images[] / kind / tags。
 * 之后若把数据源换成 Memos，渲染层不用改。
 */
const notes = defineCollection({
  loader: glob({ base: './src/content/notes', pattern: '**/*.md' }),
  schema: z.object({
    date: z.coerce.date(),
    kind: z.enum(['note', 'link', 'photo', 'quote', 'release']).default('note'),
    tags: z.array(z.string()).default([]),
    images: z.array(z.string()).default([]),
    link: z.url().optional(), // kind=link 时指向的外部地址
    title: z.string().optional(), // 可选标题，短帖通常不写
    draft: z.boolean().default(false),
  }),
});

export const collections = { projects, notes };
