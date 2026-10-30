# GitHub 交付核验与上传指南 / Delivery and upload guide

> **版本备注：未添加回复功能和奇遇登录录入**
>
> **独立程序备份**。详见[版本备注](版本备注.md)。


交付日期：2026-10-29。项目英文名：**Miliastra Wonderland Comment Collector**。

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

## 此交付的验证记录

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

The delivery gate is 160 passing tests in each of three consecutive source runs, and separately from the final folder and extracted ZIP, matching static hashes and clean user-data directories. This round strengthens independent region/language title requests, reordered responses, explicit identity rejection, partial failures and overlapping operations. Two real global stages were previously verified read-only in Chinese and English. Visual records above describe previous validated features, not a fresh manual run of every theme/language. Deterministic local tests do not certify every live proxy, future remote API behavior, arbitrary browser translations or exact reply links absent from upstream data.

版本说明与校验清单已归入 app/docs/。若仓库根目录还留有旧版 RELEASE_NOTES.md 和 SHA256SUMS.txt，请在上传新目录后删除这两个旧位置的文件；网页上传不会自动移动或删除它们。README 和 LICENSE 保留根目录，以便 GitHub 展示首页与识别许可证。

Release notes and the checksum manifest now live under app/docs/. If updating an existing repository, remove the two obsolete root-level copies after uploading; a web upload will not move or delete them automatically.


本次新增核验：每页／每关卡首次成功同步自动换轮；部分失败保留旧标记，本轮部分新增在重试后仍保留；同组成功与失败分别处理；旧后台协议提示重启；手动清除按钮的数量、强调色与同步禁用状态。浏览器已验证同次打开累计、关闭重开后首次同步及手动清除。
