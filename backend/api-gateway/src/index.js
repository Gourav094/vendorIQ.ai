// Load global environment variables first
const dotenv = require('dotenv');
const { loadGlobalEnv } = require('../../config/load-env');
loadGlobalEnv(dotenv);

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const verifyToken = require('./middleware/verifyToken');
const { logger, requestLogger } = require('./middleware/logger');

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 4000;
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8000';

// Security & parsing
app.use(helmet());
app.use(cookieParser());

// Apply centralized logging middleware
app.use(requestLogger);

// Body parsing - skip for proxy routes
const shouldParseBody = (req, res, next) => {
  if (req.path.startsWith('/auth') || 
      req.path.startsWith('/email') || 
      req.path.startsWith('/chat') || 
      req.path.startsWith('/ocr')) {
    return next();
  }
  express.json()(req, res, next);
};

app.use(shouldParseBody);
app.use(express.urlencoded({ extended: true }));

// CORS
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  })
);
app.options('*', cors());

// Rate limiting
app.use(
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Root & health
app.get('/', (req, res) => {
  res.json({
    service: 'VendorIQ API Gateway',
    version: '1.0.0',
    routes: ['/auth/*', '/email/*', '/chat/*', '/ocr/*']
  });
});
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Mount public routes
app.use('/auth', routes.auth);

// Apply JWT middleware for protected routes
app.use(verifyToken);

// Mount protected routes
app.use('/email', routes.email);
app.use('/chat', routes.chat);
app.use('/ocr', routes.ocr);

// Error handling
app.use((err, req, res, next) => {
  logger.error('Gateway error', {
    requestId: req.requestId,
    error: err.message,
    url: req.originalUrl || req.url,
    method: req.method
  });
  
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  } else {
    next(err);
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  logger.info('API Gateway started', { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development' 
  });
  console.log(`VendorIQ API Gateway listening on port ${PORT}`);
});
