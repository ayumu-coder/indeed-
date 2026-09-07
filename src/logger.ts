import type { Logger } from './ports.ts';

/** Single-line JSON per event — readable in the GitHub Actions log and greppable. */
export function createLogger(stream: NodeJS.WriteStream = process.stdout): Logger {
  const emit = (level: string, message: string, fields?: Readonly<Record<string, unknown>>): void => {
    stream.write(`${JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields })}\n`);
  };
  return {
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
