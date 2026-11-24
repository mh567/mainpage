---
title: AriaPilot
summary: 用内置 aria2 直接下载，也可连接已有的远程服务。
repo: https://github.com/mh567/AriaPilot
tags: [macOS, fnOS, 下载]
status: active
order: 4
started: 2026-11-07
site:
  slug: ariapilot
  headline: 在 Mac 或飞牛 NAS 上管理下载
  platform: macOS · 飞牛 fnOS
  accent: "#3265bd"
  icon: /project-media/ariapilot-icon.webp
  image:
    src: /project-media/ariapilot-macos.webp
    alt: AriaPilot macOS 菜单栏和下载任务窗口的产品示意
    width: 1280
    height: 720
    caption: macOS 版产品示意，来自项目仓库
  actions:
    - label: macOS 版
      href: "#macos"
    - label: 飞牛 fnOS 版
      href: "#fnos"
  sections:
    - id: macos
      title: macOS 版
      description: 在菜单栏查看速度和下载状态，需要批量查看任务时打开独立窗口。下载 ZIP，解压后将 AriaPilot 拖到「应用程序」。
      requirements:
        - macOS 13 或更新版本
        - Apple Silicon Mac
      image:
        src: /project-media/ariapilot-menu.webp
        alt: AriaPilot 菜单栏面板示意，显示任务名称、进度和下载速度
        width: 366
        height: 367
        caption: macOS 菜单栏面板示意
      links:
        - label: 下载 macOS 版 · ZIP
          href: https://github.com/mh567/AriaPilot/releases/download/v1.5.3/AriaPilot-v1.5.3-macos.zip
        - label: 版本发布
          href: https://github.com/mh567/AriaPilot/releases
        - label: 使用说明
          href: https://github.com/mh567/AriaPilot/blob/main/docs/USER_GUIDE.md
    - id: fnos
      title: 飞牛 fnOS 版
      description: 在飞牛桌面或浏览器里查看任务和实时速度。下载与 NAS 架构对应的 FPK，在飞牛应用中心手动安装。
      requirements:
        - fnOS 1.1.8 或更新版本
        - 应用中心的 nodejs_v22 运行时和可写的授权目录
      image:
        src: /project-media/ariapilot-fnos.webp
        alt: AriaPilot fnOS 版的进行中任务列表，显示进度、速度和剩余时间
        width: 1120
        height: 680
        caption: fnOS 版界面，使用示例下载任务
      links:
        - label: 下载 x86 FPK
          href: https://github.com/mh567/AriaPilot-fnos/releases/download/v1.0.9/ariapilot_1.0.9_x86.fpk
        - label: 下载 ARM64 FPK
          href: https://github.com/mh567/AriaPilot-fnos/releases/download/v1.0.9/ariapilot_1.0.9_arm.fpk
        - label: 版本发布
          href: https://github.com/mh567/AriaPilot-fnos/releases
        - label: 安装与配置
          href: https://github.com/mh567/AriaPilot-fnos/blob/main/docs/FNOS.md
  links:
    - label: GitHub · fnOS
      href: https://github.com/mh567/AriaPilot-fnos
---

### 随时查看下载进度

查看正在运行的任务、速度和进度。在应用里添加、暂停或继续任务。

### 连接你使用的下载服务

直接使用内置的 aria2，也可连接已经启用 JSON RPC 的远程 aria2 服务。
