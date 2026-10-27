# Miliastra Wonderland Comment Collector

[简体中文](README.md) | English

This delivery: [Release notes](app/docs/RELEASE_NOTES.md) · [GitHub upload and file verification](app/docs/RELEASE-CHECK.md)

## Local service and export protections

The local service validates the loopback Host, actual port, browser Origin and cross-site request metadata. State-changing APIs require JSON, with compatible handling for same-origin page-close beacons. Use the local address printed by the launcher. Comment and note CSV exports prefix potentially formula-like cells with an apostrophe; spreadsheet software may display that prefix. Stored comments and notes remain unchanged. These checks do not replace operating-system permissions for local processes.

## Publishing to GitHub

The official name is **Miliastra Wonderland**. The launcher is `Miliastra Wonderland Comment Collector.exe`.
Run `powershell -ExecutionPolicy Bypass -File app/launcher/prepare-release.ps1` and upload only the contents of the generated `release/Miliastra-Wonderland-Comment-Collector-TIMESTAMP/` directory. It excludes personal reviews, notes, registrations, proxies and cookies. Do not drag the entire working folder into GitHub's web uploader: web uploads do not apply `.gitignore` for you.

Tutorial progress is stored only in each user's browser localStorage and is never included in the package. New visitors automatically see the guide; completed or deferred guides can be reopened with the guide button. A browser that previously used the same local address retains its choice even after copying the files. Node.js 18 or newer must be installed and the local service must start successfully before the page can open.

A local tool for collecting public level comments from Miyoushe (China servers) and HoYoLAB (global servers). Browse, search, filter and export comments, identify default comment templates, and save comments with personal notes. The interface supports 15 languages; collected comments retain their original text.

## Getting started

On Windows, double-click **`Miliastra Wonderland Comment Collector.exe`**. The launcher has an application icon, opens the interface in your default browser, and runs the local service without a console window. No administrator access is required.

Keep the complete `app/` folder beside the launcher, and preserve any existing `config/` and `data/` folders. Missing data directories are created as needed on first use. This EXE is a launcher, not a standalone bundle: Node.js 18 or newer must be installed, or provided as `node.exe` beside the launcher or as `runtime/node.exe`. The service also uses Windows curl for proxy requests.

`app/启动.cmd` forwards to the EXE when available; `app/启动.vbs` remains a compatibility entry. For diagnostic console output, run `app/启动.cmd --console` from a terminal in the tool folder.

The interface normally opens at `http://127.0.0.1:8788/`; another port is selected if necessary. Closing the tool page normally stops the background service after a short grace period. Enable the stay-running option in Management if you want it to remain running. Restart the service after backend updates.

## All-region group overview

Expand a project group in the top level selector and choose its first entry, **Group name · Review overview**, to combine the locally saved reviews of every registered entry in that group. Individual regions remain available below it. Missing or unregistered regions are not synced.

The overview is indented beneath its group alongside the individual regions. It displays the overview label and review count using the same group-name-and-overview format as the collapsed selector; the collapsed selector retains the group name. Long labels wrap; Enter or Space opens the overview. Removing regions refreshes its membership and counts. Renaming or merging a selected group retains the new group's overview. If the group disappears, selection falls back to an available individual entry. Removing all entries clears the list and disables sync. Switching views while syncing does not re-enable sync buttons.

See [testing notes](app/docs/TESTING.md) for regression coverage and commands.

The main sync and full-refresh buttons target the entire selected group, and the overview stays selected after refresh. Partial sync failures are reported while successful entries update; failed entries retain their previous local data. If any member file cannot be loaded, the overview reports an error instead of presenting incomplete results as complete.

Search, rating/template and date filters, statistics, sorting and CSV export apply to the combined list. Review cards show the source region. Time sorting uses review timestamps; the combined positive rate is calculated from local reviews. Matching IDs or text across regions remain separate reviews. Comment CSV files include game and region columns. Stars save notes to the original entry; locating a note opens that individual entry. This virtual view creates no extra data directory and preserves existing storage.

## Hands-on first-run guide

The first visit opens a six-step hands-on guide: choose a language, actually add and sync a level, try label filters, star a comment, write and verify a note, and review the main tabs. Enter your own level ID or share link. Lookup starts after a short typing pause and repeats when the region changes; the lookup button and Enter key remain available. Confirm the preview before adding. This registers the level and downloads real comments; saved comments and personal notes are also stored locally. Simplified Chinese starts with China servers; other languages start with global servers, with manual region selection available.

