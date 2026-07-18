// Path: src/utils/logger.js
import pino from 'pino';
import config from '../config.js';

const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  transport: config.isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});

export default logger;
