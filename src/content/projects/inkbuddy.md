---
title: InkBuddy
summary: "在阅读器自带的浏览器打开局域网地址，即可查看同步歌词和粤拼。"
repo: https://github.com/mh567/inkbuddy
tags: [macOS, 墨水屏]
status: active
order: 3
site:
  slug: inkbuddy
  headline: 让闲置墨水屏显示 Mac 上的歌词
  platform: macOS · 墨水屏浏览器
  accent: "#846744"
  icon: /project-media/inkbuddy-icon.svg
  image:
    src: /project-media/inkbuddy.webp
    alt: 墨水屏界面的示例歌词与粤拼注音
    width: 540
    height: 600
    caption: 墨水屏界面预览，使用示例歌词
  actions:
    - label: 查看安装指南
      href: "#install"
  sections:
    - id: install
      title: 安装与连接
      description: 在 Apple Silicon Mac 上打开 DMG，将 InkBuddy 拖到「应用程序」并启动。在同一局域网内，用墨水屏阅读器的浏览器打开 InkBuddy 提供的地址。
      requirements:
        - 安装包适用于 Apple Silicon Mac，macOS 12 或更新版本
        - 从源码安装需准备 Rust 工具链，运行仓库中的 ./scripts/install.sh
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

### 跟着音乐看歌词

在墨水屏上查看同步歌词。粤语歌词可带粤拼，方便跟读。

### 用阅读器自带的浏览器连接

由 Mac 生成展示页面，阅读器打开局域网地址即可。可在 InkBuddy 里选择歌词或时钟，也可将两个插件组合在同一页。
