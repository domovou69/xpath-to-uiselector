# Upstream watch

As a diagram: [docs/how-it-works.md](../../docs/how-it-works.md#3-quarterly-upstream-watch).

Once a quarter (the 7th of January, April, July and October),
[`.github/workflows/upstream-schedule.yml`](../../.github/workflows/upstream-schedule.yml) checks
whether the appium-uiautomator2-driver of the newest Sauce Labs Appium image, or the UiAutomator2 server it pins,
changed a file the converter's
rules depend on. When one did, the job opens an issue with the label `upstream`, and GitHub emails it. No change
means no issue. A failure (token, API, registry, no Sauce Labs image for this quarter yet) fails the job, and GitHub emails the failure. No LLM is involved:
every change to a watched file is reported, with the reference rows that cite it.

## What it watches

[`audit/upstream.json`](../upstream.json) is the single source of truth:

- `checked`: the versions last verified on the emulator. The job compares `checked` → the versions of the newest
  Sauce Labs image (below), not npm `latest`.
- `saucelabs`: where the image list is read. Sauce Labs [Appium Versions](https://docs.saucelabs.com/mobile-apps/automated-testing/appium/appium-versions/)
  ("Real Device Appium Images") releases an image `appiumX-YYYY-MM` every quarter (January, April, July,
  October), each with the latest Appium and drivers of that moment. The job reads the source of that page in
  `saucelabs/sauce-docs`, takes the newest image and its Appium and `appium-uiautomator2-driver` versions.
- Why quarterly, on the 7th: the converter's rules follow the driver, and the driver follows Appium; the Sauce Labs
  image is the stack widely in use. The image of the quarter is out by the 7th. If it is not listed yet, the job
  fails and GitHub emails it: run the workflow again ("Run workflow") once the page lists it. Change the schedule
  only if Sauce Labs changes theirs.
- `watch`: per component, the repository, the tag format and the watched files (`*` matches within one path
  segment; `match` keeps a file only when its patch matches the regex).
  - **Driver** (`appium-uiautomator2-driver`, the version in the newest Sauce Labs image; `"saucelabs": true`): `lib/commands/find.*`, the locator strategy list in
    `lib/driver.*`, the server pin in `package.json`, the settings section of `README.md`.
  - **Server** (`appium-uiautomator2-server`, the version **that driver pins**, since users get the server
    through the driver; Sauce Labs does not list it): every server file cited in
    [`reference/uia2-server.md`](../../reference/uia2-server.md), the settings classes behind
    [`docs/settings.md`](../../docs/settings.md), the androidx `uiautomator` version in `gradle/libs.versions.toml`,
    the vendored PsychoPath commit and the PsychoPath functions cited in [`reference/xpath.md`](../../reference/xpath.md).

androidx `UiSelector` itself has no tags on GitHub; a new version shows up as a change to `libs.versions.toml`.

The server moved after 10.6.6 from `appium/appium-uiautomator2-server` (tags `v{version}`) to the
[appium-android monorepo](https://github.com/appium/appium-android/tree/main/packages/uiautomator2-server)
(folder `packages/uiautomator2-server/`, tags `appium-uiautomator2-server@{version}`), without its history. `repos`
lists both homes, newest first; each version is looked up in the first one that has its tag, and watched paths are
relative to the package folder. A range that crosses the move lists the changed files (by blob SHA) with links to
both versions, but no commits or patches. Once `checked.server` is 10.7.0 or later, the old home is no longer used
and its entry can be dropped.

**Tracked issues** (`issues`): upstream issues whose outcome decides the converter's future, each with the state
and comment count last read (`seen`). Now:
[appium-uiautomator2-driver#812](https://github.com/appium/appium-uiautomator2-driver/issues/812), Appium's answer
to Google's plan to remove `UiSelector`. Every run prints a separate "Tracked issues" block in the job log and the
job summary: status, last activity and **What you need to do** (`none` while nothing changed). A new comment or a
state change also opens the issue.

## How it works

1. [`check.js`](check.js) (Node 20+, no dependencies) resolves the installable versions from npm, compares the git trees of
   both tags to find the changed watched files, and collects their commits and patches. For each server file it
   lists the reference rows (`SRV-…`, `XP-…`) that name it. It reads each tracked issue and compares it with `seen`. A release whose tag is missing from the repository is
   reported as "cannot compare", not passed. It writes `out/upstream-meta.json` and `out/upstream-changes.md`.
2. [`report.js`](report.js) writes the job summary and, when something changed, creates the issue. It skips the
   issue when an open `upstream` issue already names the same latest versions and tracked-issue states.

## After an issue

For a tracked issue: read the new comments or the resolution, then set `seen` (date, state, comments) in
`audit/upstream.json` through a PR. If Appium added a new locator strategy, plan the converter target for it and
update the "Future of `UiSelector`" note in the README. Close the issue.

For changed files:

Read the changed files against the rows in "Cited by". If a rule may have changed, re-run the edge cases
(`npm run oracle`) and the real-world fuzz (`npm run oracle:fuzz`) on the emulator with the new versions ([audit/device/README.md](../device/README.md)). When the converter still
behaves the same, update `checked` in `audit/upstream.json` first through a PR, then
[docs/environment.md](../../docs/environment.md), docs/results.md, the "Checked with" list in the root README.md and the devDependencies. Close the
issue. If `checked` is not updated, the next quarter reports the same range again (one issue per set of latest
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
