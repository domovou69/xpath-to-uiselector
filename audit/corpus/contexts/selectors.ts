// Lines 20–115, 515–560 of https://github.com/a-ghorbani/pocketpal-ai/blob/1cddba8160be1cb49ebc71481bdce5c7315b6e28/e2e/helpers/selectors.ts
// MIT License, see LICENSES.md. Changed: string values anonymized (pseudo-words).


/**
 * Create selector by testID (preferred - works cross-platform)
 */
export const byTestId = (testId: string): string => {
  if (isAndroid()) {
    return `//*[contains(@resource-id, "${testId}")]`;
  }
  return `~${testId}`;
};

/**
 * Create selector by text content (fallback for elements without testID)
 */
export const byText = (text: string): string => {
  if (isAndroid()) {
    return `//*[@text="${text}" or @content-desc="${text}"]`;
  }
  return `-ios predicate string:label == "${text}" OR value == "${text}"`;
};

/**
 * Create selector targeting only static text elements (excludes buttons).
 * Useful when a text appears both in a hidden drawer button and a visible nav title.
 * On Android, also matches View elements (React Navigation renders header titles as Views).
 */
export const byStaticText = (text: string): string => {
  if (isAndroid()) {
    return `//*[self::android.widget.TextView or self::android.view.View][@text="${text}"]`;
  }
  return `-ios class chain:**/XCUIElementTypeStaticText[\`label == "${text}"\`]`;
};

/**
 * Create selector by partial text match
 */
export const byPartialText = (text: string): string => {
  if (isAndroid()) {
    return `//*[contains(@text, "${text}") or contains(@content-desc, "${text}")]`;
  }
  return `-ios predicate string:label CONTAINS "${text}" OR value CONTAINS "${text}"`;
};

/**
 * Create selector by exact accessibilityLabel match
 * Use this for buttons with known labels like "Close menu", "Add from Hugging Face"
 */
export const byAccessibilityLabel = (label: string): string => {
  if (isAndroid()) {
    return `~${label}`;
  }
  return `~${label}`;
};

/**
 * Create selector by partial accessibilityLabel match
 * Use this when searching for elements where the label may contain additional text
 */
export const byAccessibilityLabelContains = (label: string): string => {
  if (isAndroid()) {
    return `//*[contains(@content-desc, "${label}")]`;
  }
  return `-ios predicate string:label CONTAINS "${label}"`;
};

/**
 * Create selector for an element whose testID starts with `prefix` and that
 * shows `text` itself or in a descendant
 */
export const withinTestIdPrefix = (prefix: string, text: string): string => {
  if (isAndroid()) {
    return `//*[starts-with(@resource-id, "${prefix}")][descendant-or-self::*[@text="${text}" or @content-desc="${text}"]]`;
  }
  return `-ios class chain:**/*[\`name BEGINSWITH "${prefix}"\`]/**/*[\`label == "${text}"\`]`;
};

/**
 * Exact testID match; byTestId matches any id that contains the given one.
 */
export const byExactTestId = (testId: string): string => {
  if (isAndroid()) {
    return `//*[@resource-id="${testId}"]`;
  }
  return `~${testId}`;
};

/**
 * An element by exact testID inside any element whose testID starts with prefix.
 */
export const testIdWithinPrefix = (prefix: string, testId: string): string => {
  if (isAndroid()) {
    return `//*[starts-with(@resource-id, "${prefix}")]//*[@resource-id="${testId}"]`;
  }
  return `-ios class chain:**/*[\`name BEGINSWITH "${prefix}"\`]/**/*[\`name == "${testId}"\`]`;
};


// …

  // These are OS-level dialogs with platform-specific selectors
  alert: {
    // Alert container
    get container(): string {
      if (isAndroid()) {
        // Android AlertDialog
        return '//android.widget.FrameLayout[@resource-id="android:id/content"]//android.widget.ScrollView';
      }
      // iOS Alert
      return '-ios class chain:**/XCUIElementTypeAlert';
    },
    // Alert title
    get title(): string {
      if (isAndroid()) {
        return '//android.widget.TextView[@resource-id="android:id/alertTitle"]';
      }
      return '-ios class chain:**/XCUIElementTypeAlert/**/XCUIElementTypeStaticText[1]';
    },
    // Alert message
    get message(): string {
      if (isAndroid()) {
        return '//android.widget.TextView[@resource-id="android:id/message"]';
      }
      return '-ios class chain:**/XCUIElementTypeAlert/**/XCUIElementTypeStaticText[2]';
    },
    // Dynamic: alert button by text label
    button: (label: string): string => {
      if (isAndroid()) {
        // Android uses Button with text attribute
        return `//android.widget.Button[@text="${label}"]`;
      }
      // iOS uses XCUIElementTypeButton with label
      return `-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}"`;
    },
    // Common button shortcuts
    // Note: Android AlertDialog buttons are displayed in UPPERCASE
    get cancelButton(): string {
      if (isAndroid()) {
        return '//android.widget.Button[@text="GURIZI"]';
      }
      return `-ios predicate string:type == "XCUIElementTypeButton" AND label == "Gurizi"`;
    },
    get continueButton(): string {
      if (isAndroid()) {
        return '//android.widget.Button[@text="VOVAWEDO"]';
      }
