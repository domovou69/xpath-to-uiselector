Convert each Appium XPath (Android, UiAutomator2 driver, default settings) into
an Android UiSelector that finds exactly the same elements, in the same order,
with findElements. Reply with the UiSelector, or "SKIP: <reason>" if no such
UiSelector exists. A skip costs little; a UiSelector that the server rejects
or that finds other elements costs more. Convert what the rules below cover,
skip the rest.

The XPath engine
- The server evaluates XPath 2.0 (PsychoPath), not XPath 1.0. ends-with(),
  matches(), lower-case(), eq, sequences @a=("A","B") and doubled quotes
  "a""b" (one " inside the literal) are valid: convert them. Never skip a
  locator for "XPath 1.0 has no ..." or "invalid syntax" when XPath 2.0 has it.
- An XPath literal has no escapes: "a\b" is a, backslash, b.
- @a=true() compares the attribute's "true"/"false" as a boolean:
  @enabled=true() -> enabled(true), never dropped.

The UiSelector string
- These rules describe the UiSelector string itself, as the server receives it
  (in JSON output, after JSON decoding). It is not a Java literal.
- The server's string literal unescapes only \". Every other backslash stays
  as written. So write every regex escape with ONE backslash: \. \d \Q \x22.
  Two backslashes (\\.) are a literal backslash in the regex and match
  nothing; a value ending in \\ breaks the string.
- Write a line break or a tab in a value as the character itself; \n inside
  text("...") is a backslash and an n.
- A value with " or \ goes into a regex as \x22 and \x5c:
  @text='Say "hi"' -> textMatches("Say \x22hi\x22"); @text="C:\Temp\" ->
  textMatches("C:\x5cTemp\x5c"). Non-ASCII, $, %, {, } go into text("...")
  as is.
- Only these methods exist: text, textMatches, description,
  descriptionMatches, resourceId, resourceIdMatches, packageName,
  packageNameMatches, className, checked, checkable, clickable, enabled,
  focusable, focused, longClickable, scrollable, selected, index, instance,
  childSelector. Never classNameMatches (findElements then loses elements),
  never textContains, textStartsWith, descriptionContains,
  descriptionStartsWith (they ignore case; XPath does not). Anything else
  (password, displayed, bounds, ...) is rejected: SKIP.

Steps and attributes
- //X, .//X, /hierarchy//X, //descendant::X -> className("X"); //* ->
  new UiSelector() (never classNameMatches(".*")). //*[@class="X"] ->
  className("X"). Keep the className of every step.
- @text -> text, @content-desc -> description, @resource-id -> resourceId,
  @package -> packageName. Booleans (checked, checkable, clickable, enabled,
  focusable, focused, long-clickable, scrollable, selected) ="true"/"false" ->
  checked(true) ...; not(@checked="true") -> checked(false). @index="2" ->
  index(2).
- Existence: [@text], [@index] and [@<boolean>] are always true: drop them.
  [@content-desc] -> descriptionMatches("(?s).*") (not dropped: elements
  without a description have none); [@resource-id], [@resource-id!=""] ->
  resourceIdMatches("(?s).+") (".+", not ".*": ".*" also matches elements
  without an id); [@content-desc!=""] -> descriptionMatches("(?s).+").
- SKIP @bounds, @displayed, @password, @hint, @name, @resourceId,
  @contentDescription, @label, @value, @id, @type and web attributes: they
  have no criterion or are not in the page source. In a union, a branch on an
  attribute Android never writes (@id, @name, @label, @value, data-*) matches
  nothing: drop that branch.
- SKIP text() in any form: the page source has no text nodes, so
  text()="x" and contains(text(),"x") match nothing. Also SKIP
  //android.widget.Toast and class names with $.

Text tests and regexes
- contains / starts-with / ends-with -> a ...Matches regex, which must match
  the whole value: contains(@a,"v") -> "(?s).*v.*"; starts-with -> "(?s)v.*";
  ends-with -> "(?s).*v". Escape every regex metacharacter of v (\. \( \{
  \$ ...).
- Put (?s) at the start of every regex that has .* or .+, on every attribute
  (resourceIdMatches too, lookaheads too), so . also crosses line breaks.
- or / union / sequence over ONE attribute is an alternation:
  @a="A" or @a="B", @a=("A","B"), //*[@a="A"] | //*[@a="B"] ->
  aMatches("A|B") (escaped); with contains: "(?s).*A.*|.*B.*". This also works
  inside an and: [@clickable="true" and (@text="A" or @text="B")] ->
  clickable(true).textMatches("A|B").
- Two tests on one attribute -> one regex with lookaheads:
  contains(@a,"x") and contains(@a,"y") -> "(?s)(?=.*x)(?=.*y).*".
- matches(@a,"p") -> aMatches("(?d)(?s:.*)(?-s:p)(?s:.*)"); with flag "i"
  "(?-s:" becomes "(?i-s:". XPath class subtraction [a-z-[aeiou]] is
  [a-z&&[^aeiou]] in Java. SKIP the "x" flag, an invalid flag (the XPath
  fails), and any p that matches "" (a*, .*).
- lower-case(@a)="ok" -> aMatches("(?i)ok"); contains(lower-case(@a),"ok")
  -> "(?s)(?i).*ok.*". The literal must already be lower case.
- translate(@a,"ABC...Z","abc...z")="ok" with an ASCII literal ->
  aMatches("[oO][kK]") (never (?i): it also folds the Kelvin sign). SKIP
  upper-case() for the same reason.
- normalize-space(@a)="v" -> aMatches("[ \t\n\r]*v[ \t\n\r]*") only when v
  has no whitespace at all; string-length(@a)=n with n >= 1 ->
  "(?s).{n}". SKIP substring() and every other use of these.
- concat() of literals: fold it. @text eq "OK" -> text("OK").

Values the page source does not share with UiSelector
- Every element without text has text "" in the page source; UiSelector
  sees no text at all. So SKIP @text="", contains(@text,""), any negation
  (@a!="x", not(...); no lookahead workaround), and any text test that ""
  passes.
- Range widgets (SeekBar, ProgressBar, RatingBar) have their value as text in
  the page source only (1.5, 21.5, 50.0). SKIP @text="<a number>" and
  @text=<number> (a numeric comparison). contains / starts-with / ends-with
  on @text with digits or "." convert as usual.
- @resource-id="", @checked="TRUE", @index="02", @text="A" and @text="B"
  match nothing: SKIP.

Combining
- [a][b], [a and b] -> the criteria in XPath order, after className.
- SKIP "or" across different attributes and unions of different paths.

Paths and positions
- //A//B, //A/descendant::B -> A.childSelector(B). It returns at most one B
  per A; this close form is accepted. Same with more steps:
  A.childSelector(B.childSelector(C)).
- (//X)[n], (//X)[position()=n] -> X.instance(n-1).
- (//A//B)[1] -> A.instance(0).childSelector(B.instance(0)) (also with more
  steps: instance(0) on A and on the last step). instance() inside
  childSelector counts within each A, so SKIP (//A//B)[n] with n >= 2 and
  (//A)[n]//B.
- SKIP //X[n] and //A/B[n] (position among siblings), //A/B (direct child),
  last(), position() ranges, /hierarchy/... absolute paths, [.//B], [B], ..,
  parent, ancestor and sibling axes.
- The output order: className, the criteria, instance, childSelector.
