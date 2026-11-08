# mainpage

个人主页：项目入口展示 + 短帖流，两者在同一个站点内。

## 技术栈

- [Astro 6](https://astro.build/)：静态生成，默认全站预渲染
- Content Collections：`projects` / `notes` 两个集合，用 Zod 校验 frontmatter
- [Decap CMS](https://decapcms.org)：`/admin` 后台，浏览器里编辑 Markdown
- 单页结构：顶部玻璃面板承载短帖时间线，下方是项目玻璃卡片，没有分页和导航
- 视觉：夜间玻璃拟态。深墨夜景底 + 两到三个大半径柔光斑，玻璃面板靠 backdrop-blur 取背影色，唯一强调色香槟金只给主 CTA 与项目计数

## 目录结构

```
src/
  content.config.ts        两个集合的加载器与 schema
  content/
    projects/*.md          项目入口，一个项目一个文件
    notes/*.md             短帖，一个帖子一个文件
  components/
    ProjectTile.astro      项目小格子
    NoteItem.astro         单条短帖（含渲染 Markdown）
    Timeline.astro         短帖时间线
  layouts/Base.astro       页面骨架与页脚
  pages/
    index.astro            单页：玻璃面板时间线 + 项目卡片
    notes/[...id].astro    单条短帖的永久链接
    rss.xml.js             RSS 2.0
  styles/global.css        全站样式（夜间玻璃拟态，固定深色）
public/
  admin/                   Decap CMS 后台入口
  uploads/                 图片上传目录
```

## 环境要求

Node.js ≥ 22.12（Astro 6 的最低要求）。

## 本地运行

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # 输出到 dist/
npm run preview      # 预览构建结果
```

## 后台（Decap CMS）

本地开发时，另开一个终端跑代理服务：

```bash
npx decap-server     # 监听 8081
```

然后打开 `http://localhost:4321/admin/index.html`（Astro 的 dev server 不会把 `/admin/` 解析到目录索引，用完整路径即可；部署到静态托管后 `/admin/` 会正常工作）。`config.yml` 里的 `local_backend: true` 会让它走本地代理，直接把改动写进仓库里的 Markdown 文件。

**上线到生产**：`backend.repo` 已设为 `mh567/mainpage`。GitHub 后端还必须配一个 OAuth 代理，把地址填到 `backend.base_url`。具体见下面「部署」一节。

## 内容怎么写

一条短帖就是 `src/content/notes/` 下的一个 Markdown 文件：

```markdown
---
date: 2026-11-08
kind: note          # note | link | photo | quote | release
tags: [建站]
draft: false
---

正文写在这里。图片放在 `public/uploads/`，在 frontmatter 的
`images` 里写 `/uploads/文件名` 即可。
```

项目同理，见 `src/content/projects/` 下的示例。

## 数据模型与后续换后端

短帖的字段刻意对齐 JSON Feed 1.1 与 Memos 的 `Memo`：

```
date / content(正文) / images[] / kind / tags
```

所以之后如果发帖频率变高、想要手机随手发，可以把数据源从「读 Markdown」换成「读自托管 Memos 的 `/api/memos`」，渲染层（`NoteItem` / `Timeline`）基本不用改。

注意：Memos 必须独占一个子域名（官方不支持子路径部署），接口返回的 JSON 由构建期或运行时拉取，访客看不到子域名。

## 部署：GitHub Pages + emolu.cn

- 仓库：`mh567/mainpage`
- 站点地址：`https://emolu.cn`
- 构建产物：`dist/`
- 工作流：`.github/workflows/deploy.yml`（push 到 `main` 自动构建并发布）
- `public/CNAME` 内容为 `emolu.cn`，构建后会出现在 `dist/CNAME`

### 一次性设置

1. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**
2. 等第一次 Actions 跑完
3. 仍在 Settings → Pages，Custom domain 填 `emolu.cn`，保存
4. 域名 DNS 生效后勾选 **Enforce HTTPS**

### DNS（apex 记录）

在 emolu.cn 的 DNS 服务商处添加：

```
A     185.199.108.153
A     185.199.109.153
A     185.199.110.153
A     185.199.111.153
AAAA  2606:50c0:8000::153
AAAA  2606:50c0:8001::153
AAAA  2606:50c0:8002::153
AAAA  2606:50c0:8003::153
```

`blog.emolu.cn` 保持现有的 CNAME 不变，它指向用户站 `mh567.github.io`。GitHub Pages 允许项目站单独覆盖自定义域名，所以新的项目站可以占用 apex `emolu.cn`，两者互不影响。

### 后台 OAuth

Decap 的 GitHub 后端需要一个 OAuth 代理。两种做法：

- 用 Cloudflare Worker 跑一个代理，把地址填到 `public/admin/config.yml` 的 `backend.base_url`
- 或把站点迁到 Netlify，用 Netlify Identity + Git Gateway，不需要自己写代理
