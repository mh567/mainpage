---
title: InkBuddy
summary: "把闲置墨水屏变成 Mac 副屏，打开局域网地址即可查看同步歌词、时钟与 AI 额度。"
repo: https://github.com/mh567/inkbuddy
tags: [macOS, 墨水屏]
status: active
order: 3
site:
  slug: inkbuddy
  headline: 把闲置墨水屏变成 Mac 的副屏
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
    - label: 下载 macOS 版
      href: https://github.com/mh567/inkbuddy/releases/latest/download/InkBuddy-macOS-arm64.dmg
  sections:
    - id: install
      title: 安装与连接
      description: 在 Apple Silicon Mac 上打开 DMG，将 InkBuddy 拖到「应用程序」并启动。菜单栏 app 内嵌服务与视图编辑器，支持扩展管理与一键更新；同一局域网内用墨水屏浏览器打开提供的地址即可。
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

### 歌词、时钟与 AI 额度看板

内置同步歌词（支持粤语粤拼注音）、多样式时钟（经典、点阵、台历），以及 Codex、Command Code、Antigravity 等本机 AI 额度看板插件。也可按 JSON/stdio 协议编写自定义插件扩展内容。

### 视图排版与局域网直连

在 macOS 菜单栏 app 中通过「视图」系统拖拽调整各插件的区域位置与大小，并实时预览最终效果；墨水屏阅读器无需安装应用，用自带浏览器打开局域网地址即可展示，全屏状态下点按左右区域即可切换视图。
