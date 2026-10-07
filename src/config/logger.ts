import { pino, type LoggerOptions } from 'pino';
import { env } from './env';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[REDACTED]',
  },
};

if (env.NODE_ENV === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  };
}

export const logger = pino(options);
