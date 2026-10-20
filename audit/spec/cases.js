// S cases: synthetic edge cases derived from reference/ (PLAN.md section 4).
//
// Each case is an XPath with its expected class and, where it converts, the
// UiSelector written by hand from the reference rows it cites:
//   exact  the UiSelector finds the same elements in the same order
//   close  it converts with `warning`; the difference is described
//   skip   no UiSelector; `reason` says why
// Stage 3 ran every case on the emulator before the converter exists
// (audit/device/, results in audit/device/results/s-summary.md). A case whose
// expectation the device corrected or refined carries `device`: what the device
// showed. `npm run spec:check` checks that every reference row is cited.
//
// Regex conventions (the converter emits the same):
//   - every regex metacharacter of a literal is escaped with `\`;
//   - `"` and `\` in a literal become `\x22` and `\x5c`, because the server's
//     string literal cannot hold `\` before `"` or at the end (SRV-23);
//   - `(?s)` wherever `.*` is added, so `.` also crosses line breaks.

const U = 'new UiSelector()';
const r = String.raw;

const exact = (id, xpath, uiselector, refs, note) => ({ id, xpath, expect: 'exact', uiselector, refs, ...(note ? { note } : {}) });
const close = (id, xpath, uiselector, refs, warning) => ({ id, xpath, expect: 'close', uiselector, refs, warning });
const skip = (id, xpath, reason, refs) => ({ id, xpath, expect: 'skip', reason, refs });
const dev = (c, device) => ({ ...c, device });

