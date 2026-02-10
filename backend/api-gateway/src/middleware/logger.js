const winston = require('winston');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'api-gateway' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Simplified request logger - single log per request
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = requestId;

  // Log only on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]('Request completed', {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id
    });
  });

  next();
};

// Log proxy errors only
const logProxyError = (serviceName, target, req, err) => {
  logger.error('Proxy error', {
    requestId: req.requestId,
    service: serviceName,
    target,
    error: err.message
  });
};

module.exports = {
  logger,
  requestLogger,
  logProxyError
};
