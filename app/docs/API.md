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
