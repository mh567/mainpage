---
title: InkBuddy
summary: "让闲置墨水屏变成 Mac 副屏，打开浏览器即可查看歌词、时钟与 AI 额度。"
repo: https://github.com/mh567/inkbuddy
tags: [macOS, 墨水屏]
status: active
order: 3
site:
  slug: inkbuddy
  headline: 让墨水屏成为 Mac 副屏
  platform: macOS · 墨水屏浏览器
  accent: "#846744"
  icon: /project-media/inkbuddy-icon.svg
  image:
    src: /project-media/inkbuddy-hero.webp
    alt: 墨水屏界面的同步歌词预览
    width: 620
    height: 760
    caption: 墨水屏界面预览，使用示例歌词
  actions:
    - label: 查看安装指南
      href: "#install"
    - label: 下载 macOS 版
      href: https://github.com/mh567/inkbuddy/releases/latest/download/InkBuddy-macOS-arm64.dmg
  sections:
    - id: views
      title: 视图排版
      description: 将多个模块自由放进屏幕的不同区域，在 Mac 上拖拽调整位置与比例，全屏时轻点屏幕左右两侧即可切换视图。
      image:
        src: /project-media/inkbuddy-split-frame.webp
        alt: 点阵时钟与 AI 额度组合在同一个墨水屏视图中的界面预览
        width: 620
        height: 760
        caption: 点阵时钟与 AI 额度组合视图预览
    - id: quota
      title: AI 额度
      description: 支持 AI 额度的查看，目前已支持 Codex、Command Code 与 Gemini。用简洁直观的进度条展示可用额度与重置时间，随时掌握使用余量。
      image:
        src: /project-media/inkbuddy-quota-frame.webp
        alt: 墨水屏上的 Codex、Command Code 与 Gemini 额度看板预览
        width: 620
        height: 760
        caption: Codex、Command Code 与 Gemini 额度同屏展示
    - id: clock
      title: 时钟样式
      description: 提供经典、点阵与台历三种时钟样式，在墨水屏上呈现安静、克制的桌面日历质感。
      image:
        src: /project-media/inkbuddy-calendar-frame.webp
        alt: 墨水屏台历时钟样式预览，显示年月、今日日期、星期与时间
        width: 620
        height: 760
        caption: 台历样式时钟界面预览
    - id: install
      title: 安装与连接
      description: 打开安装包，将 InkBuddy 拖入「应用程序」启动。在同一局域网内，用墨水屏阅读器自带浏览器打开给出的地址即可使用。
      requirements:
        - 适用于 Apple Silicon Mac，macOS 12 或更新版本
        - 如需从源码安装，可运行仓库中的 ./scripts/install.sh
      links:
        - label: 下载 Apple Silicon 版 · DMG
          href: https://github.com/mh567/inkbuddy/releases/latest/download/InkBuddy-macOS-arm64.dmg
        - label: 源码安装说明
          href: https://github.com/mh567/inkbuddy#快速开始
  links:
    - label: 版本发布
      href: https://github.com/mh567/inkbuddy/releases
    - label: 问题反馈
      href: https://github.com/mh567/inkbuddy/issues
---

### 歌词、时钟与 AI 额度

支持同步歌词、多样式时钟与 AI 额度的查看。目前已支持：

- **Codex**
- **Command Code**
- **Gemini**

把日常需要留意的信息安静地留在手边，不打扰专注。

### 自由排版，打开即用

在 Mac 上自由组合各模块的屏幕位置与大小，阅读器无需安装任何应用，用自带浏览器打开局域网地址即可呈现。