The target uses a continuous gold halo, a directional arrow and a step label that track scrolling and window size. These disappear when the guide ends; reduced-motion preferences retain a static highlight.

The guide verifies results through the local comments and notes APIs. Network failures, an empty collection, an unsaved comment or an unconfirmed note cannot count as completion. The labels step explains official ratings and detected templates and requires filter interaction. The notes steps require saving a comment and a nonempty personal note. The final step explains Comments, Notes and Management, including grouping, locating originals and exports.

Later ends the guide while retaining imported data and notes; any synchronization already in progress continues. Reopen it with the guide button at the top right. Completion or dismissal prevents automatic display in this browser. A new guide version, a different browser or port, or clearing browser storage may show it again.

## Adding a level

Choose **Add Wonderland**, select the server, and paste a level ID or a share link. Links using `level_id=` or `id=` are supported, including URL-encoded links. A bare ID requires the correct region to be selected. China regions are `cn_gf01` and `cn_qd01`; global regions are `os_asia`, `os_euro`, `os_usa` and `os_cht`.

With Simplified Chinese (`zh-cn`) selected, the dialog initially shows China servers. Every other interface language, including Traditional Chinese, initially shows global servers. You can switch either way; language does not determine the level's actual region.

China-server name search finds share links in Miyoushe posts. It is not a complete level directory: no search result does not mean a level does not exist. Use a level ID or link when possible. Global levels use the ID/link entry.

The level name is retrieved automatically. Choose an existing group or create a new one to keep regional versions together. Different regions can have different IDs and names. Entries are distinguished by region and level ID; grouping is stored explicitly in `config/games.json`.

## Import multiple regions at once

In Add level, choose **Import multiple regions**. Enter a separate ID or share link for each published region, and leave the others blank. For example, you can fill only Asia and Europe. A link whose region does not match its row is rejected with a message. Uncheck Include to keep a row’s input while excluding it from lookup and import. Errors distinguish invalid format, official business replies, a missing proxy, proxy failure and an incomplete network request. Network failures do not prove an invalid ID, and unconfirmed levels are not registered under numeric fallback names.

Each row looks up its ID or link automatically and previews the cover, name and rating; you can also click Look up. The first successful lookup fills the group name, while other names become dropdown suggestions. Click anywhere in the group field to open all choices while editing the text, or click a choice to fill it in. Manual group edits are preserved. Clearing the custom name immediately restores the first successfully looked-up, included level name. Editing or clearing a row removes its old preview. If imported without a lookup or group, the first successful import supplies the group. Enable synchronization to fetch comments for the successfully imported entries. The dialog closes after a successful import by default. Select Keep this window open after import to retain it; partial failures always keep it open for correction. Failed rows remain editable for retry; successful rows are locked and skipped on resubmission. A later sync failure preserves the saved registrations.

## Comments and synchronization

- **Sync latest:** refreshes the parent-comment index and automatically downloads accessible replies page by page. Old parent comments are revisited to discover newly added replies, so this can take longer than earlier versions.
- **Full refresh:** fetches the collection again, refreshing existing content. Use it when incremental synchronization appears incomplete.
- **Group sync / group full refresh:** runs the corresponding operation across the entries in the selected group.
- Search nicknames, text, comment numbers and IP locations; sort by time, likes, length or reply count; filter ratings and inclusive date ranges; export comments to CSV.
- Save a comment as a note using its star button.

Positive and negative ratings come from the official recommendation field, rather than inferred sentiment. The official approval rate and the rate calculated from locally collected comments can differ.

Default-template filtering uses known multilingual patterns and repeated-text detection. The template threshold controls frequency-based detection: lowering it is more sensitive and may classify repeated personal phrases as templates. Review the template statistics when adjusting it. These are heuristics, not a guarantee of perfect classification.

Full synchronization combines comment-number pagination with popular-order results. Parent-comment pages may contain only short reply previews; normal sync additionally paginates the reply endpoint described below. Unavailable, hidden or deleted content and remote failures can still prevent a complete archive. Durations depend on the network and collection size.

## Replies, new-item highlights and appearance

Returning to the default theme clears preset page, text, control and color-scheme overrides together, preventing mixed light/dark colors. Review authors and reply authors use the accent color; reply targets are subdued and bodies remain separate text. Thread summaries include the parent floor and author. Responses that explicitly identify a different level or parent are rejected before saving.

Normal sync uses the official `parent_reply_id` reply endpoint for the corresponding China/global service, rather than relying on the first two inline previews. Up to three threads are processed concurrently. Each thread has safeguards of 30 seconds, 50 pages and 1,000 replies. Errors, repeated cursors and limits mark the thread incomplete, preserving existing content for retry; three failures stop further batch attempts and mark remaining threads incomplete. Hidden, deleted or inaccessible content cannot be guaranteed.

