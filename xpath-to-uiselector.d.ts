// Type declarations for xpath-to-uiselector.
// The package itself is plain CommonJS (no build step); these hand-written
// declarations describe the public surface re-exported from the entry file.

/** Outcome of a conversion. Mirrors the frozen `STATUS` object. */
export type Status =
  | 'success'
  | 'skipped_not_xpath'
  | 'skipped_ios'
  | 'skipped_xpath_strategy'
  | 'skipped_unsupported_logic'
  | 'skipped_validation_failed'
  | 'skipped_no_change';

export interface ConvertResult {
  /** The converted locator on success, or the original input when skipped. */
  locator: string;
  status: Status;
  /** Diagnostic message when available. */
  reason?: string | null;
  /** Set on a successful conversion that is close, not exact. */
  warning?: string;
}

/** Convert a single Android XPath locator to a UiSelector. */
export function convertXpathToUiSelector(xpath: string): ConvertResult;

/** Pre-filter: does this raw string look like an XPath locator worth touching? */
export function isLikelyXpathLocator(str: string): boolean;

export interface ParsedFlags {
  positionals: string[];
  /** Flags that are not recognised. Non-empty means the CLI should refuse to run. */
  unknown: string[];
  help: boolean;
  version: boolean;
  json: boolean;
  quiet: boolean;
  dryRun: boolean;
}

/** Parse CLI argv (without `node`/script) into the flag object the CLI uses. */
export function parseFlags(argv: string[]): ParsedFlags;

export interface ScanStats {
  filesScanned: number;
  locatorsFound: number;
  locatorsUpdated: number;
  /** Updated locators that carry a `warning`. */
  warnings: number;
  skipped: {
    ios: number;
    /** Locators passed to an explicit XPath strategy (`AppiumBy.xpath(…)`, `(By.XPATH, …)`), left untouched. */
    xpathStrategy: number;
    validationFailed: number;
    unsupportedLogic: number;
    notXpath: number;
    noChangeNeeded: number;
  };
}

export interface ScanRecord {
  /** Path relative to the scan root, with `/` separators on every platform. */
  file: string;
  changed: boolean;
  /** The locator as found in the file. */
  old: string;
  /** The rewritten locator; present only when `changed`. */
  new?: string;
  status: Status;
  reason: string | null;
  /** The conversion's `warning`; present only when `changed`. */
  warning?: string | null;
}

export interface MainResult {
  stats: ScanStats;
  records: ScanRecord[];
}

/**
 * Scan a file or a folder and convert every locator found. Honours
 * `opts.dryRun`; exits the process on a missing path.
 */
export function main(target: string | undefined, opts: ParsedFlags): MainResult;

/**
 * Frozen map of status string constants. Keys are declared literally so a typo
 * such as `STATUS.SUCESS` is a compile error rather than `undefined`.
 */
export const STATUS: Readonly<{
  SUCCESS: 'success';
  SKIPPED_NOT_XPATH: 'skipped_not_xpath';
  SKIPPED_IOS: 'skipped_ios';
  SKIPPED_XPATH_STRATEGY: 'skipped_xpath_strategy';
  SKIPPED_UNSUPPORTED_LOGIC: 'skipped_unsupported_logic';
  SKIPPED_VALIDATION_FAILED: 'skipped_validation_failed';
  SKIPPED_NO_CHANGE: 'skipped_no_change';
}>;
