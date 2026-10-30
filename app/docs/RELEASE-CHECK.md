# GitHub 交付核验与上传指南 / Delivery and upload guide

交付日期：2026-10-30。项目英文名：**Miliastra Wonderland Comment Collector**。

## 交付文件是什么

| 路径 | 用途 |
| --- | --- |
| `Miliastra Wonderland Comment Collector.exe` | Windows 图形启动器，需要安装 Node.js 18+ |
| `app/` | 页面、收集器、本地服务、图标、构建脚本、测试及技术文档，需完整保留 |
| `README.md` / `README.en.md` | 中英文使用说明 |
| `app/docs/RELEASE_NOTES.md` | 本次变化及更新方法 |
| `LICENSE` | 项目许可证 |
| `.gitignore` | 排除日常收集数据、个人配置及发布目录 |
| `.gitattributes` | 防止 Git 自动转换换行，保持校验字节一致 |
| `app/docs/SHA256SUMS.txt` | 本交付代码、资源和文档的 SHA-256 清单 |
| `app/launcher/migrate-data.cjs` / `app/docs/UPDATING.md` | 本机保留数据更新脚本及说明，旧版完整目录保留用于回退 |
| `config/` / `data/` | 交付时为空登记／无评论数据；GitHub 不保存空文件夹，使用时会按需创建 |

## 上传前核验

在**解压后的交付目录**中打开终端，运行：

```powershell
node app/launcher/verify-release.cjs --clean
node --test app/tests/*.test.cjs
```

第一条应显示 `PASS`，第二条应显示全部测试通过。文件校验会发现文件缺失、意外改动和额外旧文件；清洁模式还会拒绝个人登记、评论数据及代理／Cookie 配置。不要把自己的工作目录当成交付目录运行上传流程。

清单覆盖代码、图标、文档和测试，不包含清单自身及可变的 `config/`、`data/`、`release/`、`.git/`。普通校验可用于已使用的安装；`--clean` 专门用于未掺入个人数据的发布副本。校验用于发现意外差异，不是数字签名。

需要修改程序或文档时，在源目录修改后重新运行发布脚本生成整份副本和清单，不要通过忽略校验错误交付。

## GitHub 怎么上传

1. 仓库上传的是交付目录**里面的文件和文件夹**，不要多套一层交付目录，也不要把日常工作目录上传。
2. 保留 `app/` 下的目录结构，尤其是 `app/launcher/prepare-release.ps1` 和 `verify-release.cjs`；不要把脚本单独传到仓库根目录。
3. 确认 `.gitignore`、`.gitattributes`、`app/docs/SHA256SUMS.txt`、许可证和两份 README 都已包含。网页上传若漏掉点开头文件，需要单独补上。
4. 网页“覆盖上传”不会删除旧文件。上传后，从 GitHub 下载仓库 ZIP、解压，再运行上面的两条命令。若报告 `Unexpected file`，先对照清单确认是否为上次遗留文件；不要忽略报错。
5. 完整可运行 ZIP 适合作为 GitHub Releases 附件；不要用“只上传 EXE”替代完整程序包。源码仓库与 Releases 是两种不同的下载入口。

本地副本通过核验，不等于未来的网页上传结果必然一致。仓库下载后的复核用于确认上传没有漏文件、改变路径或保留旧文件；校验清单随包交付，不需要依赖聊天记录。

## 此前标题版本的验证记录（历史）

下列长期功能的浏览器记录包含此前已完成的检查；本轮新增实测单独列在“本轮”条目，全部自动回归在本轮重跑。

