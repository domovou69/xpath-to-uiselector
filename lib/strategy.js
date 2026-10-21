// Explicit XPath strategies around a locator string.
//
// Carried over from xpath-to-class-chain (audit RC-S1, RC-S2). When a string is
// passed to a call that names the XPath strategy — `AppiumBy.xpath("…")`,
// `(By.XPATH, '…')`, `@AndroidFindBy(xpath = "…")` — rewriting only the string
// leaves the strategy at XPath and breaks the locator at runtime. So the call is
// rewritten together with the string where the client has a UiAutomator
// strategy (PLAN.md section 2); otherwise the string is left alone and reported.
//
// Markers are per language and taken from the client sources, not guessed:
//   JVM     Selenium By.xpath; java-client AppiumBy / MobileBy (both extend By);
//           xpath() on @AndroidFindBy, @AndroidBy, @iOSXCUITFindBy, @FindBy;
//           @FindBy(how = How.XPATH, using = …); Selenium 3 findElement(s)ByXPath
//   Python  By.XPATH = "xpath"; AppiumBy / MobileBy (subclasses of By);
//           find_element(by, value); Selenium 3 find_element(s)_by_xpath
//   C#      By.XPath (MobileBy extends By); AppiumDriver.FindElement(string by,
//           string value); XPath = … on the dotnet-client 4.x FindsBy* attributes;
//           [FindsBy(How = How.XPath, Using = …)]; Selenium 3 FindElement(s)ByXPath
//   Ruby    find_element(:xpath, …) / find_element(xpath: …) (SearchContext
//           FINDERS); appium_lib helpers xpath / xpaths
//   JS/TS   CodeceptJS strict locator { xpath: … }; WebdriverIO
//           findElement(s)(using, value); selenium-webdriver By.xpath
//   PHP     php-webdriver WebDriverBy::xpath
// Data/config files have no call around the string, so nothing there is
// treated as a strategy.
//
// Each pattern is anchored at the end of the text that precedes the opening
// quote, so only the call the string is an argument of counts — an XPath call
// that closed earlier on the same line does not. `\s` spans newlines, so a
// marker on the previous line (multi-line calls, annotations) is found too.
// Group `m` is the marker shown in the skip reason.

// Annotation / attribute arguments up to `<key> =`; quoted strings are skipped
// whole so a `(` or `)` inside an earlier argument value does not end the match.
const ARGS = String.raw`(?:[^()"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*?`;

// The XPath strategy passed as a string: find_element("xpath", …).
const XPATH_STRING = String.raw`(?<m>(?<q>['"])xpath\k<q>)\s*,\s*`;