const CASES = [
  // --- A: attributes and class steps ---
  exact('A01', '//android.widget.Button', `${U}.className("android.widget.Button")`, ['SEL-01', 'SRV-03', 'SRV-20']),
  exact('A02', '//*[@text="Sign in"]', `${U}.text("Sign in")`, ['SEL-01', 'SRV-05']),
  exact('A03', '//android.widget.TextView[@text="Total"]', `${U}.className("android.widget.TextView").text("Total")`, ['SEL-01']),
  exact('A04', '//*[@content-desc="Open menu"]', `${U}.description("Open menu")`, ['SEL-01', 'SRV-08']),
  exact('A05', '//*[@resource-id="com.example.app:id/login"]', `${U}.resourceId("com.example.app:id/login")`, ['SEL-01', 'SRV-07']),
  exact('A06', '//*[@class="android.widget.EditText"]', `${U}.className("android.widget.EditText")`, ['SEL-01', 'SRV-08']),
  dev(exact('A07', '//*[@package="com.example.app"]', `${U}.packageName("com.example.app")`, ['SEL-01', 'SRV-08']),
    'run with LocatorLab\'s package: an app cannot set another package on its nodes'),
  skip('A08', '//*[@text=""]', 'every element without text has text="" in the page source; text("") needs a non-null text', ['SRV-05']),
  skip('A09', '//*[@resource-id=""]', 'an empty resource-id is never written, so the XPath matches nothing', ['SRV-07']),
  exact('A10', '//*[@content-desc=""]', `${U}.description("")`, ['SRV-04', 'SRV-08'], 'only a non-null empty description is written; oracle'),
  skip('A11', '//*[@bounds="[0,0][100,100]"]', 'bounds has no UiSelector criterion', ['SRV-11']),
  skip('A12', '//android.widget.Button[@displayed="true"]', 'displayed has no UiSelector criterion', ['SRV-11']),
  skip('A13', '//*[@password="true"]', 'password has no UiSelector criterion', ['SRV-11']),
  skip('A14', '//*[@hint="Email"]', 'hint has no UiSelector criterion', ['SRV-11']),
  dev(skip('A15', '//com.example.app.Outer$Inner', 'the XPath parser rejects $ in a name test, and the page source writes the tag with . for $', ['SRV-03']),
    'the XPath fails (invalid selector, col 24: $); the tag is <com.example.app.Outer.Inner>, @class keeps the $'),
  dev(skip('A16', '//android.view.View[@text="x"]', 'elements with no class name also appear as android.view.View in the page source (Decision 3)', ['SRV-03']),
    'XPath 2, className("android.view.View").text("x") 1: the node without a class name'),
  exact('A17', '//*[@resource-id="login"]', `${U}.resourceId("login")`, ['SEL-01'], 'a short id matches only a short resource id on both sides'),
  skip('A18', '//*[@name="OK"]', 'the page source has no name attribute (name is an alias of text for getAttribute only)', ['SRV-11']),
  skip('A19', '//*[@resourceId="com.example.app:id/login"]', 'the page source has no resourceId attribute (alias for getAttribute only)', ['SRV-11']),

  // --- B: booleans and index ---
  exact('B01', '//*[@checked="true"]', `${U}.checked(true)`, ['SEL-04', 'SRV-09']),
  exact('B02', '//android.widget.CheckBox[@checked="false"]', `${U}.className("android.widget.CheckBox").checked(false)`, ['SEL-04']),
  exact('B03', '//*[@checkable="true"]', `${U}.checkable(true)`, ['SEL-04']),
  exact('B04', '//*[@clickable="true"]', `${U}.clickable(true)`, ['SEL-04']),
  exact('B05', '//*[@enabled="false"]', `${U}.enabled(false)`, ['SEL-04']),
  exact('B06', '//*[@focusable="true"]', `${U}.focusable(true)`, ['SEL-04']),
  exact('B07', '//*[@focused="true"]', `${U}.focused(true)`, ['SEL-04']),
  exact('B08', '//*[@long-clickable="true"]', `${U}.longClickable(true)`, ['SEL-04']),
  exact('B09', '//*[@scrollable="true"]', `${U}.scrollable(true)`, ['SEL-04']),
  exact('B10', '//*[@selected="true"]', `${U}.selected(true)`, ['SEL-04']),
  exact('B11', '//*[@enabled=true()]', `${U}.enabled(true)`, ['SRV-09', 'XP-06']),
  dev(exact('B12', '//*[not(@checked="true")]', `${U}.checked(false)`, ['SRV-09', 'SEL-04']),
    'while a toast is in the page source, the XPath also returns it (SRV-13); every other screen EQUAL'),
  skip('B13', '//*[@checked="TRUE"]', 'booleans are written as lower-case true/false, so the XPath matches nothing', ['SRV-09']),
  exact('B14', '//*[@index="2"]', `${U}.index(2)`, ['SEL-09', 'SRV-10']),
  exact('B15', '//android.widget.TextView[@index=0]', `${U}.className("android.widget.TextView").index(0)`, ['SEL-09', 'XP-06']),
  skip('B16', '//*[@index="02"]', 'a string comparison with "02" never matches the written index', ['SRV-10', 'SRV-24']),
  skip('B17', '//*[@checked]', 'checked is written on every element, so the test is always true', ['SRV-09']),

  // --- C: string functions ---
  exact('C01', '//*[contains(@text,"Total")]', `${U}.textMatches("(?s).*Total.*")`, ['XP-02', 'SEL-02', 'SEL-03']),
  exact('C02', '//*[starts-with(@text,"Total")]', `${U}.textMatches("(?s)Total.*")`, ['XP-02', 'SEL-02', 'SEL-03']),
  exact('C03', '//*[ends-with(@text,"USD")]', `${U}.textMatches("(?s).*USD")`, ['XP-02', 'SEL-03']),
  exact('C04', '//*[contains(@content-desc,"menu")]', `${U}.descriptionMatches("(?s).*menu.*")`, ['XP-02', 'SEL-02', 'SEL-03']),
  exact('C05', '//*[contains(@resource-id,":id/login")]', `${U}.resourceIdMatches("(?s).*:id/login.*")`, ['XP-02', 'SEL-03']),
  dev(skip('C06', '//*[contains(@class,"Button")]', 'classNameMatches makes findElements iterate index(i) instead of instance(i) (Decision 3)', ['SEL-03', 'SRV-33']),
    'findElements: XPath 8, UiSelector 1 to 3 (attrs, two runs); 13 vs 4 (tree); the first element is the same'),
  exact('C07', '//*[starts-with(@package,"com.example")]', r`${U}.packageNameMatches("(?s)com\.example.*")`, ['XP-02', 'SEL-03']),
  skip('C08', '//*[contains(@text,"")]', 'contains() with "" is true for every element', ['XP-02']),
  exact('C09', '//*[contains(@text,"1.5")]', r`${U}.textMatches("(?s).*1\.5.*")`, ['XP-02', 'SEL-03'], 'range widgets expose their value as text in the page source only (SRV-06)'),
  skip('C10', '//android.widget.SeekBar[@text="50.0"]', 'a range widget\'s text in the page source is its current value, not getText()', ['SRV-06']),
  skip('C11', '//*[@text="50.0"]', 'a float-shaped text may be a range widget\'s value, which only the page source has', ['SRV-06']),
  dev(skip('C12', '//*[contains(text(),"Total")]', 'the page source has no text nodes; on the device the XPath fails with a type error', ['XP-07']),
    'XPath error "Value does not match a required type" on every screen'),
  skip('C13', '//*[text()="Total"]', 'the page source has no text nodes, so text() matches nothing', ['XP-07']),
  skip('C14', '//*[normalize-space(@text)="Total"]', 'normalize-space() has no UiSelector form', ['XP-01']),
  skip('C15', '//*[string-length(@text)=5]', 'string-length() has no UiSelector form', ['XP-01']),
  exact('C16', '//*[@text=concat("Tot","al")]', `${U}.text("Total")`, ['XP-01']),
  skip('C17', '//*[substring(@text,1,3)="Tot"]', 'substring() is not converted', ['XP-01']),

  // --- D: logic ---
  exact('D01', '//android.widget.Button[@text="OK" and @enabled="true"]', `${U}.className("android.widget.Button").text("OK").enabled(true)`, ['SEL-01', 'SEL-04']),
  exact('D02', '//*[@text="OK"][@clickable="true"]', `${U}.text("OK").clickable(true)`, ['SEL-01', 'SEL-04']),
  exact('D03', '//*[@text="Yes" or @text="OK"]', `${U}.textMatches("Yes|OK")`, ['SEL-03', 'SEL-05']),
  skip('D04', '//*[@text="OK" or @content-desc="OK"]', 'or across attributes has no UiSelector form', ['SEL-13', 'SRV-21']),
  exact('D05', '//*[contains(@text,"a") and contains(@text,"b")]', `${U}.textMatches("(?s)(?=.*a)(?=.*b).*")`, ['SEL-05', 'SEL-03']),
  exact('D06', '//*[@text="OK" and contains(@text,"O")]', `${U}.textMatches("(?s)(?=.*O)OK")`, ['SEL-05']),
  skip('D07', '//*[not(contains(@text,"Ad"))]', 'UiSelector has no negation for text', ['SEL-13']),
  skip('D08', '//*[@text!="OK"]', 'UiSelector has no negation for text', ['SEL-13']),
  exact('D09', '//*[@clickable="true" and (@text="A" or @text="B")]', `${U}.clickable(true).textMatches("A|B")`, ['SEL-03', 'SEL-04']),
  exact('D10', '//*[(@text="A" or @text="B") and @content-desc="c"]', `${U}.textMatches("A|B").description("c")`, ['SEL-03', 'SEL-01']),
  skip('D11', '//*[@text="A" and @text="B"]', 'the two conditions contradict each other, so the XPath matches nothing', ['SEL-05']),
  skip('D12', '//*[@checked="true" or @selected="true"]', 'or across attributes has no UiSelector form', ['SEL-13']),

  // --- E: positions ---
  exact('E01', '(//android.widget.Button)[2]', `${U}.className("android.widget.Button").instance(1)`, ['SEL-10', 'XP-08', 'SRV-31']),
  exact('E02', '(//*[@text="Add"])[1]', `${U}.text("Add").instance(0)`, ['SEL-10', 'SRV-31'], 'instance(0) keeps findElements at one element, as the XPath'),
  skip('E03', '(//*[@text="Add"])[last()]', 'last() has no UiSelector form', ['XP-08']),
  skip('E04', '//android.widget.Button[2]', 'a position among siblings has no UiSelector form', ['XP-08']),
  exact('E05', '(//android.widget.Button)[position()=2]', `${U}.className("android.widget.Button").instance(1)`, ['XP-08', 'SEL-10']),
  skip('E06', '(//android.widget.Button)[position()<3]', 'a position range has no UiSelector form', ['XP-08']),
  skip('E07', '//*[@text="Add"][1]', 'a position among siblings has no UiSelector form', ['XP-08']),
  exact('E08', '(//android.widget.Button[@enabled="true"])[3]', `${U}.className("android.widget.Button").enabled(true).instance(2)`, ['SEL-10', 'SRV-31']),

  // --- F: paths ---
  dev(close('F01', '//android.widget.ListView//android.widget.TextView[@text="Item"]',
    `${U}.className("android.widget.ListView").childSelector(${U}.className("android.widget.TextView").text("Item"))`, ['SEL-11'],
    'findElements returns at most one match per container'), 'findElements: XPath 5, UiSelector 3 (one per ListView); the first element is the same'),
  skip('F02', '//android.widget.ListView/android.widget.TextView', 'UiSelector has no direct-child criterion', ['SEL-13']),
  dev(close('F03', '//*[@resource-id="com.example.app:id/list"]//*[@text="Item"]',
    `${U}.resourceId("com.example.app:id/list").childSelector(${U}.text("Item"))`, ['SEL-11'],
    'findElements returns at most one match per container'), 'findElements: XPath 3, UiSelector 1; the first element is the same'),
  skip('F04', '//android.widget.LinearLayout[.//android.widget.Button]', 'UiSelector has no has-descendant filter', ['SEL-13']),
  skip('F05', '//*[@text="Name"]/following-sibling::*[1]', 'sibling axes are not converted', ['SEL-12']),
  skip('F06', '//*[@text="Name"]/..', 'the parent step is not converted', ['SEL-12']),
  skip('F07', '//*[@text="Name"]/parent::*', 'the parent axis is not converted', ['SEL-12']),
  skip('F08', '//*[@text="Item"]/ancestor::android.widget.LinearLayout', 'the ancestor axis is not converted', ['SEL-12']),
  exact('F09', './/android.widget.Button', `${U}.className("android.widget.Button")`, ['SRV-02'], 'a driver-level lookup starts at the document'),
  dev(close('F10', '//android.widget.ListView//android.widget.LinearLayout//android.widget.TextView',
    `${U}.className("android.widget.ListView").childSelector(${U}.className("android.widget.LinearLayout").childSelector(${U}.className("android.widget.TextView")))`, ['SEL-11'],
    'findElements returns at most one match per container'), 'findElements: XPath 7, UiSelector 3; the first element is the same'),
  exact('F11', '//descendant::android.widget.Button', `${U}.className("android.widget.Button")`, ['XP-01']),
  dev(close('F12', '//android.widget.ListView/descendant::android.widget.TextView',
    `${U}.className("android.widget.ListView").childSelector(${U}.className("android.widget.TextView"))`, ['SEL-11'],
    'findElements returns at most one match per container'), 'findElements: XPath 7, UiSelector 3; the first element is the same'),

  // --- G: literals ---
  exact('G01', `//*[@text='Say "hi"']`, r`${U}.textMatches("Say \x22hi\x22")`, ['SRV-23']),
  exact('G02', r`//*[@text="C:\Temp\"]`, r`${U}.textMatches("C:\x5cTemp\x5c")`, ['SRV-23']),
  exact('G03', `//*[@text="it's"]`, `${U}.text("it's")`, ['SEL-01']),
  exact('G04', '//*[@text="a]b"]', `${U}.text("a]b")`, ['SEL-01']),
  exact('G05', '//*[@text="a/b"]', `${U}.text("a/b")`, ['SEL-01']),
  exact('G06', '//*[@text="Price: $5"]', `${U}.text("Price: $5")`, ['SEL-01']),
  exact('G07', '//*[contains(@text,"$5.00 (incl.)")]', r`${U}.textMatches("(?s).*\$5\.00 \(incl\.\).*")`, ['SEL-03']),
  exact('G08', '//*[@text="Line 1\nLine 2"]', `${U}.text("Line 1\nLine 2")`, ['SEL-01'], 'the literal holds a real line break'),
  exact('G09', '//*[@text="Grüße"]', `${U}.text("Grüße")`, ['SEL-01']),
  exact('G10', '//*[@text="a;b"]', `${U}.text("a;b")`, ['SRV-20']),
  exact('G11', '//*[@text="f(x)"]', `${U}.text("f(x)")`, ['SRV-22']),
  skip('G12', '//*[@text="bell\u0007"]', 'characters that are not valid XML are replaced in the page source', ['SRV-14']),
  exact('G13', '//*[@text="a""b"]', r`${U}.textMatches("a\x22b")`, ['SRV-23', 'XP-01'], 'XPath 2.0 doubles a quote inside a literal'),
  exact('G14', '//*[@text="%s"]', `${U}.text("%s")`, ['SEL-01'], 'a String.format placeholder stays a placeholder'),
  exact('G15', '//*[@text="${name}"]', `${U}.text("\${name}")`, ['SEL-01'], 'a template placeholder stays a placeholder'),
  exact('G16', r`//*[contains(@text,"a\b")]`, r`${U}.textMatches("(?s).*a\x5cb.*")`, ['SRV-23', 'SEL-03']),

  // --- H: regexes and case ---
  exact('H01', r`//*[matches(@text,"^Total: \d+$")]`, r`${U}.textMatches("(?d)(?s:.*)(?:^Total: \d+$)(?s:.*)")`, ['XP-03']),
  exact('H02', '//*[matches(@text,"total","i")]', `${U}.textMatches("(?d)(?s:.*)(?i:total)(?s:.*)")`, ['XP-03', 'XP-04']),
  skip('H03', '//*[matches(@text,"a*")]', 'the pattern matches "", which XPath also matches on elements without the attribute', ['XP-03']),
  exact('H04', '//*[matches(@text,"[a-z-[aeiou]]+")]', `${U}.textMatches("(?d)(?s:.*)(?:[a-z&&[^aeiou]]+)(?s:.*)")`, ['XP-03'], 'PsychoPath rewrites -[ to &&[^'),
  dev(close('H05', '//*[lower-case(@text)="ok"]', `${U}.textMatches("(?i)ok")`, ['XP-05'],
    'Android regexes are ICU: (?i) folds Unicode letters like lower-case() does; one-to-many folds (İ, ß) are not checked'),
    'EQUAL on every screen, the Kelvin sign "OK" (lower-case → "ok") included'),
  dev(close('H06', '//*[contains(lower-case(@text),"total")]', `${U}.textMatches("(?s)(?i).*total.*")`, ['XP-05'],
    'Android regexes are ICU: (?i) folds Unicode letters like lower-case() does; one-to-many folds (İ, ß) are not checked'),
    'EQUAL on every screen'),
  dev(skip('H07', '//*[translate(@text,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz")="ok"]',
    'translate() folds only the ASCII letters it lists; (?i) also folds Unicode ones such as the Kelvin sign (Decision 3)', ['XP-05']),
    'XPath 4, textMatches("(?i)ok") 5: it also finds "O" + Kelvin sign'),
  dev(skip('H08', '//*[upper-case(@text)="OK"]', 'upper-case() leaves the Kelvin sign as is (it is upper case already); (?i) folds it to k (Decision 3)', ['XP-05']),
    'XPath 4, textMatches("(?i)OK") 5: it also finds "O" + Kelvin sign'),
  skip('H09', '//*[matches(@text,"x","q")]', 'q is not a valid flag, so the XPath fails', ['XP-03']),
  exact('H10', '//*[matches(@content-desc,"^Menu")]', `${U}.descriptionMatches("(?d)(?s:.*)(?:^Menu)(?s:.*)")`, ['XP-03']),

  // --- X: unions and sequences ---
  exact('X01', '//*[@text="A"] | //*[@text="B"]', `${U}.textMatches("A|B")`, ['XP-09', 'SEL-03']),
  dev(skip('X02', '//android.widget.Button | //android.widget.ImageButton', 'classNameMatches makes findElements iterate index(i) instead of instance(i) (Decision 3)', ['XP-09', 'SRV-33']),
    'findElements: XPath 7, UiSelector 1 to 3 (attrs, two runs); 13 vs 4 (tree); the first element is the same'),
  skip('X03', '//*[@text="A"] | //*[@content-desc="B"]', 'a union of different attributes has no UiSelector form', ['XP-09', 'SRV-21']),
  exact('X04', '//*[@text=("A","B")]', `${U}.textMatches("A|B")`, ['XP-06']),

  // --- P: root and absolute paths ---
  skip('P01', '/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout/android.widget.Button', 'absolute path from the page source root', ['SRV-02']),
  skip('P02', '//hierarchy', 'the page source root is not an element on screen', ['SRV-02']),
  skip('P03', '//android.widget.Toast[@text="Saved"]', 'toasts exist only in the page source', ['SRV-13']),
  dev(exact('P04', '//*', U, ['SRV-02']),
    'was a skip ("also matches the page source root"): findElements never returns <hierarchy>, and new UiSelector() returned the same elements in the same order on every screen'),
  exact('P05', '/hierarchy//android.widget.Button', `${U}.className("android.widget.Button")`, ['SRV-02']),

  // --- T: tree and traversal (need the device; the XPath is ordinary) ---
  exact('T01', '//android.widget.Button', `${U}.className("android.widget.Button")`, ['SEL-06', 'SRV-30', 'SRV-32', 'SRV-34'],
    'screen with buttons at several depths: same elements in the same order with findElements'),
  dev(exact('T02', '//*[@text="Deep marker"]', `${U}.text("Deep marker")`, ['SEL-08', 'SRV-12'],
    'marker deeper than 70 levels: XPath finds nothing, UiSelector finds it (favourable, documented)'),
    'deep: XPath 0, UiSelector 1; any XPath that matches nodes on both sides of level 70 loses the deep ones (DEPTH in the summary)'),
  dev(exact('T03', '//*[@text="Hidden"]', `${U}.text("Hidden")`, ['SEL-07', 'SRV-12'], 'an invisible element is found by neither'),
    'neither finds the INVISIBLE node'),

  // --- V: XPath 2.0 syntax and invalid input ---
  exact('V01', '//*[@text eq "OK"]', `${U}.text("OK")`, ['SRV-01', 'XP-01']),
  exact('V02', '//*[@text="OK" or @text="Yes"][@enabled="true"]', `${U}.textMatches("OK|Yes").enabled(true)`, ['SEL-03', 'SEL-04']),
  skip('V03', '//*[some $t in @text satisfies $t="OK"]', 'quantified expressions are not converted', ['XP-01']),
  skip('V04', '//*[if (@checked="true") then true() else false()]', 'conditional expressions are not converted', ['XP-01']),
  skip('V05', '//*[@text="OK"', 'not a valid XPath', ['SRV-01']),
  exact('V06', `//*[ @text = 'OK' ]`, `${U}.text("OK")`, ['SEL-01']),
  exact('V07', '//*[@text="1"]', `${U}.text("1")`, ['SEL-01']),
  dev(skip('V08', '//*[@text=1]', 'a numeric comparison casts every text to a number: it fails on a non-numeric text and also matches "1.0" and "01"', ['XP-06']),
    'XPath error "Can\'t cast to required type" on every screen (all have non-numeric texts)'),

  // --- O: output form ---
  exact('O01', '//android.widget.Button[@text="OK"][@checked="false"][@index="0"]',
    `${U}.className("android.widget.Button").text("OK").checked(false).index(0)`, ['SRV-22', 'SRV-24']),
];

module.exports = { CASES };