Reply threads are collapsed by default. Their summary shows the reply count and new-reply indicators; click to expand/collapse. Nested data and reply targets are displayed when returned by the service. Loaded reply bodies are stored in `comments.json` and can be opened offline; only the individual refresh button reconnects. CSV includes reply count and loaded reply text.

Newly collected parent comments and replies are highlighted, and sync reports both counts. Update markers persist in each entry's comment file across restarts. **Clear update markers** clears markers for the selected entry or overview group without deleting comments or notes. “New” means first collected locally, not necessarily recently posted; first imports mark all imported content as new.

The **Appearance** tab offers 10 themes: Default night, Whale in the stars, Fresh woodland, Clear daylight, Warm lanterns, Glacial water, Sakura blush, Washi journal, Violet lightning and Golden stone. Click a palette preview card to switch. Themes vary their backgrounds, borders and corner styles; five colors remain customizable.

There are 12 optional animations: blue whales, hearts, stars, amber butterflies, water/bubbles, leaves, petals, snowflakes, violet bolts, lanterns, digital crystals and dream butterflies. All graphics are local SVG silhouettes; reference character portraits and official logos are not bundled. Legacy pufferfish settings migrate to blue whales. Particles use evenly staggered phases, and color changes do not restart them. Animation is off by default, ignores clicks, pauses in background tabs and hides for reduced-motion preferences. Reset restores the default. Browser preferences are excluded from distribution packages. Maintain readable contrast when choosing custom colors.

New-comment/reply totals appear inside the filter toolbar. New parent comments, threads containing marked replies and individual marked replies have distinct markers.

## Saved notes and management

Notes span all registered levels. Edits save after about 0.6 seconds or when the field loses focus. Drafts survive rerendering within the current page; save failures are reported. Wait for saving to finish before closing or refreshing. Note writes and removals are serialized, and CSV export waits for pending saves. Comment and saved timestamps use the device’s local timezone. Add personal text, group notes by game and/or region, or jump back to the source comment. A saved comment snapshot remains available even if the source comment disappears. Notes CSV includes the game, region and comment information alongside your own note.

Management lets you rename, merge or split groups, inspect storage, and control service lifetime. **Removing a registration keeps its stored data. Deleting an entry or group also deletes its local comments and notes.** Read the confirmation carefully and back up first. Removing or deleting registrations is blocked while synchronization is running. Storage names are disambiguated even when Windows normalization would otherwise collide; retained data is reused only for a matching region and ID. JSON files are saved through temporary-file replacement, and corrupt files are reported rather than silently treated as empty.

## Network and proxy fallback

Routing applies to **both China and global servers, regardless of your country**. In normal automatic mode, requests start with a direct connection unless a recently successful route is cached. If the route fails with a network or region-blocking error, the collector tries an existing local proxy and reports progress in the synchronization log.

Proxy selection considers an explicit `--proxy` argument or proxy environment variable (`QXQY_PROXY`, `HTTPS_PROXY`, `https_proxy`, `ALL_PROXY`, `all_proxy`), then Windows system proxy settings, `config/proxy.txt`, and common local proxy ports. Explicit proxy settings take priority; automatic selection can skip temporarily failed proxies and try alternatives. Diagnostic route overrides can change automatic behavior.

Enable your proxy client's system-proxy option, or place a proxy address in `config/proxy.txt`, for example:

```text
http://127.0.0.1:10808
```

The address above is a loopback example, not a supplied proxy. HTTP and SOCKS5 proxy URLs are supported. The collector does not provide a proxy client, subscription or remote node. If no usable route exists, it reports an error. A valid business error, such as a nonexistent level, does not by itself mark the proxy as broken.

To inspect local proxy detection, run `node app/collect.js proxy`. Diagnostic output may contain your proxy details; review it before sharing.

## Files and optional commands

The program consists of the EXE and complete `app/` folder; working configuration and collections live in `config/` and `data/`. Publication also includes license, release notes and verification files; see the [delivery inventory](app/docs/RELEASE-CHECK.md). Compatibility launch scripts are inside `app/`.

