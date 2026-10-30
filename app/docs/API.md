# Local API and storage reference

## Group review overview

The all-region overview is a virtual client view; it adds no endpoint or storage file. It loads `/api/comments?name=...` for each nonempty registered entry in the selected group and submits all group entry names to `/api/sync` via `names` (plus `full: true` for full refresh). Empty entries are included in sync so first-time downloads work. Review identity is the pair of registered entry name and original reply ID; note writes still use the original entry and ID. A member read failure is reported instead of showing an incomplete overview. Comment CSV includes game and region columns for both individual and combined views.

After membership changes, the client reloads registered entries and rebuilds the selected overview. Removing its anchor entry selects another member. A successful rename or merge transfers the selected overview to the destination group. A removed group falls back to an available individual entry; an empty registry clears the view and disables sync. See [regression coverage](TESTING.md) for the removal, re-import, split, rename, merge and empty-registry sequence.

These endpoints belong to the local service in [server.js](../server.js). They are not the official remote API. Start from the tool root with `node app/server.js --no-open --stay` for diagnostics. The service listens only on `127.0.0.1`; use the URL printed at startup because an occupied port may cause a fallback.

Request bodies are JSON objects. Responses are JSON except for the interface, JavaScript and icon resources. An HTTP 200 response can still contain `ok: false`; check the response body. Storage errors return HTTP 500 and `errorKey: "error.storage"` without clearing the damaged file.

## Request security

Reply items carrying `level_id` or `parent_reply_id` must match the requested registered level and parent. A mismatch rejects that refresh without replacing the existing thread. Some official payloads omit these fields (or expose only `f_reply_id`/`r_user`), so the collector does not invent missing parent relationships; UI summaries retain the known requested parent floor and author.

Requests must use `127.0.0.1` or `localhost` with the actual listening port in Host. If Origin is present, it must exactly match that HTTP origin; null, foreign and different-port origins are rejected. Fetch Metadata values other than `same-origin` or `none` are rejected. Rejections return HTTP 403 before reaching the API handler. Browser preflight requests do not grant cross-origin access.

POST/PUT/PATCH/DELETE requests require `Content-Type: application/json` (optional charset accepted), otherwise HTTP 415. `/api/ping` and `/api/bye` are exempt from that content-type rule to support page-close beacons, but all host/origin/Fetch Metadata checks still apply. CLI clients may omit Origin and Fetch Metadata, and must send JSON for normal write APIs. There is no authentication boundary against other local processes.

CSV escaping is performed in the interface for both comment and note exports. Cells beginning with formula markers (including markers after whitespace/control characters), or leading tab/line-break characters, receive an apostrophe before CSV quoting. Stored content is not modified.

## Endpoints

POST `/api/sub-replies` takes `{name, replyId}` for a registered, locally stored parent comment. It paginates the corresponding official `/web/api/level/reply/sub_replies` endpoint using `parent_reply_id`, preserves server-provided cursor ordering, deduplicates IDs and atomically saves the result. It returns `{ok, replies, complete, newIds}`. A duplicate refresh shares the same in-flight task; registration and parent existence are checked again before saving, preventing deletion resurrection. This refresh is blocked while sync runs, and sync is blocked while an individual refresh runs.

POST `/api/mark-read` takes `{names: [...]}` and clears update-marker IDs for those registered entries. The legacy route/storage names are retained for compatibility; this does not record whether content has been read. It is blocked during sync/reply refresh. Both endpoints require the same Host/Origin/JSON protections as other write APIs. `/api/progress` additionally returns `addedSubReplies` and `subReplyFailed` per entry. A nonzero failure count means reply collection is incomplete even if parent comments were saved successfully.

Normal UI and CLI sync enable reply collection, revisiting the parent index to discover replies on old comments. Per-thread safeguards are 30 seconds, 50 pages and 1,000 replies; repeated cursors stop traversal. After three batch failures, unattempted threads are marked incomplete. `subReplyFetch` records thread completion; `unread: {comments, subReplies, parents}` persists newly collected IDs. These are additive fields in the existing comments JSON format. `appearance.js` is a local static resource; appearance preferences are browser-only (`qx-appearance-v1`) and never sent to the server.

