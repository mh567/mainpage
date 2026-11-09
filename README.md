# mainpage

个人主页：项目入口展示 + 短帖流，两者在同一个站点内。

## 技术栈

- [Astro 6](https://astro.build/)：静态生成，默认全站预渲染
- Content Collections：`projects` / `notes` 两个集合，用 Zod 校验 frontmatter
- 自建轻量后台 `/admin`：浏览器里发帖、改项目，直接提交到 GitHub
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
    admin.astro            内容管理后台
    notes/[...id].astro    单条短帖的永久链接
    rss.xml.js             RSS 2.0
  lib/
    content.ts             frontmatter 解析与写回
    github.ts              GitHub Contents API 封装
  scripts/admin.ts         后台交互逻辑
  styles/
    global.css             全站样式（夜间玻璃拟态，固定深色）
    admin.css              后台样式
public/
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

## 后台（/admin）

后台是一个纯静态页面，浏览器直接调用 GitHub Contents API，把改动提交到 `mh567/mainpage` 的 `main` 分支，Actions 随后部署，通常 1 分钟左右生效。不需要服务器，也不需要 OAuth 代理。

打开 `http://localhost:4321/admin/` 或线上 `https://emolu.cn/admin/`，第一次进入会弹设置面板，填一个 token：

**细粒度 token（推荐）**

点面板里的「打开预填好的创建页」，名称、有效期和 `Contents: write` 已经带好：

1. 在打开的页面里，Repository access 选 **Only select repositories**，勾选 `mh567/mainpage`
2. 确认 Permissions → Repository permissions → **Contents** 是 `Read and write`
3. 点 Generate token，把 `github_pat_…` 粘回来

新版页面把权限收进了每行的下拉，列表里不会单独出现「Read and write」，Contents 那一行选到 `Read and write` 就行。预填链接用的是 GitHub 官方支持的 `contents=write` 参数，打开后可以再核对一眼。

**classic token**

用 [Tokens (classic)](https://github.com/settings/tokens/new?scopes=repo) 生成，只勾 `repo` 一项。`ghp_…` 开头，权限比细粒度粗，能用但不如前者可控。

两种 token 后台都支持，连接时会自动校验有没有写权限。

token 只存在当前浏览器里（`localStorage`，键名 `emolu.admin.token`），除了 GitHub 不会发往别处。换设备或清空浏览器数据后需要重新填一次。「设置」里可以随时清除。

设置面板里的「记住这台设备」默认勾选。取消勾选后 token 改存到 `sessionStorage`，当前标签页刷新还在，关掉标签页就失效，适合在别人的电脑上用。

后台能做的事情：

- **发帖**：正文、标签、图片、外链、草稿；`⌘/Ctrl + Enter` 直接发布。图片可以点按钮选、粘贴或拖进窗口
- **图片排序**：多图时缩略图上带序号，拖拽即换顺序；键盘用户可聚焦缩略图后按 `Alt + ←/→`
- **短帖**：列表、编辑、删除、跳转线上页面
- **项目**：新建、编辑、删除；在列表里拖拽卡片调整顺序
- 排序会一次性提交所有改动的文件，几个项目换位置只产生一个 commit
- 草稿自动保存在本地，关掉页面再回来还在
- 大图会在浏览器里压到最长边 1600px 再上传
- 提交后状态栏会盯着这次提交对应的 Actions 运行，构建完成才提示「已上线」，失败则给 Actions 链接

## 内容怎么写

一条短帖就是 `src/content/notes/` 下的一个 Markdown 文件。短帖不分类型，正文写什么就是什么，图片、外链、标签都是它的元素：

```markdown
---
date: 2026-11-08
tags: [建站]
images:
  - /uploads/a.png
  - /uploads/b.png
link: https://example.com
draft: false
---

正文写在这里。
```

图片放在 `public/uploads/`，在 frontmatter 的 `images` 里按想要的顺序写 `/uploads/文件名`。`images` 的数组顺序就是展示顺序，后台可以直接拖拽调整。

项目同理，见 `src/content/projects/` 下的示例。`order` 决定卡片顺序，后台在项目列表里拖拽即可，会自动重排这个字段。

## 图片排版

`MediaGrid` 按图片数量选布局，规则和发朋友圈一致：

| 数量 | 排版 |
|---|---|
| 1 张 | 单图限宽限高（最长边约 260 / 200），不铺满整行 |
| 2 张 | 并排两列 |
| 3 张 | 三列 |
| 4 张 | 2×2 |
| 5 张及以上 | 三列 + 右下角「+N」 |

单图会限制尺寸，是因为一张大图会直接把时间线撑开，浏览时要滚很久才能看到下一条。

## 数据模型与后续换后端

短帖的字段刻意对齐 JSON Feed 1.1 与 Memos 的 `Memo`：

```
date / content(正文) / images[] / tags
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
