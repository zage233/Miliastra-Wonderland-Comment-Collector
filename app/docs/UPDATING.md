# 保留数据更新 / Updating without re-adding levels

## 更新原则

- `app/`、EXE、README 等是程序文件，随新版发布更新。
- `config/` 存关卡登记、分组、代理及其他设置；`data/` 存评论和便签。发布包中的空目录用于首次安装，不能覆盖个人数据。
- 新版可能增加字段，但应兼容旧格式。必须更改格式时，先备份，再做专用迁移与验证；不支持的格式应停止，不能当作空数据重新初始化。
- 本次便签子回复使用可选字段，兼容旧评论和便签；无需重新添加关卡。已有便签从本地评论补齐回复，下一次同步或备注保存会持久更新快照。
- 多语言标题缓存同样使用可选字段，保存在原登记与评论元数据中；迁入时保留，缺少缓存由当前语言的查询补齐，不重命名旧数据目录或分组。

## 推荐操作

1. 等待备注保存、同步结束，关闭旧版页面和后台。开启“后台常驻”时仅关闭浏览器不够，需要正常退出后台。
2. 将完整新版解压到一个新目录，不能放在旧版目录内部，也不能放在其父目录。原目录作为回退副本保留。
3. 在新版根目录打开终端，运行以下命令，将引号内容替换为旧版的完整目录：

   ```powershell
   node app/launcher/migrate-data.cjs "旧版工具完整目录"
   ```

4. 显示 `PASS` 后，运行新版根目录下的英文 EXE，并在浏览器强制刷新。登记、分组、评论、便签及备注应继续存在，不需要重新添加。
5. 确认新版可用之前保留旧版目录。迁入后两个目录各有一份数据，后续只使用新版；不要交替运行两份并期待它们相互同步。

迁入脚本只用于**本机使用的新安装**。迁入后该目录含个人信息，不能直接作为 GitHub 上传包。分享时仍应使用 [prepare-release.ps1](../launcher/prepare-release.ps1) 另建清洁副本。

## 脚本检查什么

先检查旧／新后台进程、新版发布清单、空登记和空数据，再验证旧版 `games.json` 以及评论／便签的 v1 或旧无版本格式。复制到临时目录后逐文件核对 SHA-256，并再次检查运行状态和两边数据是否发生变化。最后只替换新版尚未使用的 `config/` 与 `data/`。程序、原旧版和旧数据都不被改写；替换失败会尝试恢复新版原目录。回退失败时保留临时目录并明确报告路径。

遇到新版已有数据、JSON 损坏、未知格式、链接目录或仍在运行的后台时停止。Windows 进程检测无法确认安全时不要绕过检查。已知以相对路径启动的后台可能需要先全部正常退出，脚本不会主动结束任何进程。它不是未来任意数据版本的通用转换器。

如果手动操作，可在两边程序均已关闭、备份之后，将旧版完整的 `config/`、`data/` 复制到尚未使用的新版。不能只复制 `comments.json`，否则关卡登记和分组会缺失。数据格式有变化时应先按对应版本说明迁移。

## English

Extract the entire new delivery into a separate, non-nested directory. Close the previous collector and its background service, then run `node app/launcher/migrate-data.cjs "previous installation folder"` from the new root. Start the EXE in the new folder only after `PASS`.

The transfer validates the clean delivery and legacy/v1 storage, stages and hashes every configuration/data file, checks for concurrent writes and replaces only the new empty data directories. The old installation is unchanged and can be retained for rollback. Incompatible/corrupt formats, a used destination, links or active services stop the transfer. It preserves bytes rather than pretending to convert arbitrary future formats. Format changes require a dedicated, validated migration.

Browser tutorial/theme preferences are separate. After transferring, the new folder contains personal data and must not be uploaded as-is; generate a separate clean distribution. Use one installation going forward: the two copies do not synchronize with one another.

## 官方登录窗口

官方登录窗口的 cn/os 浏览器会话位于当前用户的 LOCALAPPDATA 中，独立于 `config/` 和 `data/`；更换收集器目录不会主动清除这些会话，目录名继续沿用 `MiliastraCommentCollector/LoginProbe`。不要将浏览器会话目录随工具分享。程序回退前应关闭收集器服务及官方登录窗口；回退程序不等于退出官方网站账号。


本地回复新增 config/reply-attempts.json，保存发送／删除尝试及回执，防止重启后重发。升级时随完整 config/ 保留，迁入工具按原始字节复制；不要删除它，也不要上传个人配置。新字段兼容现有评论／便签 v1 格式，删除历史为可选 deletedSubReplies。不支持的格式或损坏文件会停止相关操作，不会抹成空配置。