| File | Purpose |
|---|---|
| `Miliastra Wonderland Comment Collector.exe` | Windowless Windows launcher |
| `app/assets/` | Application icon assets |
| `app/app.html`, `app/i18n.js`, `app/onboarding.js`, `app/batch-add.js` | Interface, translations and first-run guide |
| `app/appearance.js` | Themes, particles and hover preferences |
| `app/server.js` | Local HTTP service |
| `app/collect.js` | Collection, synchronization and storage |
| `app/import-batch.js`, `app/note-store.js` | Multi-region import and serialized note saving |
| `app/tests/` | Unit tests and isolated local-service integration tests |
| `app/docs/API.md` | Local API and storage reference |
| `config/games.json` | Registered levels and groups |
| `data/<level-name>/comments.json` | Collected comments and level metadata |
| `data/<level-name>/notes.json` | Saved comments and personal notes |
| `config/proxy.txt` | Optional local proxy configuration |
| `config/cookie.txt` | Optional login credentials; public collection normally needs none |
| `app/launcher/` | Launcher source, manifest and build script |

Normal use requires no terminal. Optional commands, run from the tool folder:

```text
node app/collect.js list
node app/collect.js add "Example level" <level-id-or-link>
node app/collect.js sync [name] [--full]
node app/collect.js remove "Example level" [--data]
node app/collect.js proxy
node app/collect.js templates
node app/server.js [--port 8788] [--no-open] [--stay]
```

`remove --data` deletes stored data. Back up before using it. To rebuild the launcher, run `app/launcher/build.ps1` in Windows PowerShell with the .NET Framework C# compiler available. No downloaded build packages are required.

Run `node --test app/tests/*.test.cjs` from the tool folder to run the test suite. The integration tests use temporary data and simulated remote API responses. See the [API reference](app/docs/API.md) for technical details.

## Backups, privacy and sharing

Back up `config/games.json` and the entire `data/` folder together while synchronization and note editing are stopped. Keep backups separate from the working copy.

Prepare a separate distribution copy when sharing the tool. Review or exclude `data/`, `config/games.json`, exported CSV files, screenshots and logs: these can contain nicknames, user IDs, IP locations, level registrations and private notes. Exclude `config/cookie.txt` and clear personal proxy addresses or credentials from the distribution copy's `config/proxy.txt`. Do not delete the working collection to prepare a clean copy.

Management intentionally displays the local application/data paths. Screenshots of that page can expose your Windows username or folder layout. Review screenshots and diagnostic output before posting them. The examples in these READMEs use generic placeholders and do not require your personal paths or credentials.

Use collected public content responsibly and respect the platform's rules and other users' privacy.

## Update views, reply context and hover feedback

**Updates first** is enabled on each page load. It promotes marked parent comments and threads containing marked replies. With newest-first time sorting, available marked comment/reply timestamps order that section. Turning it off restores the selected sort. **Updates only** defaults to off and combines with search, rating, template and date filters. Unmarked ancestors may remain as necessary reply context. Comment CSV export follows the same marked reply/context rules.

Update IDs persist in each entry's comments.json. Repeated sync adds new IDs without replacing older update markers. Reopening the page/browser or restarting the service preserves them until **Clear update markers** is used. This clears the selected entry, or the entire overview group, regardless of active filters. The sync status separately reports items added by that particular sync; this is not the update-marker total.

Reply rows separate author, addressee and body. Actual nested data is indented. Hovering or focusing a row highlights posts by its addressed user within that thread. Some responses identify only a user, not an exact target reply; several posts may match. These highlights do not assert an exact parent relationship.

Appearance settings offer automatic hover feedback, a custom hover background, and a preview button. Automatic feedback follows theme and rating-button colors. Custom feedback chooses black or white text for contrast. Preferences stay in this browser; resetting returns to automatic mode. Disabled buttons do not show actionable hover feedback.

Bodies explicitly allow browser translation. Translation remains the browser/service's responsibility; short strings, names or unrecognized text such as “Yuiop” may remain unchanged. Chrome supports translating selected text; see [Chrome translation help](https://support.google.com/chrome/answer/173424?hl=en). Local source comments are unchanged.


Comment/reply updates identify content newly saved by sync since its markers were last cleared. They do not track reading or detect author edits. Viewing or expanding does not clear markers. Clearing markers keeps all content. The legacy internal unread field is retained for backward compatibility; no data migration is needed.

Direct replies to the main comment no longer show a redundant target label. An addressee label appears only when supplied by the service. Hide-default controls follow the theme in normal, selected, hover and focus states; custom hover colors also apply.

The header slides away when scrolling down into the reading area, and returns when scrolling up or reaching the top. Menus, dialogs, tutorials and keyboard navigation keep controls accessible. Small movements use hysteresis; reduced-motion preferences remove the animation. Desktop and narrow layouts share this behavior.