| Method and path | Input | Result |
|---|---|---|
| GET `/api/games` | — | Registered entries and groups, with counts and storage summaries |
| GET `/api/level-detail` | `input`, optional `region` query parameters | A checked level preview or classified lookup error |
| GET `/api/search-level` | `name`, optional `region` | Levels discovered through post share links; this is not a complete directory |
| POST `/api/add` | `input`, `region`, optional `name`, `group` | Validate with the remote service, then register or update the region/ID pair |
| POST `/api/add-batch` | `items: [{input, region, include?}]`, optional `group` | Per-row results; blank or explicitly excluded rows are skipped |
| POST `/api/sync` | `name`, or `names`, optional `full` | Start a job and return `jobId`; no target selects all registrations |
| GET `/api/progress` | Optional `since` log offset | Job ID, running state, logs, per-entry results and errors |
| GET `/api/comments` | `name` | The locally saved comment JSON; 404 when not collected yet |
| GET `/api/notes` | `name` | Notes belonging to one registered entry |
| GET `/api/notes-all` | — | Notes across registered entries with source metadata |
| POST `/api/notes` | `name`, `note` object | Create a comment snapshot or update its personal text |
| POST `/api/notes/remove` | `name`, `key` | Remove a note identified by reply ID, with comment number as fallback |
| POST `/api/set-group` | `name`, `group` | Move one entry |
| POST `/api/rename-group` | `from`, `to` | Rename a group or merge it into an existing group |
| POST `/api/dissolve-group` | `group` | Give each member its own group |
| POST `/api/remove` | `name`, `deleteData` | Remove registration; delete files only when `deleteData` is boolean `true` |
| POST `/api/remove-group` | `group`, `deleteData` | Apply the same removal to group members |
| GET `/api/life` | — | Local paths, port and automatic-exit setting; review before sharing output |
| POST `/api/autoclose` | `on` boolean | Enable or disable automatic exit |
| POST `/api/ping`, `/api/bye` | — | Page heartbeat and close notification |

Only one sync job runs at a time. Entries in a group are processed individually; a failed entry does not stop later entries. Removal and deletion during a running job return HTTP 409 with `errorKey: "error.syncBusy"`. The interface also checks that progress belongs to its own job.

## Lookup and input rules

Lookup, name search, add, batch add and sync accept optional `lang` using one of the 15 interface locale codes (default `zh-cn`). Stage detail requests send it in both the `lang` query parameter and `x-rpc-language`/`accept-language` headers. This selects official localized metadata, without translating saved comments.

`POST /api/level-titles` accepts `{ "names": ["registered entry"], "lang": "en-us" }` (up to 100 names) and returns per-entry `name`, `levelId`, `region`, `language`, `title`, `cached` or classified errors. Each batch fetches missing cache entries with at most three concurrent requests; concurrent requests for the same identity/language share a task. Separate language batches can overlap. Successful responses reread the latest registration before atomic cache updates. Removed or changed identities cannot be recreated by late responses. Host/Origin and JSON-write protections apply to this endpoint.

Every detail request has its own `level_id`, `region` and `lang`. Returned `level_id`/`region` fields in `data` or `data.level_info`, when present, must match the request; mismatches are classified as business/data errors and cannot enter title caches. Omitted identity fields remain compatible with existing official responses. Group sync iterates entries; it never assigns one member's metadata to every region in the group. Response order is not an identity key.

`GET /api/games` includes optional `levelTitles`, `titleOriginal` and `customName`; registration names and groups are not changed by title refresh. The browser selects the current locale or falls back to its original display title. Sync preserves other locale caches and refreshes the requested one. These optional fields retain the existing registration format and data-transfer compatibility. Old comment metadata without an explicit language is treated as `zh-cn`, matching the older collector's fixed request language.

