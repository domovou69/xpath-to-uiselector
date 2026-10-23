// Single source of truth for outcomes. The converter, the file scanner, and the
// test suite all compare against these values — typos in a bare string would
// silently skip a branch.
const STATUS = Object.freeze({
  SUCCESS:                   'success',
  SKIPPED_NOT_XPATH:         'skipped_not_xpath',
  SKIPPED_IOS:               'skipped_ios',
  SKIPPED_XPATH_STRATEGY:    'skipped_xpath_strategy',
  SKIPPED_UNKNOWN_STRATEGY:  'skipped_unknown_strategy',
  SKIPPED_UNSUPPORTED_LOGIC: 'skipped_unsupported_logic',
  SKIPPED_VALIDATION_FAILED: 'skipped_validation_failed',
  SKIPPED_NO_CHANGE:         'skipped_no_change',
  SKIPPED_NOT_EXACT:         'skipped_not_exact',
});

module.exports = STATUS;
