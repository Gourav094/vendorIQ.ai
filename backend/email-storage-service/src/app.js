// Load global environment variables first
import dotenv from 'dotenv';
import { loadGlobalEnv } from '../../config/load-env.js';
loadGlobalEnv(dotenv);

import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import logger, { requestLogger } from "./utils/logger.js";

import swaggerUi from "swagger-ui-express";
import { swaggerDocs } from "./routes/swaggerDocs.js";
import emailRoutes from "./routes/emailRoutes.js";
import processingJobRoutes from "./routes/processingJobRoutes.js";
import { connectDB } from "./config/db.js";
import { getGoogleAuthURL, googleOAuthCallback } from "./controllers/authController.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
    origin: ["http://localhost:8000", "http://localhost:5173", "http://localhost:3000", "http://localhost:4000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

connectDB();

// Rate limiters
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { message: "Too many authentication requests. Please try again later.", retryAfter: "1 minute" }
});

const fetchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { message: "Too many fetch requests. Please wait before retrying.", retryAfter: "1 minute" },
    standardHeaders: true,
    legacyHeaders: false
});

// Swagger documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "OK", service: "email-storage-service" });
});

app.get("/", (req, res) => {
    res.send("Welcome to the Email Storage Service API");
});

app.get("/api-info", (req, res) => {
    res.json({
        service: "Email Storage Service",
        version: "1.0.0",
        description: "Service for fetching, storing, and managing emails from Gmail with automated vendor detection and Drive organization",
        documentation: `http://localhost:${config.port}/api-docs`,
        endpoints: {
            authentication: {
                "GET /auth/google": "Initialize Google OAuth flow",
                "GET /auth/google/callback": "OAuth callback handler"
            },
            emails: {
                "POST /api/v1/emails/fetch": "Fetch and process emails with filtering options",
                "GET /api/v1/emails/schedule/:userId": "Get scheduled email fetch jobs for user",
                "DELETE /api/v1/emails/schedule/:userId/:jobId": "Cancel a scheduled job"
            },
            processing: {
                "GET /api/v1/processing/jobs/:jobId": "Get job status by ID",
                "GET /api/v1/processing/users/:userId/jobs": "List all jobs for a user",
                "GET /api/v1/processing/users/:userId/jobs/retryable": "Get retryable failed jobs",
                "POST /api/v1/processing/jobs/:jobId/retry": "Retry a failed job"
            },
            drive: {
                "GET /api/v1/drive/users/:userId/vendors": "List all vendor folders in Drive",
                "GET /api/v1/drive/users/:userId/vendors/:vendorId/invoices": "List invoices for specific vendor"
            },
            users: {
                "GET /api/v1/users/:userId/sync-status": "Get user's last sync timestamp",
                "POST /api/v1/users/:userId/sync-status/reset": "Reset sync status to re-fetch all emails"
            }
        },
        features: [
            "Email-only vendor filtering",
            "Multi-vendor support (comma-separated emails)",
            "Automated vendor detection from email addresses",
            "Google Drive organization (invoiceAutomation folder structure)",
            "Manual and scheduled email fetching (hourly/daily/weekly)",
            "Sync status tracking to avoid duplicate fetches",
            "Persistent job tracking with retry capability"
        ],
        rateLimit: {
            auth: "60 requests per minute",
            fetch: "60 requests per minute"
        }
    });
});

// Google OAuth routes
app.get("/auth/google", authLimiter, getGoogleAuthURL);
app.get("/auth/google/callback", authLimiter, googleOAuthCallback);

// API routes
app.use("/api/v1", fetchLimiter, emailRoutes);
app.use("/api/v1/processing", processingJobRoutes);

// Start server
const server = app.listen(config.port, () => {
    logger.info(`Email Storage Service started on port ${config.port}`);
});

// Increase server timeout to 2 minutes
server.timeout = 120000;
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;