China regions: `cn_gf01`, `cn_qd01`. Global regions: `os_asia`, `os_euro`, `os_usa`, `os_cht`.

Numeric IDs, `level_id=` links, `id=` share links, encoded links and fullwidth digits are supported. Text after a numeric parameter is not silently truncated into an ID. The multi-region form rejects a link that belongs to a different row's region.

Lookup error codes distinguish `invalid`, `notFound`, `business`, `proxyMissing`, `proxyFailed` and `network`. A network failure does not establish that an ID is wrong. Known official business responses do not mark a healthy proxy as dead. UI localization uses `errorKey` or the error code; technical details may remain in the returned `error` text.

## Storage and notes

Paths below are relative to the tool root:

- `config/games.json`: registrations and explicit groups.
- `config/proxy.txt`: optional local proxy candidate.
- `config/cookie.txt`: optional credentials, normally unnecessary for public comments.
- `data/<storage-name>/comments.json`: collected replies, level metadata and synchronization summary.
- `data/<storage-name>/notes.json`: saved snapshots and personal text.

Windows filename normalization, reserved names and case-insensitive collisions are handled when creating storage names. Re-registering a retained collection reuses it only when region and level ID match. Unknown registrations cannot be used to delete retained folders or recreate notes. A text-only update for a removed note is rejected; creating a note requires a comment snapshot.

Comment, index and note JSON files are written to temporary files and then renamed. A failed replacement preserves the existing target. UTF-8 BOM indexes and notes are accepted; invalid JSON or an invalid collection structure is reported. Keep the original file when diagnosing corruption.

The browser's [note store](../note-store.js) serializes operations per entry and note ID, retains drafts across rerenders, cancels pending saves on removal, and flushes drafts before note export. It does not replace backups. Wait for saving to finish before closing the page.

Notes optionally contain `subReplies`, `subReplyCount` and `subReplyFetch`. Reads join legacy notes to their entry's current local comments using stable reply IDs (floor fallback only when the note has no reply ID). Normal sync, individual thread refresh and note saves persist the reply snapshot. Missing source comments retain the saved snapshot; main-comment content and personal text are unchanged. No extra network request is made when opening notes. An unknown or corrupt comments file falls back to the saved note thread. Reply completeness retains the collector's limitations. The note view and CSV include all locally stored replies independently of the comment-list filters.

The [data transfer tool](../launcher/migrate-data.cjs) validates a clean new installation and copies legacy/v1 configuration and storage without rewriting the old installation. It does not convert arbitrary future formats. See [UPDATING.md](UPDATING.md) for compatibility and rollback guidance.

## Remote collection and verification

The collector selects Miyoushe or HoYoLAB through the region and uses level-detail, reply-list and post-search endpoints. The reply-list API is paginated by comment number; full collection combines descending order with popular-order results. Availability, counts and nested-reply previews depend on the remote service. No fixed runtime or complete coverage is guaranteed.

Run `node --test app/tests/*.test.cjs` from the tool root. Unit tests simulate errors and races; integration tests launch the real local server and collector in temporary directories, substituting only remote API responses. They cover local persistence, duplicate handling, group operations, partial sync failure, deletion locks and damaged files. They do not establish the future availability of live remote services or a particular proxy node.

See the [Chinese README](../../README.md) or [English README](../../README.en.md) for user instructions.

## Page-session marker rollover

The UI optionally sends markerBaselines in POST /api/sync, keyed by registered entry name; each value has comments, subReplies and parents string-ID arrays. It snapshots markers before this page receives new data. On a fully successful entry sync, the collector subtracts only those baseline IDs immediately before atomic file commit, then retains this session's additions. Failed/incomplete reply runs do not roll over markers. Successful entries return markerRoundApplied in /api/progress. The sync-start response advertises markerRounds: true; a new UI warns if an old backend lacks this capability. Omitting markerBaselines preserves legacy/CLI accumulation. No comments or notes are deleted by rollover.

