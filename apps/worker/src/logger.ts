/**
 * Strukturiertes Logging für den Worker (§43).
 *
 * Bewusst ohne zusätzliche Abhängigkeit: eine Zeile JSON pro Ereignis reicht
 * für Log-Aggregatoren, und der Worker hat keine Request-Kontexte.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(level: LogLevel = 'info', bindings: Record<string, unknown> = {}): Logger {
  const threshold = LEVELS[level];

  const write = (logLevel: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVELS[logLevel] < threshold) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: logLevel,
      msg: message,
      ...bindings,
      ...fields,
    });
    if (logLevel === 'error' || logLevel === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}
