# AI播放器 0.6.1 多端验证状态

本文件只记录实际证据。能编译、能同步工程、能生成安装包和能在真机完整使用是四种不同结论。

## 当前结论（2026-07-21）

| 端 | 已验证 | 尚未验证 / 阻塞 |
|---|---|---|
| Windows 11 x64 | 131/131 自动化测试；TypeScript、ESLint、Web/PWA 构建、生产依赖审计 0 已知漏洞；0.6.1 标准版单安装包（本地 AI 应用内下载，用户实机确认）；统一对话窗收编文档能力（📎 全格式打开、附件任务内联、云端逐次授权、语音同路由），资源管理器“用 AgentPlay 智能处理”动词 14/14 注册在册并直达对话窗；DOCX 无损编辑（替换/修订/批注/插入/追加）、PPTX 页面级编辑、Excel 公式重算抽验、扫描 PDF 系统 OCR、本机 Office 高保真转换、多文件成套产出均自动化回归；包内 mpv + SAPI 完成 H.264/AAC 真渲染（既有） | 未购买 Authenticode 证书（SignPath 开源免费签名审批中），安装时显示未知发布者；Win11 第一层右键菜单不显示传统注册动词（系统限制，位于“显示更多选项”）；PDF/DOC 提取缺用户真实文件回归；拉片与 AI 成片真实模型端到端验收、实时翻译双语字幕、其他平台未交付；正式发布前须版本升级与静态资产核对 |
| Web PWA | Vite 生产构建退出 0；产物包含 index、JS、CSS、manifest、service worker | 浏览器没有 Electron IPC，不能直接访问本地模型密钥库、SAPI、mpv 创意渲染；不能算桌面功能等价 |
| Android | Capacitor 8.4.2 `sync android` 曾成功，Web 产物已复制到 Android 工程 | 0.6.1 尚未重做 APK 构建与真机验证；文件选择、后台音频、AI 成片均未验证 |
| macOS | CI 构建定义存在；代码对系统 `say` 配音有适配 | 本机不是 Mac，未生成/启动 DMG；仓库没有 macOS mpv 闭包，高级 MP4 渲染会明确显示不可用 |
| Linux | CI 构建定义存在；代码对 `espeak-ng` 有适配 | WSL 有 Linux 内核但未形成可分发 mpv 闭包；AppImage/deb 启动、桌面集成和高级渲染未通过 |
| iOS | 尚无 0.6.1 实机证据 | 需要 macOS、Xcode、iOS 工程、签名和真机；当前不能称已交付 |

## 已固化的验证入口

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm exec eslint src --max-warnings=0
pnpm build:web
node node_modules/@capacitor/cli/bin/capacitor sync android
pnpm platform:report -- --require-creative
node scripts/smoke-creative-render.mjs --packaged
node scripts/smoke-packaged-ui.mjs
pnpm release:verify
```

`scripts/platform-capability-report.mjs` 会为每个构建机写出 `release/platform-capabilities-<platform>-<arch>.json`。应用运行时也会检查本端是否真的有系统配音和 mpv 渲染内核；缺失时禁用最终 MP4 按钮，不允许把“界面存在”冒充“功能可用”。

## GitHub Actions

`.github/workflows/build.yml` 已配置 Windows、macOS、Ubuntu 三个平台的测试、Web 构建、能力报告和安装包任务，但本轮没有推送代码或触发远程工作流，因此不能把该 YAML 当成 macOS/Linux 已通过的证据。

下一步要把其余端提升为完整交付，必须在对应系统补齐可再分发的媒体渲染闭包，并完成：安装 → 打开横/竖屏视频 → 右键/文件关联 → 多模态拉片 → 新镜头/配音/字幕/音乐 → 导出成片 → 重启恢复项目的端到端测试。
