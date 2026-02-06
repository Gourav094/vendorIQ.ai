import ProcessingJob from "../models/ProcessingJob.js";
import logger from "../utils/logger.js";

/**
 * Processing job controller - handles job status queries and retry operations.
 * Provides API endpoints for persistent job tracking and management.
 */

/**
 * Get job status by jobId
 */
export const getJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;

        if (!jobId) {
            return res.status(400).json({
                message: "Job ID is required.",
                details: "Please provide a valid job ID to check status."
            });
        }

        const job = await ProcessingJob.findOne({ jobId }).lean();

        if (!job) {
            return res.status(404).json({
                message: "Job not found.",
                details: `No job found with ID ${jobId}. It may have expired or never existed.`,
                jobId
            });
        }

        return res.status(200).json(job);

    } catch (error) {
        logger.error("Error in getJobStatus:", error);
        return res.status(500).json({
            message: "Failed to retrieve job status.",
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * List all jobs for a user with filtering
 */
export const listUserJobs = async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, jobType, limit, offset } = req.query;

        if (!userId || !/^[a-f0-9]{24}$/.test(userId)) {
            return res.status(400).json({
                message: "Invalid user ID.",
                details: "User ID must be a valid 24-character hexadecimal MongoDB ObjectId.",
                providedValue: userId
            });
        }

        const options = {
            status,
            jobType,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        };

        const jobs = await ProcessingJob.findByUserId(userId, options);
        const totalCount = await ProcessingJob.countDocuments({ userId });

        return res.status(200).json({
            message: "Jobs retrieved successfully.",
            userId,
            total: totalCount,
            count: jobs.length,
            limit: options.limit,
            offset: options.offset,
            filters: {
                status: status || "all",
                jobType: jobType || "all"
            },
            jobs
        });

    } catch (error) {
        logger.error("Error in listUserJobs:", error);
        return res.status(500).json({
            message: "Failed to retrieve jobs.",
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Get failed/retryable jobs for a user
 */
export const getRetryableJobs = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId || !/^[a-f0-9]{24}$/.test(userId)) {
            return res.status(400).json({
                message: "Invalid user ID.",
                details: "User ID must be a valid 24-character hexadecimal MongoDB ObjectId.",
                providedValue: userId
            });
        }

        const failedJobs = await ProcessingJob.getFailedJobs(userId);

        return res.status(200).json({
            message: "Retryable jobs retrieved successfully.",
            userId,
            count: failedJobs.length,
            jobs: failedJobs
        });

    } catch (error) {
        logger.error("Error in getRetryableJobs:", error);
        return res.status(500).json({
            message: "Failed to retrieve retryable jobs.",
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Retry a failed job
 */
export const retryJob = async (req, res) => {
    try {
        const { jobId } = req.params;

        if (!jobId) {
            return res.status(400).json({
                message: "Job ID is required.",
                details: "Please provide a valid job ID to retry."
            });
        }

        const job = await ProcessingJob.findOne({ jobId });

        if (!job) {
            return res.status(404).json({
                message: "Job not found.",
                details: `No job found with ID ${jobId}.`,
                jobId
            });
        }

        // Check if job can be retried
        if (!job.canRetry()) {
            return res.status(400).json({
                message: "Job cannot be retried.",
                details: job.status === "COMPLETED"
                    ? "Job already completed successfully."
                    : job.retryCount >= job.maxRetries
                        ? `Maximum retry limit (${job.maxRetries}) reached.`
                        : "Job is not in a retryable state.",
                jobId,
                status: job.status,
                retryCount: job.retryCount,
                maxRetries: job.maxRetries
            });
        }

        // Increment retry counter
        await job.incrementRetry();

        // Re-trigger the job based on job type
        // For EMAIL_FETCH, trigger fetchAndProcessEmails
        if (job.jobType === "EMAIL_FETCH" || job.jobType === "VENDOR_SYNC") {
            // Import here to avoid circular dependency
            const { fetchAndProcessEmails } = await import("../services/gmailService.js");

            // Execute retry in background
            setImmediate(async () => {
                try {
                    await job.markAsProcessing();

                    const result = await fetchAndProcessEmails(
                        job.userId.toString(),
                        job.payload.fromDate,
                        {
                            emails: job.payload.emails,
                            onlyPdf: job.payload.onlyPdf,
                            forceSync: job.payload.forceSync
                        }
                    );

                    await job.markAsCompleted(result);
                    logger.info(`Retry successful for job ${jobId}`);

                } catch (error) {
                    logger.error(`Retry failed for job ${jobId}:`, error);
                    await job.markAsFailed(error);
                }
            });

            return res.status(202).json({
                message: "Job retry initiated.",
                jobId: job.jobId,
                retryCount: job.retryCount,
                status: "RETRY_PENDING",
                statusEndpoint: `/api/v1/processing/jobs/${jobId}`
            });
        }

        return res.status(400).json({
            message: "Unsupported job type for retry.",
            jobType: job.jobType
        });

    } catch (error) {
        logger.error("Error in retryJob:", error);
        return res.status(500).json({
            message: "Failed to retry job.",
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};
