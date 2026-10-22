# androidx.test.uiautomator 2.3.0: UiSelector

Files under `androidx/test/uiautomator/` in `uiautomator-2.3.0-sources.jar`. Matching is
`UiSelector.isMatchFor(node, index)`; the search is `QueryController`.

## Criteria

| Id | Criterion | How it matches (`isMatchFor`) | For the converter |
| --- | --- | --- | --- |
| SEL-01 | `text(s)`, `description(s)`, `className(s)`, `resourceId(s)`, `packageName(s)` | node value non-null and `contentEquals(s)`: exact, case-sensitive | `@a="v"` → the criterion (when `v` has no `"` / `\`, SRV-23) |
| SEL-02 | `textContains(s)`, `textStartsWith(s)`, `descriptionContains(s)`, `descriptionStartsWith(s)` | `toLowerCase()` on both sides: **case-insensitive** | Never emitted for `contains()` / `starts-with()`, which are case-sensitive: use `…Matches` |
| SEL-03 | `textMatches(r)`, `descriptionMatches(r)`, `classNameMatches(r)`, `resourceIdMatches(r)`, `packageNameMatches(r)` | `matcher(value).matches()`: whole-string match, non-null value. `textMatches` and `descriptionMatches` compile with `Pattern.DOTALL` (`UiSelector.java` lines 131, 242), the other three with no flags (corrected in stage 4b: the real-world fuzz mutants showed that dropping `(?s)` changed nothing for text) | `contains` / `starts-with` / `ends-with` / `matches()` / `or` on one attribute → a regex with `(?s)` and every literal character escaped |
| SEL-04 | `checked`, `checkable`, `clickable`, `enabled`, `focusable`, `focused`, `longClickable`, `scrollable`, `selected` (boolean) | `node.isX() == b` | `@x="true"/"false"` → `x(true/false)` |
| SEL-05 | One value per criterion: a second call of the same method replaces the first (`mSelectorAttributes.put`) | `buildSelector` | Two conditions on one attribute → one regex with lookaheads, or skip; never two calls |
| SEL-09 | `index(i)` | `i` = the child's position in its parent's `getChild` loop, null and invisible children counted | `@index="i"` → `index(i)` (SRV-10) |
| SEL-10 | `instance(n)` | the n-th match (0-based) in traversal order, counted by `matchOrUpdateInstance` | `(//X)[n]` → `instance(n-1)` |
| SEL-11 | `childSelector(c)` | after a match, the search switches to `c` among the matched node's descendants; if none is found there, the outer search goes on | `//A//B` → `A.childSelector(B)`: first element equal to XPath; `findElements` returns at most one B per A (SRV-32): close (Decision 3). **Oracle:** 3 of 5, 1 of 3, 3 of 7; the first element always equal |
| SEL-12 | `fromParent(p)` | after a match, the search switches to `p` from the match's parent | Not emitted: it searches the parent's whole subtree, not one axis. A skipped `X/..`, `parent::` or sibling step gets it as a rewrite hint |
| SEL-13 | No criterion for a direct child, a has-descendant filter, negation, or `or` across criteria | — | `//A/B`, `[.//B]`, `not(…)` on text, `or` across attributes: skip |
| SEL-14 | The `instance` counter of a `childSelector` lives in that child selector (`SELECTOR_COUNT`, `matchOrUpdateInstance`, line 819), but `getChildSelector()` returns a copy (`new UiSelector(selector)`, lines 618–621), and `findNodeRegularRecursive` (line 315) takes that copy each time a container matches: the count starts again in every container. A container matched inside another container is not entered again: its descendants were already searched with the first. A selector whose `instance` is 0 matches every node its criteria match (the counter never moves) | `(//A//B)[1]` → `A.instance(0).childSelector(B.instance(0))` is exact: the first A that has a B, and its first B, is the first B in document order (SRV-35 for the outer `instance(0)`). `(//A//B)[n]` with n ≥ 2 counts within one A at a time, so it agrees only when one A matches: skip with a hint. **Oracle:** stage 3 of the skipped-form coverage; `(//ListView//TextView)[5]` found nothing where the XPath's fifth lies in the second ListView |

## Traversal

| Id | Fact | Source | For the converter |
| --- | --- | --- | --- |
| SEL-06 | The search starts at `getRootInActiveWindow()` and walks depth-first, pre-order, children in `getChild` order; the root itself is tested | `QueryController.getRootNode`, `findNodeRegularRecursive` | Same order as XPath document order inside the active window |
| SEL-07 | Children with `isVisibleToUser() == false` are skipped with their subtrees | `findNodeRegularRecursive` | Same visibility rule as the XML source (SRV-12) |
| SEL-08 | No depth limit | `findNodeRegularRecursive` | Below depth 70 UiSelector finds what XPath does not (SRV-12) |
