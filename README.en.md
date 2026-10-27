# Miliastra Wonderland Comment Collector

[简体中文](README.md) | English

## Local service and export protections

The local service validates the loopback Host, actual port, browser Origin and cross-site request metadata. State-changing APIs require JSON, with compatible handling for same-origin page-close beacons. Use the local address printed by the launcher. Comment and note CSV exports prefix potentially formula-like cells with an apostrophe; spreadsheet software may display that prefix. Stored comments and notes remain unchanged. These checks do not replace operating-system permissions for local processes.

## Publishing to GitHub

The official name is **Miliastra Wonderland**. The launcher is `Miliastra Wonderland Comment Collector.exe`.
Run `powershell -ExecutionPolicy Bypass -File app/launcher/prepare-release.ps1` and upload only the contents of the generated `release/Miliastra-Wonderland-Comment-Collector-TIMESTAMP/` directory. It excludes personal reviews, notes, registrations, proxies and cookies. Do not drag the entire working folder into GitHub's web uploader: web uploads do not apply `.gitignore` for you.

Tutorial progress is stored only in each user's browser localStorage and is never included in the package. New visitors automatically see the guide; completed or deferred guides can be reopened with the guide button. A browser that previously used the same local address retains its choice even after copying the files. Node.js 18 or newer must be installed and the local service must start successfully before the page can open.

A local tool for collecting public level comments from Miyoushe (China servers) and HoYoLAB (global servers). Browse, search, filter and export comments, identify default comment templates, and save comments with personal notes. The interface supports 15 languages; collected comments retain their original text.

## Getting started

On Windows, double-click **`Miliastra Wonderland Comment Collector.exe`**. The launcher has an application icon, opens the interface in your default browser, and runs the local service without a console window. No administrator access is required.

Keep the launcher together with the `app/`, `config/` and `data/` folders. This EXE is a launcher, not a standalone bundle: Node.js 18 or newer must be installed, or provided as `node.exe` beside the launcher or as `runtime/node.exe`. The service also uses Windows curl for proxy requests.

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

- **Sync latest:** fetches new comments and merges them into the local collection.
- **Full refresh:** fetches the collection again, refreshing existing content. Use it when incremental synchronization appears incomplete.
- **Group sync / group full refresh:** runs the corresponding operation across the entries in the selected group.
- Search nicknames, text, comment numbers and IP locations; sort by time, likes or length; filter ratings and inclusive date ranges; export comments to CSV.
- Save a comment as a note using its star button.

Positive and negative ratings come from the official recommendation field, rather than inferred sentiment. The official approval rate and the rate calculated from locally collected comments can differ.

Default-template filtering uses known multilingual patterns and repeated-text detection. The template threshold controls frequency-based detection: lowering it is more sensitive and may classify repeated personal phrases as templates. Review the template statistics when adjusting it. These are heuristics, not a guarantee of perfect classification.

Full synchronization combines comment-number pagination with popular-order results. API counts may include unavailable comments, and nested replies may only be returned as previews. The tool keeps the fuller nested-reply version when available, but cannot guarantee a complete archive of all replies. Durations depend on the network and collection size.

## Notes and management

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

The top level contains only the EXE, the two READMEs, and the `app/`, `config/`, `data/` folders. Keep them together. Compatibility launch scripts are inside `app/`.

| File | Purpose |
|---|---|
| `Miliastra Wonderland Comment Collector.exe` | Windowless Windows launcher |
| `app/assets/` | Application icon assets |
| `app/app.html`, `app/i18n.js`, `app/onboarding.js`, `app/batch-add.js` | Interface, translations and first-run guide |
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
