import { pino } from 'pino';
import { config, isDev } from './config.js';

export const logger = pino({
  level: config.API_LOG_LEVEL,
  ...(isDev()
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.otp', '*.secret'],
    censor: '[REDACTED]',
  },
});
