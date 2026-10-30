# Regression testing

## Localized title regression

Isolation additions cover six regions and two overlapping language batches with deliberately reversed completion order, one-region failure/retry, three repeated incremental/full sync rounds, explicit foreign level/region response rejection, and title refresh overlapping comment sync and a group edit. Tests use the same numeric ID across regions to expose incorrectly shared caches. The complete source regression is run in three consecutive rounds; generated delivery and extracted ZIP are checked separately.

`localized-titles.test.cjs` covers all 15 locale query/header values, default-language compatibility, localized search candidates, persistent locale caches, cross-region identity isolation, empty/failed responses, retries, deletion during a request, concurrent deduplication, group edits during a request, custom aliases, sync metadata, unchanged comment bodies, rapid language switching and fallback to the original rather than the previous locale. The real API suite checks localized detail/search/cache responses, stable registration/group/source files and endpoint input/origin protections.

Live read-only verification on 2026-10-29 confirmed distinct `zh-cn` and `en-us` `level_name` values for two user-provided global stages, including the DPS dummy example. This verifies those two stages/languages, not that every stage has all 15 translations. Browser QA uses isolated mock data to check label switching, note sources, stable groups and fallback; no production registrations are added.

## Notes and upgrade data transfer

`note-replies.test.cjs` verifies nested reply snapshots, legacy note enrichment, cross-region identity isolation, text preservation, missing/deleted parents, reused floor numbers, complete empty threads, persistence after individual refresh, collapsed rendering, comment-filter independence and reply CSV export. The real API suite additionally verifies that full sync persists newly added replies in existing notes.

`migrate-data.test.cjs` verifies byte-identical configuration/data transfer into a clean delivery, previous-folder preservation, unchanged program files, repeat-transfer rejection, corrupted code, incompatible formats, active-process rejection, overlapping folders, concurrent-write detection and replacement rollback. A real Windows CLI test starts an isolated background process, verifies blocking, stops only that fixture, then verifies successful transfer. Production user data is never migrated by tests.

Run from the project root with Node.js 18 or newer:

```sh
node --test app/tests/*.test.cjs
```

The 2026-10-27 regression contains 115 passing tests, including subtests. Tests use isolated temporary data; do not point fixtures at a working installation's data directory.

## Reply collection and appearance

Theme regression exercises light-to-default restoration and repeated preset/custom-to-default transitions, asserting removal of `--text`, `--bg` and related overrides while preserving unrelated layout variables. Browser verification also checks actual computed colors. Reply response tests reject explicit mismatched level/parent IDs without altering files; reply rendering separates author, target and body and exposes the parent identity in the collapsed summary.

`subreplies.test.cjs` verifies official parent IDs, pagination and server cursor order, deduplication, incomplete repeated cursors, preservation after failure, deletion during an in-flight request, shared refresh jobs, unknown-parent rejection and nested cycles. The API fixture exposes paginated replies, newly added replies on a previously zero-reply parent, and explicit reply failures. Integration tests verify automatic collection, persistent update markers, explicit marker clearing, retry and partial-failure reporting. Overview tests cover new-item markers, reply-count sorting and collapsed threads.

`appearance.test.cjs` verifies defaults, valid preset colors, browser-local preference round trips, and rejection of CSS/URL injections. Browser checks cover theme persistence/reset, bounded noninteractive particles, multilingual layout and collapsed/expanded reply rendering. China public replies were also verified read-only against a three-reply sample; a global-region endpoint returned an empty, successful reply list, which does not constitute a live nonempty global-pagination verification.

## Group overview combinations

- Combine only registered members of the selected group, including all of its regions; skip empty local files while including empty entries in sync targets.
- Keep matching reply IDs across regions separate in cards, stars and note writes.
- Apply search, dates, ratings, template filters, timestamp sorting and CSV export to the combined list; export original game and region.
- Reject stale reads after switching views. A member read failure must not silently show an incomplete overview.
- Remove one region, retain the overview, correct its selected anchor and recalculate its count.
- Re-register retained data and include it again; move a region to another group and remove it from the old overview.
- Rename a selected group, merge it into an existing group, and preserve the resulting overview selection.
- Permanently delete one entry, then remove the remaining group registration; fall back to a valid single entry.
- Remove all registrations; clear the selection and data and disable sync controls.
- Prevent deletion during sync. Keep sync controls disabled when changing views during a running job.
- Render the overview as an indented group child using its group name followed by the review overview label; retain the group name in the collapsed selector, keyboard activation and wrapping for long labels.