The UI handles each region/level independently, survives in-page renames, and retries with the same baseline after partial failures. Reloading/reopening creates a fresh page round; manual marker clearing also completes the current round. The baseline is not resent after the first successful rollover in that page.

## Official accounts, local replies and latest queries

GET /api/accounts reports component availability and per-platform window state. replyEnabled means native components exist; roleVerified:false and verification:"per-target" mean each target still requires preparation. A running window does not prove sign-in or posting permission. This status endpoint returns no credentials or role IDs.

POST /api/accounts/open takes {"platform":"cn"} or {"platform":"os"}, opening the fixed official helper. It accepts no URL, executable, cookie, password, UID or PID. Success returns {ok:true,alreadyOpen:boolean,visible:true,foreground:boolean} only after a bounded native window-ready acknowledgement (15 seconds for startup, 6 seconds for reactivation). Duplicate startup requests share the pending operation; later requests restore the existing platform window using only the backend-held PID. The helper additionally checks its executable path and Windows session. foreground:false means the window is visible but Windows did not grant foreground focus; direct the user to the taskbar. The frontend request timeout is 20 seconds. This response never proves authentication or role authorization. Invalid platforms return 400, missing components or startup/readiness failures 503. Host/Origin/JSON protections apply.

The detailed calling guide is [AI-INTEGRATION.md](AI-INTEGRATION.md), with the machine-readable subset in [openapi.json](openapi.json). These are local APIs, not a promise of an officially supported API or all-platform posting permission.

| Method and path | Input | Meaning |
|---|---|---|
| GET /api/replies/latest | repeated name OR group; kind=all/comment/reply, since, limit, cursor, updatesOnly | Local roots and saved children sorted by each item's own official time |
| POST /api/replies/prepare | name, parentReplyId, optional subReplyId | Derive server; verify account and own roles; five-minute ticket, canDelete |
| POST /api/replies/send | target, ticket, own uid, content, persisted UUID attemptId | One authorized public reply; sent:true remains success even with localSaved:false |
| POST /api/replies/status | target, original attemptId | Persistent send/delete receipt, even after a deleted child disappears |
| POST /api/replies/delete | child target, ticket, own uid, UUID attemptId, confirm:true | Delete only a verified own child; no root-review deletion |

Latest-query numeric since is Unix seconds, or an ISO datetime with timezone, unrelated to /api/progress's log offset. Children under old parents use their own publication time. Missing times are null and sort last. Changed file snapshots reject old cursors with 409 changed: restart and deduplicate durable event keys. partialReplies and per-source incomplete counts distinguish partial collection. Queries do not fetch remote data; sync, thread refresh or writes cause 409 busy. Update markers can be cleared and include own sent content, so they are not a durable AI cursor or author-edit detector. The guide covers overlap, late arrivals and self-reply loop prevention.

The native helper rechecks account and target-server role before one fixed HTTPS POST. Credentials stay inside that helper and its dedicated profile, never returned to Node/HTTP/AI. config/reply-attempts.json is persisted before posting: context, UID, content hash and receipt, no plaintext content or cookies. Unknown results are not automatically retried; reuse the original attempt for receipt lookup, rather than generating a new UUID. Restart invalidates tickets but preserves receipts. The ledger limit is 10,000 attempts, without silent pruning.

Own-child deletion preserves other users' descendants and note text. Existing notes retain deleted rows in read-only deletedSubReplies history, excluded from latest queries and current reply targets. Confirmed writes may need a later local refresh if local persistence fails. Miyoushe login/role selection and one authorized post were verified by official readback; global posting after login and public deletion remain unverified. Local HTTP tests use a fake native bridge.


Prepare additionally accepts boolean force:true to bypass the per-region, 60-second in-memory successful-check cache. cached and checkedAt report reuse and original verification time. Account-window opening invalidates platform cache/tickets; running windows bypass caching. Account changes invalidate other cached regions of that platform. Concurrent stale results cannot refill invalidated caches. Native send/delete always perform fresh account and role reads. GET identity and role checks now run in parallel, with a 400 ms read-only alternate-route hedge; losing GETs are aborted. POSTs are never hedged or automatically retried.


