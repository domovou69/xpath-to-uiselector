# R corpus: sources

Real Android XPath locators from 20 open-source projects with Appium tests: large or organizational
suites and weak ones (courses, practice repos, one-off automations), so both careful and sloppy
locators are in. Frequencies: [`frequencies.md`](frequencies.md). Locators:
[`android-locators.json`](android-locators.json).

## Projects

Pinned at the commit below; "Downloaded" is the files that passed the filter, "With XPath" those the
scanner found an XPath literal in. Kinds: `xpath`, `xpath-dynamic` (interpolated), `xpath-ios`,
`xpath-web`, unique literals.

| Project | Commit | License | Language | Profile | Downloaded | With XPath | Occurrences | Kinds |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |
| [MetaMask/metamask-sdk](https://github.com/MetaMask/metamask-sdk/tree/99d9172e8c436c51f719eb68c3df119989279973) | `99d9172e8c` | NOASSERTION | TypeScript | large, WebdriverIO e2e | 52 | 25 | 72 | 62 / 1 / 3 / 0 |
| [session-foundation/session-appium](https://github.com/session-foundation/session-appium/tree/4581c520a09a33c58774e310a5b955dd42231594) | `4581c520a0` | none | TypeScript | large, cross-platform | 346 | 12 | 75 | 11 / 15 / 28 / 0 |
| [a-ghorbani/pocketpal-ai](https://github.com/a-ghorbani/pocketpal-ai/tree/1cddba8160be1cb49ebc71481bdce5c7315b6e28) | `1cddba8160` | MIT | TypeScript | large app, selector helpers | 69 | 3 | 22 | 11 / 10 / 0 / 0 |
| [bbc/bbcnewsandroid-automation-kotlin](https://github.com/bbc/bbcnewsandroid-automation-kotlin/tree/90f5ce062763711e475447d34a2087e7b4b9ffd9) | `90f5ce0627` | none | Kotlin | organizational, `@AndroidFindBy` | 37 | 12 | 191 | 122 / 2 / 0 / 0 |
| [sora-xor/sora2-passport-appium-tests](https://github.com/sora-xor/sora2-passport-appium-tests/tree/b5e89407373a01b798249160ffa471a124a30449) | `b5e8940737` | none | Java | organizational, cross-platform | 52 | 24 | 150 | 95 / 1 / 27 / 0 |
| [ldi-github/shirates-core](https://github.com/ldi-github/shirates-core/tree/8cbdd4b86e93f45a3be8a9fa71d50e25bff0d02e) | `8cbdd4b86e` | Apache-2.0 | Kotlin | test framework, own selector DSL | 622 | 10 | 22 | 11 / 0 / 0 / 0 |
| [dimagi/dimagi-qa](https://github.com/dimagi/dimagi-qa/tree/ff7e8820f136e5355d9614818697dc03416bfc05) | `ff7e8820f1` | BSD-3-Clause | Python | organizational, web + mobile | 24 | 9 | 240 | 34 / 3 / 0 / 129 |
| [NetherlandsForensicInstitute/puma](https://github.com/NetherlandsForensicInstitute/puma/tree/10446a5bd75f15a8325483021d10b6b88ec32449) | `10446a5bd7` | EUPL-1.2 | Python | organizational, app drivers | 131 | 28 | 361 | 255 / 62 / 17 / 0 |
| [spritz-group/QRFuzz](https://github.com/spritz-group/QRFuzz/tree/d2ff11fbd1498253e0e255400867747e713a3209) | `d2ff11fbd1` | GPL-3.0 | JavaScript | research tool, recorded paths | 77 | 21 | 62 | 46 / 0 / 0 / 0 |
| [auth0-samples/mobile-quickstarts-tests](https://github.com/auth0-samples/mobile-quickstarts-tests/tree/7ff831a50507fc55c70bd1951c049680d559af5f) | `7ff831a505` | MIT | Python | organizational sample, WebView | 8 | 2 | 10 | 2 / 0 / 0 / 3 |
| [Thangarajtk/appium-mobileAutomationFramework](https://github.com/Thangarajtk/appium-mobileAutomationFramework/tree/07e00ade6654e5e7bfba00bc95a2aed20960df40) | `07e00ade66` | MIT | Java | weak, framework template | 59 | 4 | 4 | 3 / 0 / 0 / 1 |
| [spidey143/MobileTesting](https://github.com/spidey143/MobileTesting/tree/81339931682bfd96f1af08fbf7b625a046102864) | `8133993168` | none | Java | weak, practice | 31 | 14 | 39 | 31 / 0 / 0 / 3 |
| [NayabAkhtar12/Funny-Prank-sounds-Automation](https://github.com/NayabAkhtar12/Funny-Prank-sounds-Automation/tree/c11964e3291a0118ff8d3df821ebc3618fe27f4e) | `c11964e329` | none | C# | weak, practice | 43 | 22 | 218 | 194 / 0 / 0 / 0 |
| [h080294/appium_python_android](https://github.com/h080294/appium_python_android/tree/452cc8d17363d8e46f98c59c91a128e7a5c60489) | `452cc8d173` | none | Python | weak, course | 92 | 3 | 13 | 6 / 0 / 0 / 0 |
| [TypeLife/appium-unittest](https://github.com/TypeLife/appium-unittest/tree/543d8e81b086376944bd64ccad7a7b7da48e794d) | `543d8e81b0` | none | Python | weak, unittest suite | 212 | 77 | 441 | 258 / 26 / 1 / 0 |
| [PerfectoCode/Community-Samples](https://github.com/PerfectoCode/Community-Samples/tree/96ca48c011dfbc0ea6e86a967352e5d3021986d1) | `96ca48c011` | none | Java | vendor samples | 146 | 68 | 413 | 153 / 0 / 2 / 25 |
| [haticedagli/Hepsiburada-Android-Automation-Testing](https://github.com/haticedagli/Hepsiburada-Android-Automation-Testing/tree/b1d945f2559e48e412e36d0f91a985410b3ac07e) | `b1d945f255` | MIT | Java | weak, store app | 25 | 6 | 10 | 10 / 0 / 0 / 0 |
| [phoungphoung33/uabpay](https://github.com/phoungphoung33/uabpay/tree/20bbe360fe6a1bfbca2b47235c7de88703ee6e61) | `20bbe360fe` | none | Java | weak, banking app | 35 | 31 | 282 | 91 / 0 / 0 / 0 |
| [PharmaLedger-IMI/epi-mobileapp-test-automation](https://github.com/PharmaLedger-IMI/epi-mobileapp-test-automation/tree/dcf710543b641e337bb0cac2c7b69e827430dd46) | `dcf710543b` | MIT | JavaScript | organizational, WebdriverIO, a page object copied per scenario | 219 | 105 | 1003 | 41 / 0 / 0 / 0 |
| [kerolos-mohsen/yapper-android-testing](https://github.com/kerolos-mohsen/yapper-android-testing/tree/0ed4f6babdcabcbae78687d6600dab7d97167d85) | `0ed4f6babd` | MIT | TypeScript | weak, WebdriverIO | 51 | 18 | 128 | 69 / 20 / 0 / 0 |

Total: 2331 files downloaded, 494 with XPath, 3756 occurrences, 1884 unique literals per project (1645
Android). The last five were added to balance the languages: Java and JS / TS were under their share on
GitHub (`"//android.widget"` code search, 2026-10-20: Java 10 272 files, Python 4 168, JavaScript 2 188,
TypeScript 960, C# 446, Ruby 168, Kotlin 104). `frequencies.md` also gives project-weighted shares,
because PharmaLedger repeats 41 literals 1003 times.

Considered and left out: `czl0325/coin11-tb` (drives the python-uiautomator2 library, not Appium: its
own XPath engine and no strategy call to rewrite), `webdriverio/webdriverio` (XPaths only in docs, 400 MB
repository), forks and copies of one tutorial, and LLM-agent research repositories.

## How the corpus is made

No repository is cloned.

1. **Candidates:** `gh search code` for `AppiumBy.xpath("//android`, `@AndroidFindBy(xpath`,
   `$('//android.widget`, `/hierarchy/android.widget`, `By.xpath("//android.widget`,
   `MobileBy.xpath("//android`, `AppiumBy.XPATH "//android"`, `MobileBy.XPATH "//android"`, and
   `//android.widget` per language (Kotlin, TypeScript, JavaScript, Python, C#); hits counted per
   repository, metadata (license, stars, size, last push) from GraphQL. The list was approved by the
   user before any download.
2. **Files:** the git tree at the pinned commit (`git/trees/<sha>?recursive=1`), filtered to the
   scanner's extensions, without `node_modules`, `build`, `dist`, `target`, `res`, `vendor`, lock files,
   `package.json`, `tsconfig*.json`, `*.d.ts`, minified files and files over 200 KB. Large repositories
   with app code are limited to their test folders: `e2e/` (metamask-sdk, pocketpal-ai), `src/test/`
   (shirates-core), the mobile folders (dimagi-qa); session-appium without `run/desktop` and CI. For
   dimagi-qa, puma and TypeLife, only `.py` files; for PerfectoCode, only `.java` files outside its
   iOS, Calabash, Splunk and ALM samples.
3. **Download:** those files only, from `raw.githubusercontent.com` at the pinned commit, into a
   cache outside git. Traffic for the whole stage: about 4 MB (search ≈0.4 MB, trees ≈0.6 MB,
   files ≈2.8 MB, compressed transfer).
4. **Extraction:** [`build.js`](build.js) runs the scanner in dry-run mode, with a converter that
   changes nothing, over the cache; files without an XPath literal are deleted from the cache.
5. **Anonymization:** every letter run in a quoted XPath value becomes a pseudo-word of the same
   length, script and case pattern (Latin and Cyrillic from syllables, other scripts from letters of
   the same Unicode block), with a global salted mapping: equal words stay equal across the corpus.
   Kept as they are: XPath structure, axes, functions, digits, punctuation, quotes, backslashes,
   interpolations (`${x}`, `$x`, `{}`, `%s`), words of one or two letters, `true` / `false`, Android
   framework class names (`android.*`, `androidx.*`) and ids (`android:id/…`). Other dotted class names
   (`com.vendor.FooView`) are anonymized segment by segment. The salt stays in the cache: with it the
   mapping could be reversed by hashing a dictionary.

To rebuild: download the files as above into `<cache>/<owner>__<repo>/<path>`, write
`<cache>/pins.txt` (`owner/repo sha license` per line, in the table order) and run
`node audit/corpus/build.js <cache>`. A new salt gives different pseudo-words.

## Fields of `android-locators.json`

As in xpath-to-class-chain's `ios-locators.json`, plus `project`, `lang` and `strategy`.

| Field | Meaning |
| --- | --- |
| `id` | `A0001`…, in project order, then first appearance |
| `kind` | `xpath`, `xpath-dynamic` (has an interpolation), `xpath-ios` (the scanner's iOS skip), `xpath-web` (HTML element or attribute: WebView or browser) |
| `quote` | the quote of the source string: `'`, `"` or `` ` `` |
| `source` | the literal as written in the file, anonymized; escapes (`\"`) kept |
| `count` | occurrences in the project |
| `project` | `owner/repo` |
| `lang` | language of the file |
| `strategy` | the XPath strategy call the scanner found before the literal (`@AndroidFindBy(xpath =`, `By.XPath(`, `MobileBy.XPATH`, …), `null` for a bare string |

## Context files

[`contexts/`](contexts) holds real files, or excerpts, for the scanner tests, only from the MIT and
Apache-2.0 projects, anonymized the same way; what each must do is in
[`contexts/expected.json`](contexts/expected.json), licenses in [`contexts/LICENSES.md`](contexts/LICENSES.md).
The locators of projects without a license or under copyleft licenses appear only as anonymized
single literals in the JSON.