`api-integration.test.cjs` runs the real local service, collector and storage in a temporary directory. The new combination test also executes frontend loading and rename handlers against that service. Official remote responses are mocked for repeatability; this does not certify availability of external services or individual proxies.

`group-overview.test.cjs` checks aggregation, selection, error/race handling, original-entry note writes, sync targets and empty-state controls. Existing tests cover proxy fallback, imports, tutorial persistence, translations, storage failures and note autosave races.

Browser verification uses a separate mock-service copy to check the group selector, aggregation, sync, stars, exports and responsive layout. No production comments or notes are changed by this workflow.

## Security regression

`security.test.cjs` checks trusted loopback hosts and actual ports, foreign/null origins, cross-site Fetch Metadata, JSON-only writes and compatible same-origin beacons. It also tests formula-safe CSV cells, leading whitespace/control characters, fullwidth markers, normal multiline text and shared encoding in both exports.

The real-service integration test verifies that foreign-origin deletion, group deletion, note removal and settings requests are blocked without changing the registration or note files. It covers plain-text writes, an untrusted Host sent through a raw HTTP client, legitimate same-origin JSON requests, localhost and heartbeat/close beacons. Existing automatic-exit and API error classification tests use realistic trusted request headers.

## Publication checks

`release-files.test.cjs` compiles every JavaScript source and HTML inline script without running it, checks local script/icon assets and Markdown links, scans source/docs for known personal absolute paths and private-key headers, verifies the MIT license file and English launcher references, and verifies that all 15 overview labels use a short title. The same complete regression is run from a clean generated release directory. This is a targeted publication check, not a guarantee that arbitrary future uploads contain no sensitive data.

## Reference-inspired theme regression

`appearance.test.cjs` checks ten presets, twelve effects, legacy fish-to-whale migration, invalid settings, light/default switching, body/author contrast (at least 4.5:1 against preset panels and cards), and a 30-minute phase simulation sampled every half second. This is a deterministic animation-phase check, not a 30-minute real-time browser soak.

Visual QA uses a separate mock-data service. Check all themes in comments, appearance, notes, management and add dialogs; inspect actual computed body colors, toolbar update totals, parent/new-reply markers, native reply collapse, and narrow-screen overflow. Check every SVG effect renders, remains click-through, and preserves phase when changing colors. Verify the clean release has an empty registration list and no user comments or credentials.

Combination QA also checks that adding/removing notes updates management counts after switching tabs. Sharing guidance in all 15 languages points to the clean-release script instead of deleting the working collection.

## Update markers, relationships and hover regression

unread-view.test.cjs verifies old-parent/new-reply priority, normal-order restoration, combined filters, preserved legacy update metadata, branch/context retention, empty views after marker clearing, row indentation, addressee highlighting and translatable body nodes. Appearance tests cover old preference migration, hover color validation and black/white text selection. API integration checks repeated sync retains previous update IDs, zero additions are reported, and markers are stored on disk.

Browser QA checks all ten automatic hover themes, custom white hover with black text, close/reopen plus repeated sync, updates-only view, addressee hover/focus highlighting, actual nested indentation, narrow layouts and update-marker clearing. Browser translation quality for arbitrary words is outside these tests.

The public terminology is now updates, not unread. Existing unread storage/API names and test filenames remain for compatibility. Verify all 15 live dictionaries use update terminology, normal replies have no main-comment target chip, and hide-default normal/checked/hover/focus states follow all ten themes. Combined-filter, nested-context, marker persistence and explicit clearing tests still apply.

reading-header.test.cjs checks downward hiding, upward reveal, top-of-page behavior, small-scroll hysteresis, interaction locks and tall narrow-screen headers. Browser combination tests additionally cover actual PageDown/PageUp, open selector protection, group sync while editing a note, stable management table columns across collapse, all 15 update labels, all ten hide-default palettes and custom hover colors.


## First-sync marker lifecycle

update-rounds.test.cjs verifies page-round snapshots, stable region/level identity across renames, independent regions, manual clearing, and old-backend detection. update-rounds-api.test.cjs launches the real service in an isolated directory and checks partial additions plus failed replies, retry without losing current-session additions, no-change sync accumulation, a fresh-page baseline clearing previous markers, independent group-member failure, unchanged comment bodies, and invalid baseline input rejection.

## Official account entry regression

