/**
 * Production-safe logger.
 * Logs are only emitted when VITE_LOG_LEVEL=debug (set in .env).
 * In production builds, all debug/info calls become no-ops.
 */
const isDev = import.meta.env.DEV
const debugEnabled = import.meta.env.VITE_LOG_LEVEL === 'debug'

const noop = () => {}

const logger = {
  debug: isDev && debugEnabled ? console.log.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

export default logger
