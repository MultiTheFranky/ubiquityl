const truthyValues = new Set(['1', 'true', 'yes', 'y', 'on']);

const isDebugEnabled = (() => {
  const raw = process.env.DEBUG;
  if (!raw) {
    return false;
  }
  return truthyValues.has(raw.trim().toLowerCase());
})();

export const logDebug = (...args: unknown[]): void => {
  if (!isDebugEnabled) {
    return;
  }
  const timestamp = new Date().toISOString();
  console.debug(`[debug ${timestamp}]`, ...args);
};

export const isDebug = (): boolean => isDebugEnabled;
