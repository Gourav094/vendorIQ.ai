import express from "express";
import {
    getJobStatus,
    listUserJobs,
    getRetryableJobs,
    retryJob
} from "../controllers/processingJobController.js";

const router = express.Router();

/**
 * @route   GET /api/v1/processing/jobs/:jobId
 * @desc    Get status of a specific processing job
 * @access  Public (TODO: Add auth middleware)
 */
router.get("/jobs/:jobId", getJobStatus);

/**
 * @route   GET /api/v1/processing/users/:userId/jobs
 * @desc    List all jobs for a user with optional filtering
 * @access  Public (TODO: Add auth middleware)
 * @query   status - Filter by status (PENDING, PROCESSING, COMPLETED, FAILED, RETRY_PENDING)
 * @query   jobType - Filter by job type (EMAIL_FETCH, VENDOR_SYNC, etc.)
 * @query   limit - Pagination limit (default: 50)
 * @query   offset - Pagination offset (default: 0)
 */
router.get("/users/:userId/jobs", listUserJobs);

/**
 * @route   GET /api/v1/processing/users/:userId/jobs/retryable
 * @desc    Get all failed/retryable jobs for a user
 * @access  Public (TODO: Add auth middleware)
 */
router.get("/users/:userId/jobs/retryable", getRetryableJobs);

/**
 * @route   POST /api/v1/processing/jobs/:jobId/retry
 * @desc    Retry a failed job
 * @access  Public (TODO: Add auth middleware)
 */
router.post("/jobs/:jobId/retry", retryJob);

export default router;