`accounts.test.cjs` checks platform/command input rejection, separate China/global windows, repeated clicks before startup, exit/reopen and stale process events, missing components, process errors, frontend out-of-order results, network failure recovery and all 15 management-page language dictionaries. The real HTTP suite verifies resources, invalid platforms, origin/content-type protection and the absence of credentials or posting authorization in status responses.

The native helper build runs address/region/role-response checks and initializes a real blank WebView2 control. These checks do not validate live account sign-in, OAuth callbacks, the official login dialog layout or Wonderland posting permission. The diagnostic native-window controls currently use Chinese; the collector's account panel has 15 language dictionaries. Automated tests do not send real comments. The separate, explicitly authorized live check is recorded below.


## Local reply and latest-query integration · 2026-10-29

The complete automated suite contains **230 passing tests**, with zero skipped tests. Replies and remote collection are mocked in disposable directories; tests never read real account profiles or publish official replies. Existing import, group, title, update-round, appearance, notes, storage, security and release checks remain included.

- replies.test.cjs: target/region/root/child identity, own-role matching, ticket expiry, sync exclusion, account separation, duplicate UUIDs, concurrent sends, restart receipts, unknown results, pre-POST disk failure, post-confirmation local failures, deletion ownership/confirmation and preserved descendants/notes/history.
- reply-panel.test.cjs: late target responses, account-separated drafts, failed rechecks, sending/ESC locks, unknown-attempt restoration, successful draft cleanup, own-delete visibility/confirmation and locale rerendering.
- reply-api.test.cjs: real isolated HTTP server plus fake native bridge; latest queries and snapshot pages, sender matching, one local send, duplicate receipt, own deletion, note history, foreign-origin refusal and original sync language forwarding. Response bodies are checked against the included OpenAPI schema keywords by a test-only validator; this is not a full standards validator.
- latest.test.cjs: recent nested replies under old roots, own publication times, source/group/kind/update filters, same IDs on different servers, cursor invalidation after file changes, legacy missing IDs and corrupted/foreign data rejection.
- account-bridge.test.cjs and native --self-test: fixed subprocess arguments, UTF-8 pipes, timeouts/unknown outcomes, send/delete parameter validation. Native login --self-test and --smoke also pass; smoke initializes a blank real WebView2 control.
- Browser: disposable Chrome mock origin, root/child reply opening, automatic role display, explicit fake send/success state, own-child delete visibility, English locale and Sakura light theme. Initial heading and footer fit a 1294×591 viewport without horizontal overflow. The footer remains available while the dialog body scrolls. Browser deletion confirmation behavior is covered by the panel test; no official deletion was executed.

Separate live validation: the operator signed in to Miyoushe and authorized exactly one test reply on their own floor-4 review. The post succeeded and official readback found it. The operation used an isolated local corpus/attempt ledger; production config/data were not rewritten. Do not rerun this live test as regression or silently delete the test reply.

HoYoLAB has not been verified after real login for role selection/posting. Public deletion is not live-verified. Official risk controls, proxy availability, OAuth providers and future endpoint behavior remain external limits. Root-review deletion is not implemented.


### Detection and compact composer follow-up

Five additional tests cover 60-second per-region cache expiry, defensive copies, forced reads, platform invalidation, stale inflight results, cross-account invalidation, failed writes and unavailable-result handling. Existing panel tests now cover immediate source preview, forced account rechecks, discarded pre-login responses, compact account controls and a separate management mode that cannot send. All 15 languages include the new labels.

The native self-test exercises fast preferred reads, a slow preferred route with a successful fallback and loser cancellation, both-route failure, and a healthy official business rejection without a duplicate request. Writes still use one POST. Real read-only China detection samples were about 29.5 seconds before, then 5.2 and 4.7 seconds after; the immediate same-region cache hit took under one millisecond in the backend measurement. Network timeout failures also occurred, so these are observations rather than guaranteed limits or a controlled latency study. No public message was sent or deleted in this follow-up.

Browser follow-up uses disposable data: default reply mode, folded/expanded account options, an own-child management/delete mode, a fake send, Sakura light and Golden Stone skins. The compact default dialog fits the 1304×591 desktop viewport without hiding its title or footer. Earlier full-editor screenshots are historical; the default now contains no login/recheck/delete button grid.


### Reply-label, account layout and verified deletion fixes · 2026-10-30

The three added Node tests cover unverified native success, acknowledged-but-unknown deletion, unchanged local files, no duplicate POST, legacy receipts without proof and frontend refusal to report old success as verified. Relationship tests also cover identical numeric/string UIDs, retained self-reply text and distinct players with the same nickname.

