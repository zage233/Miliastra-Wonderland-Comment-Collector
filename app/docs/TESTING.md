# Regression testing

Run from the project root with Node.js 18 or newer:

```sh
node --test app/tests/*.test.cjs
```

The 2026-10-27 regression contains 98 passing tests, including subtests. Tests use isolated temporary data; do not point fixtures at a working installation's data directory.

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