- 完整回归：**160 项测试**，工作源码连续三轮通过，最终发布副本和交付 ZIP 解压目录分别通过。
- 自动覆盖：代理回退与错误分类、导入与分组、跨服总览、评论及子回复分页、更新标记保留／清除、搜索筛选排序、便签保存竞争、删除锁、异常输入、导出安全、本地接口保护、首次教程、外观配置和文件完整性。
- 浏览器组合检查：搜索＋评价＋更新筛选，开关更新优先恢复排序，分组同步期间编辑便签，管理表展开收起列宽稳定，整组清除标记后恢复全部评论，十套过滤默认配色，自定义悬浮色，十五种相关控件文案。
- 阅读体验：桌面和 390px 窄屏下，下滑隐藏／上滑恢复顶部栏；展开选择器时不隐藏。子回复只在有对象时显示对象标签，真实嵌套缩进，关系悬浮高亮；窄屏无横向溢出。
- 发布清洁性：空登记、无个人评论／便签／代理／Cookie，源码与发布静态文件哈希一致，源码及 Markdown 本地链接检查通过。
- 此前便签：浏览器模拟数据检查收藏、三条回复增至四条、备注保留、折叠、评论页无结果筛选与便签隔离、桌面及 390px 窄屏；本轮自动重跑快照、跨服隔离、失败及 CSV 测试。
- 更新工具：本轮重跑字节不变、旧版保留、损坏／不兼容格式拒绝、重复迁入、并发写入和替换失败回滚；真实 Windows 命令行验证中文路径下运行检测和停止后迁入。未对用户工作数据执行迁入。
- 本轮标题：两个真实外服关卡的中英文官方标题已只读核实；自动测试涵盖十五种语言参数、缓存、失败回退、请求竞争及身份稳定。浏览器以独立模拟数据检查语言切换、管理页、便签来源与原分组保留。
- 本轮隔离复核：六区服、两种语言乱序响应，部分失败及重试，三次增量／全量同步，明确的跨关卡／跨区服返回拒绝，以及标题查询＋评论同步＋改组交错。此前浏览器检查记录保留；本轮加强部分由可重复的接口／文件回归验证。

### 验证边界

本轮执行环境为 Windows、Node.js v24.19.0；声明的最低版本为 Node.js 18，本轮未对所有 Node.js 小版本分别运行。浏览器交互检查使用独立模拟数据，不改动日常收集目录。

自动网络测试使用可重复的模拟官方响应，不代表每个实际地区、代理节点或未来的官方接口都可用。浏览器翻译由外部翻译服务决定，工具不会改写本地原文，也不能保证短词必有译文。只提供回复对象用户的接口数据，无法证明精确回复了该用户哪一条发言；界面不会伪造这种父子关系。

## English handoff

Extract the complete delivery, install Node.js 18+, then run both commands above from its root. The verifier checks immutable program/document files; `--clean` also checks that personal configuration and collections are absent. Normal use can change `config/` and `data/` without changing the code manifest.

Upload the folder's **contents**, preserving `app/` and both dotfiles. Web uploads do not remove old files. Download the repository ZIP after upload and repeat verification to detect missing, changed or leftover files. Use the complete ZIP as a Release asset; the EXE alone is not a standalone installation.

The previous title-version delivery gate was 160 passing tests in each of three consecutive source runs, and separately from the final folder and extracted ZIP, matching static hashes and clean user-data directories. This round strengthens independent region/language title requests, reordered responses, explicit identity rejection, partial failures and overlapping operations. Two real global stages were previously verified read-only in Chinese and English. Visual records above describe previous validated features, not a fresh manual run of every theme/language. Deterministic local tests do not certify every live proxy, future remote API behavior, arbitrary browser translations or exact reply links absent from upstream data.

版本说明与校验清单已归入 app/docs/。若仓库根目录还留有旧版 RELEASE_NOTES.md 和 SHA256SUMS.txt，请在上传新目录后删除这两个旧位置的文件；网页上传不会自动移动或删除它们。README 和 LICENSE 保留根目录，以便 GitHub 展示首页与识别许可证。

Release notes and the checksum manifest now live under app/docs/. If updating an existing repository, remove the two obsolete root-level copies after uploading; a web upload will not move or delete them automatically.


