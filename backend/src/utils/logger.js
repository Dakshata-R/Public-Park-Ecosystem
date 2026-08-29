'use strict';

/**
 * Minimal timestamped console logger.
 *
 * A dependency-free stand-in for winston/pino — enough structure for a
 * prototype without adding another package to explain during the viva.
 */

const COLOURS = {
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  success: '\x1b[32m', // green
  reset: '\x1b[0m',
};

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (level, stream, args) => {
  const colour = COLOURS[level] || '';
  stream(`${colour}[${stamp()}] ${level.toUpperCase().padEnd(7)}${COLOURS.reset}`, ...args);
};

module.exports = {
  info: (...args) => write('info', console.log, args),
  warn: (...args) => write('warn', console.warn, args),
  error: (...args) => write('error', console.error, args),
  success: (...args) => write('success', console.log, args),
};
