# Release notes · 2026-10-27

[简体中文](../../README.md) · [English](../../README.en.md) · [交付核验与上传指南 / Delivery and upload guide](RELEASE-CHECK.md)

## 本次更新

- 将“未读”改为“更新评论／更新回复”。新增到本地的内容会持续保留更新标记，查看不会自动清除；重复同步只累积，手动清除后重新累计。本次同步新增数单独显示。
- 默认启用“更新优先”，可选“只看更新”。与搜索、评价、默认模板、日期及排序一起使用；关闭更新优先后恢复原有排序。
- 移除直接回复主评论的重复标签。回复对象、作者和正文分开显示，真实嵌套结构逐层缩进，悬浮或键盘聚焦时高亮回复对象在本串的发言。
- 修复“过滤默认”选中背景覆盖皮肤的问题，统一十套皮肤的普通、选中、悬浮与焦点状态，并支持自定义悬浮颜色。
- 顶部栏在向下阅读时滑出，向上滚动时恢复；菜单、弹窗、教程和键盘操作期间保留入口，减少动态效果设置会关闭过渡动画。
- 保留十套主题、十二种背景效果、十五种界面语言，以及跨服总览、评论与子回复本地保存、便签和 CSV 导出。

## 更新方式

1. 停止同步和便签编辑，备份自己的 `config/` 与 `data/`。
2. 将新交付包解压到新文件夹，先按上传指南运行文件校验。不要在旧目录上反复混合覆盖。
3. 需要保留原有收集内容时，在核验之后、服务停止状态下将备份的 `config/` 与 `data/` 放入新目录。
4. 使用英文 EXE 启动，浏览器按 Ctrl+Shift+R。旧版更新标记兼容保留，不需要迁移评论文件。

首次使用仍需要 Node.js 18 或更新版本；EXE 是 Windows 启动器，不是内置 Node.js 的单文件程序。教程记录、外观偏好保存在浏览器，不随交付包传播。同一浏览器以前访问过相同地址时，教程不会因为解压了新文件夹而自动重置，可点“新手引导”重新打开。

## Changes in this delivery

- Update markers replace the reading-state terminology. Viewing does not clear them; repeated sync accumulates newly saved comments/replies until explicitly cleared. Per-sync additions are reported separately.
- Updates-first and updates-only views combine with existing filters and sorting. Reply rows show actual nesting and addressee highlights without inventing exact parent links from user-only references.
- Hide-default styling now follows all ten themes and custom hover settings. The header hides while scrolling down and returns on upward scroll, with interaction locks and reduced-motion support.
- Fifteen interface languages, twelve background effects, cross-server overviews, local replies, notes and CSV export remain available.

Back up your working configuration and data, extract the new delivery into a separate folder, verify it, then copy your own data into it while the service is stopped. Refresh the browser after starting. Node.js 18+ is required; the Windows EXE is a launcher. Browser tutorial/theme preferences are not bundled.

Validation scope and exact upload instructions are in the linked delivery guide. Remote platform availability, every real proxy exit and translation quality for arbitrary text are outside the local regression guarantee.
