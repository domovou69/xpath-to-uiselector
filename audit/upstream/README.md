# Upstream watch

Once a month, [`.github/workflows/upstream-schedule.yml`](../../.github/workflows/upstream-schedule.yml) checks
whether a new appium-uiautomator2-driver release, or the UiAutomator2 server it pins, changed a file the converter's
rules depend on. When one did, the job opens an issue with the label `upstream`, and GitHub emails it. No change
means no issue. A failure (token, API, registry) fails the job, and GitHub emails the failure. No LLM is involved:
every change to a watched file is reported, with the reference rows that cite it.

## What it watches

[`audit/upstream.json`](../upstream.json) is the single source of truth:

- `checked`: the versions last verified on the emulator. The job compares `checked` → latest.
- `watch`: per component, the repository, the tag format and the watched files (`*` matches within one path
  segment; `match` keeps a file only when its patch matches the regex).
  - **Driver** (`appium-uiautomator2-driver`, latest on npm): `lib/commands/find.*`, the locator strategy list in
    `lib/driver.*`, the server pin in `package.json`, the settings section of `README.md`.
  - **Server** (`appium-uiautomator2-server`, the version the **latest driver pins**, since users get the server
    through the driver; the newest server on npm is shown for information): every server file cited in
    [`reference/uia2-server.md`](../../reference/uia2-server.md), the settings classes behind
    [`docs/settings.md`](../../docs/settings.md), the androidx `uiautomator` version in `gradle/libs.versions.toml`,
    the vendored PsychoPath commit and the PsychoPath functions cited in [`reference/xpath.md`](../../reference/xpath.md).

androidx `UiSelector` itself has no tags on GitHub; a new version shows up as a change to `libs.versions.toml`.

## How it works

1. [`check.js`](check.js) (Node 20+, no dependencies) reads the latest versions from npm, compares the git trees of
   both tags to find the changed watched files, and collects their commits and patches. For each server file it
   lists the reference rows (`SRV-…`, `XP-…`) that name it. A release whose tag is missing from the repository is
   reported as "cannot compare", not passed. It writes `out/upstream-meta.json` and `out/upstream-changes.md`.
2. [`report.js`](report.js) writes the job summary and, when something changed, creates the issue. It skips the
   issue when an open `upstream` issue already names the same latest versions.

## After an issue

Read the changed files against the rows in "Cited by". If a rule may have changed, re-run the S cases and the R
fuzz on the emulator with the new versions ([audit/device/README.md](../device/README.md)). When the converter still
behaves the same, update `checked` in `audit/upstream.json` first through a PR, then
[docs/environment.md](../../docs/environment.md), docs/results.md and the devDependencies. Close the
issue. If `checked` is not updated, the next month reports the same range again (one issue per set of latest
versions).

## Test

Locally:

```sh
GH_TOKEN=$(gh auth token) node audit/upstream/check.js                                          # real versions
GH_TOKEN=$(gh auth token) node audit/upstream/check.js --driver-base 8.0.0 --server-base 10.0.0  # many changes
node audit/upstream/report.js --dry-run                                                         # print the issue
```

In GitHub: Actions → Upstream schedule → Run workflow, with `driver_base`, `server_base` and `dry_run`. Or
`gh workflow run upstream-schedule.yml -f server_base=10.0.0 -f dry_run=true`.

Measured on 2026-10-21: the real versions (driver 8.7.0, server 10.6.6) report nothing to do; with the bases 8.0.0
and 10.0.0, 4 driver files and 18 server files changed, and the changes list (about 61 KB) is cut to fit an issue body; the full list is the run artifact.
