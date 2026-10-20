const STATUS = require('./status');

// Placeholder until PLAN.md stage 4: the converter is written against the S
// cases and the device oracle (stages 1–3), not before them. Until then every
// XPath is reported as a skip, so the scanner, the CLI and the report can be
// used and tested on real folders without touching a file.
function convertXpathToUiSelector(xpath) {
  return { locator: xpath, status: STATUS.SKIPPED_UNSUPPORTED_LOGIC, reason: 'converter not implemented yet' };
}

module.exports = { convertXpathToUiSelector };
