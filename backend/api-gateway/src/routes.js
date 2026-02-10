// src/routes.js
const { createProxyMiddleware } = require('http-proxy-middleware');
const { logProxyError } = require('./middleware/logger');

const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  email: process.env.EMAIL_SERVICE_URL || 'http://localhost:4002',
  ocr: process.env.OCR_SERVICE_URL || 'http://localhost:4003',
  chat: process.env.CHAT_SERVICE_URL || 'http://localhost:4005'
};

function makeProxyOptions(serviceName, target) {
  return {
    target,
    changeOrigin: true,
    secure: false,
    ws: true,
    logLevel: 'silent',
    pathRewrite: (path, req) => {
      return path.replace(new RegExp(`^/${serviceName}`), '') || '/';
    },
    onProxyReq: (proxyReq, req, res) => {
      proxyReq.removeHeader('cookie');

      if (req.user) {
        if (req.user.id) proxyReq.setHeader('x-user-id', req.user.id);
        if (req.user.email) proxyReq.setHeader('x-user-email', req.user.email);
        if (req.user.role) proxyReq.setHeader('x-user-role', req.user.role);
      }

      if (req.requestId) {
        proxyReq.setHeader('x-request-id', req.requestId);
      } else if (req.headers['x-request-id']) {
        proxyReq.setHeader('x-request-id', req.headers['x-request-id']);
      }
    },
    onError: (err, req, res) => {
      logProxyError(serviceName, target, req, err);
      
      if (!res.headersSent) {
        res.status(502).json({ error: 'Bad Gateway', message: 'Target service error' });
      }
    },
    timeout: 120000,
    proxyTimeout: 120000,
    selfHandleResponse: false
  };
}

// Export proxies to be mounted by index.js
module.exports = {
  auth: createProxyMiddleware(makeProxyOptions('auth', SERVICES.auth)),
  email: createProxyMiddleware(makeProxyOptions('email', SERVICES.email)),
  ocr: createProxyMiddleware(makeProxyOptions('ocr', SERVICES.ocr)),
  chat: createProxyMiddleware(makeProxyOptions('chat', SERVICES.chat))
};
