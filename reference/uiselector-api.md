# androidx.test.uiautomator 2.3.0: UiSelector

Files under `androidx/test/uiautomator/` in `uiautomator-2.3.0-sources.jar`. Matching is
`UiSelector.isMatchFor(node, index)`; the search is `QueryController`.

## Criteria

| Id | Criterion | How it matches (`isMatchFor`) | For the converter |
| --- | --- | --- | --- |
| SEL-01 | `text(s)`, `description(s)`, `className(s)`, `resourceId(s)`, `packageName(s)` | node value non-null and `contentEquals(s)`: exact, case-sensitive | `@a="v"` → the criterion (when `v` has no `"` / `\`, SRV-23) |
| SEL-02 | `textContains(s)`, `textStartsWith(s)`, `descriptionContains(s)`, `descriptionStartsWith(s)` | `toLowerCase()` on both sides: **case-insensitive** | Never emitted for `contains()` / `starts-with()`, which are case-sensitive: use `…Matches` |
| SEL-03 | `textMatches(r)`, `descriptionMatches(r)`, `classNameMatches(r)`, `resourceIdMatches(r)`, `packageNameMatches(r)` | `Pattern.compile(r)` with no flags, `matcher(value).matches()`: whole-string match, non-null value | `contains` / `starts-with` / `ends-with` / `matches()` / `or` on one attribute → a regex with `(?s)` and every literal character escaped |
| SEL-04 | `checked`, `checkable`, `clickable`, `enabled`, `focusable`, `focused`, `longClickable`, `scrollable`, `selected` (boolean) | `node.isX() == b` | `@x="true"/"false"` → `x(true/false)` |
| SEL-05 | One value per criterion: a second call of the same method replaces the first (`mSelectorAttributes.put`) | `buildSelector` | Two conditions on one attribute → one regex with lookaheads, or skip; never two calls |
| SEL-09 | `index(i)` | `i` = the child's position in its parent's `getChild` loop, null and invisible children counted | `@index="i"` → `index(i)` (SRV-10) |
| SEL-10 | `instance(n)` | the n-th match (0-based) in traversal order, counted by `matchOrUpdateInstance` | `(//X)[n]` → `instance(n-1)` |
| SEL-11 | `childSelector(c)` | after a match, the search switches to `c` among the matched node's descendants; if none is found there, the outer search goes on | `//A//B` → `A.childSelector(B)`: first element equal to XPath; `findElements` returns at most one B per A (SRV-32): close. **Oracle:** 3 of 5, 1 of 3, 3 of 7; the first element always equal |
| SEL-12 | `fromParent(p)` | after a match, the search switches to `p` from the match's parent | Not emitted until the oracle shows an exact case |
| SEL-13 | No criterion for a direct child, a has-descendant filter, negation, or `or` across criteria | — | `//A/B`, `[.//B]`, `not(…)` on text, `or` across attributes: skip |

## Traversal

| Id | Fact | Source | For the converter |
| --- | --- | --- | --- |
| SEL-06 | The search starts at `getRootInActiveWindow()` and walks depth-first, pre-order, children in `getChild` order; the root itself is tested | `QueryController.getRootNode`, `findNodeRegularRecursive` | Same order as XPath document order inside the active window |
| SEL-07 | Children with `isVisibleToUser() == false` are skipped with their subtrees | `findNodeRegularRecursive` | Same visibility rule as the XML source (SRV-12) |
| SEL-08 | No depth limit | `findNodeRegularRecursive` | Below depth 70 UiSelector finds what XPath does not (SRV-12) |