Native self-tests now exercise the actual verification state machine with injected read/delete delegates: owned-target disappearance, a retained target, already-absent cleanup without POST, incomplete preflight, foreign ownership, readback failure and official rejection. All verify at most one destructive request. They do not perform a public deletion.

An official read-only full-thread query before the interruption found that the user-deleted original test reply was absent, with the two later test replies still present. This is evidence for that specific user operation, not a live run of the newly added pre/post verifier. No public reply was sent or deleted by the agent in this fix round. Production config/data are checked against the fresh pre-fix baseline, which includes the user’s own intervening operations.

Browser QA used the in-app browser and disposable data because the Chrome extension was disconnected: a self-targeted row retains its body without a target badge; another player keeps its badge. Expanded account settings have zero outer border, zero inherited bottom margin and zero extra gap before contents. Saved screenshots show the actual page, with no production account data.


### Read-only reconciliation and close preference

Six added Node tests cover the separate readonly native command, unknown-delete receipt promotion without a second delete, present/incomplete/failed readback, concurrent verification, HTTP refresh validation, preserved attempt locks on busy responses, default close, persistent stay preference, and keeping failed/partially saved dialogs open. Native validation accepts verification commands without account aid but still requires original owned UID/context.

A real logged-in Europe profile was used only for reading: the screenshot target was absent from the authenticated official thread. An isolated copy containing that one parent and attempt was reconciled through the new service; it became verified/deleted with local-copy cleanup and no public write. Original config/data were not used as a writable test database. This checks read-only reconciliation, not a new public deletion.

### Automatic deletion follow-up and narrow login window

Ten new Node tests cover delayed disappearance after retained/incomplete/failed reads, bounded retries and deadlines, service restart, login mismatch, busy sync, local-save retries without another official request, old pending recovery, registration removal, damaged storage, dialog close, stale replies arriving into another composer, backend receipt restoration without a draft, and page reload. A real localhost HTTP test uses the normal 3/7 second first follow-up delays: retained once then absent, one simulated deletion POST, two read-only checks, local row removal and note history preservation. Existing shutdown regression now checks that active and newly started background verification delays auto-exit.

Native build self-tests validate FitZoom bounds. The real hidden WebView2 smoke test loads a local 1280px layout with an account button at the right, checks visibility at 740/900/1140px windows, and checks manual zoom. No official login or public write is performed by these tests. Browser QA uses disposable mock replies only. Production config/data are checked against the fresh pre-change hash baseline.

### Account disclosure, onboarding and security-focused checks

Ten additions cover explicit Show/Hide labels and collapse persistence across render/language changes; login, role and network reason separation; fifteen-locale completeness; optional tutorial platform selection; actual mgmt tab navigation and highlight cleanup; visible non-success window-request messages; and credential canaries in account/role/error responses. Raw HTTP tests exercise Origin/null/Fetch metadata/Host denial and static configuration, receipt, executable and traversal path refusal. Arbitrary retcode text is now dropped instead of truncated into receipts. Native self-tests and the real WebView2 smoke are rerun separately.

Browser QA walks real mock import, filters, note creation and persisted editing before the new optional sign-in lesson. It checks both dark and pink themes, explicit collapse labels, owner-only deletion explanations, actual account-section navigation and the retained final translation tip. No real credentials are entered and no official replies are posted/deleted. [SECURITY.md](SECURITY.md) documents scope and local-client limitations rather than claiming universal security.


### Login window visibility and restoration · 2026-10-30

The complete suite now contains **230 tests** with zero failures or skips. Four new tests cover split native readiness output, spawn without visibility, bounded invalid/oversized/no-output responses, extra-field redaction, concurrent repeat activation, activation errors, retained real-window ownership and the frontend focus-denied notice. Existing tests additionally verify the new messages in all 15 locales. Opening a window never grants account or sender authorization.

The native --activation-smoke runs a profile-free Windows form, minimizes it and restores it through the real fixed-EXE activation subprocess, validating the bounded visibility protocol. A separate call targeting the test PowerShell PID is rejected because its executable differs. The native login self-test, real local-layout WebView2 smoke and Session Bridge self-test also pass. These checks do not sign in to official services, use real cookies, or send/delete public content. Windows foreground-focus restrictions remain possible and receive an explicit UI message.

Delivery gate: the full suite is run from source, the clean delivery folder and the extracted final ZIP. Program/document hashes, backup integrity, personal-data hashes and package credential scans are checked separately. Prior browser and live records above remain historical evidence; this round does not claim a new live login/post/delete or a fresh visual run of every theme.