## Verified deletion receipt · 2026-10-30

New successful delete receipts require verified:true, meaning a complete official thread read proved target absence. alreadyAbsent:true means the target was absent before the request; no delete POST was sent. Otherwise a fresh ownership read precedes one delete POST and up to three readback checks. A successful HTTP/official acknowledgement alone does not prune local storage. Remaining target, incomplete pages or read failure return unknown and preserve local rows. acknowledged:true may indicate an accepted request without confirmed disappearance. Legacy deleted receipts lacking verified are surfaced as unknown without reposting or rewriting the ledger. The native 65-second operation deadline and page limits can produce a conservative unknown result.

Self-target tags are omitted from rendered replies and note CSV only when author/addressee UIDs match. Raw r_user and exact reply IDs remain unchanged, including latest-query data. Matching nicknames with different UIDs are not suppressed.


POST /api/replies/status accepts optional boolean refresh:true for read-only reconciliation of uncertain delete receipts. Native --verify-delete checks the current account owns the original server UID, then reads the original thread without calling deletion. Verified absence returns reconciled:true and updates the same persistent attempt and local stale row. present/incomplete/readFailed verification reasons preserve unknown. Pending writes younger than 90 seconds remain sending; verification is deduplicated and excludes concurrent sync/mutation. Receipt queries for sending do not guess success from matching text. The browser close-after-success preference is not an API setting.

## 删除自动只读跟进协议 · 2026-10-30

删除未确认后会自动在后台只读核对：逐步延长间隔，最多启动 8 次检查，调度窗口为 5 分钟（已开始的网络查询可稍后完成）。确认官方目标缺席后，自动清理本地回复、计数和更新标记，并刷新便签的当前回复快照；手写备注和删除历史保留。等待期间显示检查次数，关闭弹窗或主页面仍继续，后台重启会恢复剩余时限。持续存在、网络／分页异常或本地保存失败到达上限后明确暂停，可点“继续核对删除结果”；登录／归属不匹配会提前暂停。继续核对只读原目标，不再次发送删除。等待间隔不锁住同步，实际核对与同步／移除操作互斥。

`POST /api/replies/status` 查询原 `attemptId`，无需 `refresh` 就能观察后台进展。新增可选 `followup:{state,checks,startedAt,deadlineAt,nextCheckAt?,reason}`；state 为 waiting/checking/paused/complete。`reason` 区分 present、incomplete、readFailed、localSave，以及登录／角色／存储／来源变化。收到 paused 时，向原 UUID 发送 `refresh:true` 明确继续核对；不要新建删除 UUID。已确认官方缺席但 `localSaved:false` 时，后台仅重试本地提交，不重访官网。

`GET /api/replies/deletions` 是本地只读列表，返回 `{ok:true,items:[{attemptId,name,parentReplyId,subReplyId,...原回执,followup}]}`，只包含仍登记来源的等待／核对／暂停项，不含凭据或发送 UID，不主动访问官网。它用于刷新页面后恢复观察；普通 status 查询也不额外触发官方查询。prepare 成功体的可选 `deletionAttempt` 返回本目标同一拥有者最近的未完成删除回执，避免浏览器草稿缺失导致重复操作。

后台已发送的删除始终最多一次 POST；跟进是原目标的只读验证。5 分钟期限跨重启保留；暂停项不会因重启自动无限重跑。短暂等待不占用同步锁；执行核对时才互斥。后台自动退出会等待有界核对任务结束，关闭浏览器不取消已请求的核对。

回复错误响应的 retcode 仅保留 `-?\d{1,12}` 或 `HTTP [45]\d{2}`；任意诊断文字会省略，不用于转送凭据。安全与本地客户端边界见 [SECURITY.md](SECURITY.md)。
