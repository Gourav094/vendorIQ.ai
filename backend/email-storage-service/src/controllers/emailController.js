import { fetchAndProcessEmails } from "../services/gmailService.js";
import scheduleEmailJob, { getScheduledJobs, cancelScheduledJob } from "../services/schedulerService.js";
import GoogleIntegration from "../models/GoogleIntegration.js";
import ProcessingJob from "../models/ProcessingJob.js";

// ===============================================
// PERSISTENT JOB FUNCTIONS (using MongoDB)
// ===============================================

async function createJob(userId, jobType, filters) {
  const jobId = `${jobType}_${userId}_${Date.now()}`;

  const job = await ProcessingJob.create({
    jobId,
    userId,
    jobType,
    status: "PENDING",
    payload: filters,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return job.jobId;
}

async function updateJobSuccess(jobId, result) {
  const job = await ProcessingJob.findOne({ jobId });
  if (job) {
    await job.markAsCompleted(result);
  }
}

async function updateJobError(jobId, error) {
  const job = await ProcessingJob.findOne({ jobId });
  if (job) {
    await job.markAsFailed(error);
  }
}

async function updateJobProgress(jobId, progress) {
  const job = await ProcessingJob.findOne({ jobId });
  if (job) {
    await job.updateProgress(progress);
  }
}

export async function getJobStatus(jobId) {
  const job = await ProcessingJob.findOne({ jobId }).lean();
  return job || null;
}

export const fetchEmailsController = async (req, res) => {
  try {
    const {
      userId,           // auth_user_id from auth service
      fromDate,
      schedule = "manual",
      email,
      onlyPdf = true,
      forceSync = false
    } = req.body;

    // Parse email parameter - support comma-separated multiple emails
    let emailList = null;
    if (email) {
      emailList = email.split(',').map(e => e.trim()).filter(e => e.length > 0);
    }

    // Required fields check
    if (!userId || !fromDate) {
      return res.status(400).json({
        message: "Missing required fields: 'userId' and 'fromDate' are required.",
        details: "Provide a valid auth user ID from authentication service and a date or datetime (YYYY-MM-DD or ISO timestamp).",
        example: {
          userId: "678a1b2c3d4e5f6789abcdef",
          fromDate: "2024-01-01T10:30:00Z"
        }
      });
    }

    // Find Google integration for this user
    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({
        message: "Google account not connected.",
        details: "This user has not connected their Google account. Please authenticate first.",
        action: "Connect your Google account at /auth/google to enable email sync.",
        userId: userId
      });
    }

    // Check if integration is connected and has refresh token
    if (integration.status !== "CONNECTED" || !integration.refresh_token) {
      return res.status(400).json({
        message: "Google account not properly connected.",
        details: "The Google integration is disconnected or missing required tokens.",
        action: "Reconnect your Google account at /auth/google to grant Gmail and Drive access.",
        status: integration.status
      });
    }

    // Log request details
    console.log("Fetch request:", {
      userId,
      email: integration.email,
      fromDate,
      emails: emailList || "ALL",
      emailCount: emailList ? emailList.length : 0,
      onlyPdf,
      forceSync,
      lastSyncedAt: integration.lastSyncedAt
    });

    // Manual Fetch - ASYNC WITH PERSISTENT JOB TRACKING
    if (schedule === "manual") {
      const filters = {
        emails: emailList,
        emailCount: emailList ? emailList.length : 0,
        onlyPdf,
        fromDate,
        forceSync
      };

      const jobId = await createJob(userId, "EMAIL_FETCH", filters);
      const job = await ProcessingJob.findOne({ jobId });

      // Process in background
      setImmediate(async () => {
        try {
          await job.markAsProcessing();

          const result = await fetchAndProcessEmails(userId, fromDate, { emails: emailList, onlyPdf, forceSync });

          await updateJobSuccess(jobId, result);
          await updateJobProgress(jobId, {
            total: result.totalProcessed || 0,
            completed: result.filesUploaded || 0,
            failed: 0
          });

          console.log(`✅ Job ${jobId} completed successfully`);
        } catch (error) {
          console.error(`❌ Job ${jobId} failed:`, error.message);
          await updateJobError(jobId, {
            message: error.message,
            code: error.code,
            retryable: !error.message?.includes("Invalid") && !error.message?.includes("not found"),
            timestamp: new Date().toISOString()
          });
        }
      });

      // Return immediately with jobId
      return res.status(202).json({
        message: "Email fetch job started. Use the jobId to check status.",
        jobId,
        filtersUsed: filters,
        statusEndpoint: `/api/v1/processing/jobs/${jobId}`
      });
    }

    // Scheduled (Auto Fetch using cron)
    if (schedule?.type === "auto" && schedule?.frequency) {
      const jobId = scheduleEmailJob(userId, fromDate, schedule.frequency, { emails: emailList, onlyPdf, forceSync });
      return res.status(200).json({
        message: `Emails will now be fetched automatically every ${schedule.frequency}.`,
        jobId: jobId,
        filtersUsed: { emails: emailList, emailCount: emailList ? emailList.length : 0, onlyPdf, fromDate, forceSync }
      });
    }

    // Invalid schedule
    return res.status(400).json({
      message: "Invalid schedule format.",
      details: "The 'schedule' parameter must be either 'manual' or an object with 'type' and 'frequency'.",
      validFormats: [
        "manual",
        { type: "auto", frequency: "hourly" },
        { type: "auto", frequency: "daily" },
        { type: "auto", frequency: "weekly" }
      ],
      providedValue: schedule
    });

  } catch (error) {
    console.error("Error in fetchEmailsController:", error);
    let userMessage = "Failed to fetch and process emails.";
    let details = error.message;
    let suggestions = [];

    if (error.message?.includes("No Gmail connected")) {
      userMessage = "Gmail connection error.";
      details = "Unable to access Gmail API. The user's Google refresh token may be invalid or expired.";
      suggestions = ["Re-authenticate by visiting /auth/google", "Check if Google account permissions are still granted"];
    } else if (error.message?.includes("Invalid date")) {
      userMessage = "Invalid date format.";
      details = "The 'fromDate' value could not be parsed.";
      suggestions = ["Use format YYYY-MM-DD or a valid ISO datetime", "Ensure the date is not in the future"];
    } else if (error.message?.includes("Rate limit")) {
      userMessage = "Gmail API rate limit exceeded.";
      details = "Too many requests to Gmail API. Please wait before retrying.";
      suggestions = ["Wait 1-2 minutes before retrying", "Reduce the frequency of email fetches"];
    }

    return res.status(500).json({
      message: userMessage,
      details: details,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Get all scheduled jobs for a user
 */
export const getScheduledJobsController = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        message: "Invalid user ID.",
        details: "User ID is required.",
        providedValue: userId
      });
    }

    const jobs = getScheduledJobs(userId);
    return res.status(200).json({
      message: "Scheduled jobs retrieved successfully.",
      count: jobs.length,
      jobs: jobs
    });

  } catch (error) {
    console.error("Error in getScheduledJobsController:", error);
    return res.status(500).json({
      message: "Failed to retrieve scheduled jobs.",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Cancel a scheduled job
 */
export const cancelScheduledJobController = async (req, res) => {
  try {
    const { userId, jobId } = req.params;

    if (!userId) {
      return res.status(400).json({
        message: "Invalid user ID.",
        details: "User ID is required.",
        providedValue: userId
      });
    }

    if (!jobId) {
      return res.status(400).json({
        message: "Job ID is required.",
        details: "Please provide a valid job ID to cancel."
      });
    }

    const success = cancelScheduledJob(userId, jobId);

    if (success) {
      return res.status(200).json({
        message: "Scheduled job cancelled successfully.",
        jobId: jobId
      });
    } else {
      return res.status(404).json({
        message: "Scheduled job not found.",
        details: `No job found with ID ${jobId} for user ${userId}.`,
        suggestions: ["Verify the job ID is correct", "Check if the job was already cancelled"]
      });
    }

  } catch (error) {
    console.error("Error in cancelScheduledJobController:", error);
    return res.status(500).json({
      message: "Failed to cancel scheduled job.",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