本次新增核验：每页／每关卡首次成功同步自动换轮；部分失败保留旧标记，本轮部分新增在重试后仍保留；同组成功与失败分别处理；旧后台协议提示重启；手动清除按钮的数量、强调色与同步禁用状态。浏览器已验证同次打开累计、关闭重开后首次同步及手动清除。


## 本轮本地回复及 AI 查询交付

本轮代码与文档包括本地回复、本人子回复删除、自动删除核对，以及最新主评论／子回复查询。自动套件为 230 项，源码回归已通过；正式使用以完整新副本的文件清单与回归结果为准。详见 [TESTING.md](TESTING.md)。原生组件的编译与自测记录见测试文档，相关 SDK 许可保留。

查询与写入集成见 [AI-INTEGRATION.md](AI-INTEGRATION.md) 和 [openapi.json](openapi.json)。米游社一次获准实发已读回；HoYoLAB 实发和公开删除仍未验证，主评价删除尚未提供。不能将隔离模拟测试描述为所有平台实发通过。

发布副本必须保持 config/games.json 为空，不携带 reply-attempts.json、个人评论、便签、Cookie／代理或浏览器会话。若升级个人安装，应保留完整 config/ 和 data/，其中尝试回执用于防重发。新安装与上传副本是不同用途，勿混用。


后续精简：默认回复正文优先，账号设置折叠，本人删除单独管理；检测并行及一分钟短缓存，打开登录时失效，写入前仍联网核验。仅只读请求允许备用线路竞速，公开发言与删除不重试。耗时样本与验证限制见 TESTING.md。


本轮追加：自我回复标签按 UID 判断、账号设置去除重复外框、删除前归属核验及删除后完整官方列表缺席核验。旧删除回执缺少 verified 时不冒充成功，新版核验未确认时保留本地。不重发任何结果不明的删除。用户此前的一条删除记录已只读核对不存在；新版核验流程未由代理执行公开删除。


追加交付：未知删除可只读重新核验并更新原回执，提供仍存在／列表不完整／查询失败的区别；操作成功且本地保存完成后默认关闭弹窗，可选择停留并记住。真实欧服只读核验与隔离副本复核通过，没有再次执行公开删除。

## 本轮补充核验

- 删除后台自动核对、关闭弹窗后的列表更新、重启恢复、暂停继续、本地保存补偿均通过隔离回归；等待时不锁住整轮同步，核对中仍保持互斥。
- 官方登录 EXE 已重新构建，真实 WebView2 窄窗口布局测试与原有安全自测通过。新版要关闭旧官方窗口后才能替换 EXE；重启后台并强制刷新浏览器。
- 完整回归共 230 项；交付目录和 ZIP 解压副本分别复测并校验。测试没有向官方发送或删除公开内容，也不把模拟结果声称为所有区服实删通过。

本轮增加账号设置明显展开／收起、删除权限说明和可跳过的登录教程；安全检查报告位于 `app/docs/SECURITY.md`。本次交付除个人数据清洁校验外，另行扫描凭据型文件名及私钥块；这不代替对任意未知秘密格式的人工检查。


## 本次登录窗口修复交付 · 2026-10-30

源码、清洁交付目录与最终 ZIP 解压副本各执行完整 230 项测试，均需通过。原生登录的安全自测、真实本地 WebView2 布局测试、最小化恢复测试，以及 Session Bridge 自测另行检查；异程序 PID 激活应拒绝。文件清单覆盖 85 个程序／文档文件，包内不含个人会话、评论、便签、代理或尝试回执。工作 config/data 对照本次修改前基线，保持不变。

Windows 可能限制前台切换；页面会提示从任务栏进入，不以开窗成功冒充登录成功。更新时关闭旧官方窗口并停止旧后台，使用完整新版本，重启后 Ctrl+Shift+R 刷新。登录和回复的外部验证边界仍以 TESTING.md 为准。本次没有新增公开发送或删除。
