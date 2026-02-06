import mongoose from "mongoose";

/**
 * Persistent job tracking model for email fetch and processing operations.
 * Replaces in-memory job storage to ensure jobs survive service restarts
 * and provide queryable history of all processing operations.
 */
const ProcessingJobSchema = new mongoose.Schema(
    {
        // Unique job identifier
        jobId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        // User who owns this job
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        // Type of processing job
        jobType: {
            type: String,
            enum: ["EMAIL_FETCH", "VENDOR_SYNC", "OCR_RETRY", "MANUAL_RETRY"],
            required: true,
            index: true
        },

        // Current job status
        status: {
            type: String,
            enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "RETRY_PENDING"],
            default: "PENDING",
            index: true
        },

        // Original request parameters (for retry purposes)
        payload: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },

        // Success result data
        result: {
            type: mongoose.Schema.Types.Mixed
        },

        // Error information
        error: {
            message: String,
            code: String,
            details: mongoose.Schema.Types.Mixed,
            retryable: { type: Boolean, default: true },
            stackTrace: String
        },

        // Retry tracking
        retryCount: {
            type: Number,
            default: 0
        },

        maxRetries: {
            type: Number,
            default: 3
        },

        lastRetryAt: Date,

        // Metadata
        createdAt: {
            type: Date,
            default: Date.now,
            index: true
        },

        updatedAt: {
            type: Date,
            default: Date.now
        },

        completedAt: Date,

        // Progress tracking for batch operations
        progress: {
            total: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
            skipped: { type: Number, default: 0 }
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

// Compound indexes for common queries
ProcessingJobSchema.index({ userId: 1, status: 1 });
ProcessingJobSchema.index({ userId: 1, jobType: 1 });
ProcessingJobSchema.index({ userId: 1, createdAt: -1 });

// Instance methods
ProcessingJobSchema.methods.markAsProcessing = function () {
    this.status = "PROCESSING";
    this.updatedAt = new Date();
    return this.save();
};

ProcessingJobSchema.methods.markAsCompleted = function (result) {
    this.status = "COMPLETED";
    this.result = result;
    this.completedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
};

ProcessingJobSchema.methods.markAsFailed = function (error) {
    this.status = "FAILED";
    this.error = {
        message: error.message || String(error),
        code: error.code,
        details: error.details,
        retryable: error.retryable !== false, // Default to retryable
        stackTrace: error.stack
    };
    this.completedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
};

ProcessingJobSchema.methods.canRetry = function () {
    return (
        this.status === "FAILED" &&
        this.error?.retryable !== false &&
        this.retryCount < this.maxRetries
    );
};

ProcessingJobSchema.methods.incrementRetry = function () {
    this.retryCount += 1;
    this.lastRetryAt = new Date();
    this.status = "RETRY_PENDING";
    this.updatedAt = new Date();
    return this.save();
};

ProcessingJobSchema.methods.updateProgress = function (progress) {
    this.progress = { ...this.progress, ...progress };
    this.updatedAt = new Date();
    return this.save();
};

// Static methods for querying
ProcessingJobSchema.statics.findByUserId = function (userId, options = {}) {
    const query = { userId };

    if (options.status) {
        query.status = options.status;
    }

    if (options.jobType) {
        query.jobType = options.jobType;
    }

    const limit = options.limit || 50;
    const skip = options.offset || 0;

    return this.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean();
};

ProcessingJobSchema.statics.getFailedJobs = function (userId) {
    return this.find({
        userId,
        status: "FAILED",
        "error.retryable": true
    })
        .sort({ createdAt: -1 })
        .lean();
};

export default mongoose.model("ProcessingJob", ProcessingJobSchema);