const JVM = [
  /(?<m>\b(?:AppiumBy|MobileBy|By)\.xpath\s*\(|\bfindElements?ByXPath\s*\()\s*$/,
  new RegExp(String.raw`(?<m>@[\w.]+\s*\(${ARGS}\bxpath\s*=)\s*$`),
  /(?<m>\bHow\.XPATH\s*,\s*using\s*=)\s*$/,
];

const PATTERNS = {
  java: JVM,
  kotlin: JVM,
  groovy: JVM,
  python: [
    /(?<m>\b(?:AppiumBy|MobileBy|By)\.XPATH)\s*,\s*(?:value\s*=\s*)?$/,
    new RegExp(`${XPATH_STRING}(?:value\\s*=\\s*)?$`),
    /(?<m>\bfind_elements?_by_xpath\s*\()\s*$/,
  ],
  csharp: [
    /(?<m>\b(?:MobileBy|By)\.XPath\s*\(|\bFindElements?ByXPath\s*\()\s*$/,
    new RegExp(`${XPATH_STRING}$`),
    new RegExp(String.raw`(?<m>\b[\w.]+\s*\(${ARGS}\bXPath\s*=)\s*$`),
    /(?<m>\bHow\.XPath\s*,\s*Using\s*=)\s*$/,
  ],
  ruby: [
    /(?<m>:xpath)\s*(?:,|=>)\s*$/,
    /(?<m>(?<![\w:])xpath:)\s*$/,
    new RegExp(`${XPATH_STRING}$`),
    /(?<m>(?<![\w:])xpaths?(?:\s*\(|(?=\s)))\s*$/,
  ],
  js: [
    /(?<m>(?<![\w$])(?<q>['"]?)xpath\k<q>\s*:)\s*$/,
    new RegExp(`${XPATH_STRING}$`),
    /(?<m>\bBy\.xpath\s*\()\s*$/,
  ],
  php: [
    /(?<m>\bWebDriverBy::xpath\s*\()\s*$/,
  ],
};

const { LANGUAGE_BY_EXTENSION } = require('./literal');

// `d`: match indices, so the marker can be rewritten in place.
for (const list of new Set(Object.values(PATTERNS))) {
  list.forEach((re, i) => { list[i] = new RegExp(re.source, `${re.flags}d`); });
}

// How far back from the opening quote a marker may start. Covers a marker a
// few lines up in a formatted call; a longer prefix only costs regex time.
const LOOKBACK = 400;

// Returns { marker, start, end } when the string starting at `offset` (its
// opening quote) is passed to an explicit XPath strategy, else null. `marker`
// is the normalized text shown in reports (e.g. "AppiumBy.xpath("); start/end
// are the marker's offsets in `content`.
// What may stand between the strategy and the opening quote: a format call
// (String.format("…%s…", x)) and a string prefix (Python f"" / r"", C# $"" / @"").
const WRAPPER = {
  java: /String\.format\s*\(\s*$/, kotlin: /String\.format\s*\(\s*$/, groovy: /String\.format\s*\(\s*$/,
  python: /(?<![\w])[rRfFbBuU]{1,2}$/,
  csharp: /(?:[Ss]tring\.Format\s*\(\s*)?(?:\$@|@\$|\$|@)?$/,
};

function findXpathStrategy(content, offset, ext) {
  const lang = LANGUAGE_BY_EXTENSION[ext];
  const patterns = PATTERNS[lang];
  if (!patterns) return null;
  const base = Math.max(0, offset - LOOKBACK);
  let prefix = content.slice(base, offset);
  if (WRAPPER[lang]) prefix = prefix.replace(WRAPPER[lang], '');
  for (const re of patterns) {
    const m = re.exec(prefix);
    if (m) {
      const [start, end] = m.indices.groups.m;
      return { marker: m.groups.m.replace(/\s+/g, ' ').replace(/\( /g, '('), start: base + start, end: base + end };
    }
  }
  return null;
}

// The marker text rewritten to the client's UiAutomator strategy, or null when
// the client has none (Selenium @FindBy, How.XPATH, Selenium 3 *ByXPath,
// CodeceptJS { xpath }, selenium-webdriver By.xpath, appium_lib xpath()).
// Plain Selenium `By` has no UiAutomator strategy, so By.xpath becomes the
// Appium class: the short name when the file already names it, else the full
// name (Java, C#) or the strategy string (Python), so the file still compiles.
//   java-client   AppiumBy.androidUIAutomator, MobileBy.AndroidUIAutomator,
//                 @AndroidFindBy / @AndroidBy(uiAutomator = …)
//   Python        AppiumBy.ANDROID_UIAUTOMATOR = '-android uiautomator'
//   C#            MobileBy.AndroidUIAutomator, [FindsByAndroidUIAutomator(AndroidUIAutomator = …)]
//   Ruby          find_element(:uiautomator, …)
//   WebdriverIO   findElement('-android uiautomator', …)
function rewriteStrategy(text, ext, content) {
  const lang = LANGUAGE_BY_EXTENSION[ext];
  const names = word => new RegExp(`\\b${word}\\b`).test(content);
  let m;
  if (lang === 'java' || lang === 'kotlin' || lang === 'groovy') {
    if ((m = /^(AppiumBy|MobileBy|By)\.xpath(\s*\()$/.exec(text))) {
      const cls = m[1] === 'By' ? (names('AppiumBy') ? 'AppiumBy' : names('MobileBy') ? 'MobileBy' : 'io.appium.java_client.AppiumBy') : m[1];
      return `${cls}.${cls.endsWith('MobileBy') ? 'AndroidUIAutomator' : 'androidUIAutomator'}${m[2]}`;
    }
    if (/^@(?:[\w.]+\.)?(?:AndroidFindBy|AndroidBy)\s*\(/.test(text)) return text.replace(/\bxpath(\s*=)$/, 'uiAutomator$1');
    return null;
  }
  if (lang === 'python') {
    if ((m = /^(AppiumBy|MobileBy)\.XPATH$/.exec(text))) return `${m[1]}.ANDROID_UIAUTOMATOR`;
    if (text === 'By.XPATH') return names('AppiumBy') ? 'AppiumBy.ANDROID_UIAUTOMATOR' : names('MobileBy') ? 'MobileBy.ANDROID_UIAUTOMATOR' : "'-android uiautomator'";
    if ((m = /^(['"])xpath\1$/.exec(text))) return `${m[1]}-android uiautomator${m[1]}`;
    return null;
  }
  if (lang === 'csharp') {
    if ((m = /^(MobileBy|By)\.XPath(\s*\()$/.exec(text))) {
      const cls = m[1] === 'By' && !names('MobileBy') ? 'OpenQA.Selenium.Appium.MobileBy' : 'MobileBy';
      return `${cls}.AndroidUIAutomator${m[2]}`;
    }
    if ((m = /^(['"])xpath\1$/.exec(text))) return `${m[1]}-android uiautomator${m[1]}`;
    if (/^[\w.]*FindsByAndroidUIAutomator\s*\(/.test(text)) return text.replace(/\bXPath(\s*=)$/, 'AndroidUIAutomator$1');
    return null;
  }
  if (lang === 'ruby') {
    if (text === ':xpath') return ':uiautomator';
    if (text === 'xpath:') return 'uiautomator:';
    return null;
  }
  if (lang === 'js') {
    if ((m = /^(['"])xpath\1$/.exec(text))) return `${m[1]}-android uiautomator${m[1]}`;
    return null;
  }
  return null;
}

module.exports = { findXpathStrategy, rewriteStrategy };
