# Regression testing

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

