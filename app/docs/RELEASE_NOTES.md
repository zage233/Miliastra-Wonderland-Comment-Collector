# Release notes · 2026-10-29

[简体中文](../../README.md) · [English](../../README.en.md) · [交付核验与上传指南 / Delivery and upload guide](RELEASE-CHECK.md)

## 本次更新

- 补充跨服标题隔离验证：六区服、两种语言乱序返回与部分失败分别保存；接口明确返回其他关卡 ID 或区服时拒绝缓存。分组同步、标题查询及改组交错时仍保留各自身份，文档明确每批独立请求的并发规则。

- 关卡标题支持官方多语言文本：查询、搜索、导入及同步携带当前界面语言。切换语言优先用本地缓存，缺少时后台查询；无对应标题或查询失败则显示原标题。选择器、管理页和便签来源随之更新，分组与数据目录保持稳定，不改写评论和备注。

- 修复便签缺少子回复：收藏时保存本地回复，已有便签自动关联本地评论；后续同步和单串刷新持久更新回复快照，保留个人备注及主评论原文。便签支持折叠、层级与对象显示，CSV 增加回复数和回复正文，独立于评论页更新筛选。
- 增加保留数据的版本更新流程及 `migrate-data.cjs`：校验完整新版、验证旧格式、逐文件核对迁入，保留旧版回退副本。新版已有数据、格式不兼容或后台未关闭时停止，避免空配置覆盖个人登记。

- 重开或刷新页面后，各关卡首次完整成功同步会自动清除上一轮更新标记，只保留本轮新增；同次打开的后续同步继续累积。失败或回复未取完时保留旧标记，重试成功不会误清本轮已经收到的新回复。
- 将“清除更新标记”移到计数旁，以强调色和可清除数量突出显示；空状态和同步期间禁用。本次同步新增数继续单独显示。
- 默认启用“更新优先”，可选“只看更新”。与搜索、评价、默认模板、日期及排序一起使用；关闭更新优先后恢复原有排序。
- 移除直接回复主评论的重复标签。回复对象、作者和正文分开显示，真实嵌套结构逐层缩进，悬浮或键盘聚焦时高亮回复对象在本串的发言。
- 修复“过滤默认”选中背景覆盖皮肤的问题，统一十套皮肤的普通、选中、悬浮与焦点状态，并支持自定义悬浮颜色。
- 顶部栏在向下阅读时滑出，向上滚动时恢复；菜单、弹窗、教程和键盘操作期间保留入口，减少动态效果设置会关闭过渡动画。
- 保留十套主题、十二种背景效果、十五种界面语言，以及跨服总览、评论与子回复本地保存、便签和 CSV 导出。

## 更新方式

1. 停止同步和便签编辑，备份自己的 `config/` 与 `data/`。
2. 将新交付包解压到独立新文件夹，先按上传指南运行文件校验。不要在旧目录上反复混合覆盖。
3. 需要保留原有收集内容时，在新版根目录运行 `node app/launcher/migrate-data.cjs "旧版工具完整目录"`。详见[保留数据更新指南](UPDATING.md)。旧版目录不被修改。
4. 重启收集器后台，再使用英文 EXE 启动，浏览器按 Ctrl+Shift+R。旧评论格式兼容，不需要迁移评论文件。

首次使用仍需要 Node.js 18 或更新版本；EXE 是 Windows 启动器，不是内置 Node.js 的单文件程序。教程记录、外观偏好保存在浏览器，不随交付包传播。同一浏览器以前访问过相同地址时，教程不会因为解压了新文件夹而自动重置，可点“新手引导”重新打开。

## Changes in this delivery

- Strengthened region-title isolation checks and rejected explicit level/region mismatches in detail responses. Regression covers six-region/two-language reordering, partial failures, repeated sync, overlapping metadata/comment requests and group edits. Documentation distinguishes independent requests from batch concurrency.

- Stage titles now use official localized metadata for the selected interface language across lookup, search, import and sync. Switching languages uses persistent caches or a background lookup, with original-title fallback. Group names, registration/storage identity, comments and personal notes remain stable.

- Saved notes now include collapsible local reply snapshots, updated by normal sync and individual thread refresh while retaining personal text and the original parent snapshot. Legacy notes read local replies without being saved again. Notes CSV includes replies and does not inherit comment-list update filters.
- Added a validated, hash-checked data transfer into a clean new installation. Previous configuration and collections remain untouched; incompatible data, active services and used destinations stop the transfer. See the [upgrade guide](UPDATING.md).

- On reopening or reloading, each entry's first fully successful sync automatically rolls over previous-round update markers. Later syncs accumulate. Failures or incomplete replies preserve older markers, and retries retain additions already saved in the current session.
- Clear update markers now sits next to the totals, with an accent background and count; it is disabled when empty or syncing. Restart the backend and refresh after updating. Per-sync additions remain separate.
- Updates-first and updates-only views combine with existing filters and sorting. Reply rows show actual nesting and addressee highlights without inventing exact parent links from user-only references.
- Hide-default styling now follows all ten themes and custom hover settings. The header hides while scrolling down and returns on upward scroll, with interaction locks and reduced-motion support.
- Fifteen interface languages, twelve background effects, cross-server overviews, local replies, notes and CSV export remain available.

Back up your working configuration and data, extract the new delivery into a separate folder, verify it, then copy your own data into it while the service is stopped. Refresh the browser after starting. Node.js 18+ is required; the Windows EXE is a launcher. Browser tutorial/theme preferences are not bundled.

Validation scope and exact upload instructions are in the linked delivery guide. Remote platform availability, every real proxy exit and translation quality for arbitrary text are outside the local regression guarantee.
