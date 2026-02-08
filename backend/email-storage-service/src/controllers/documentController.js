import axios from "axios";
import GoogleIntegration from "../models/GoogleIntegration.js";
import Document from "../models/Document.js";
import logger from "../utils/logger.js";

const OCR_BASE_URL = process.env.OCR_SERVICE_BASE_URL || "http://localhost:4003";

/**
 * Process all pending documents for a user
 * Groups documents by vendor and triggers batch OCR processing
 */
export const processDocuments = async (req, res) => {
    try {
        const { userId } = req.body; // auth_user_id

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required"
            });
        }

        const integration = await GoogleIntegration.findOne({
            auth_user_id: userId,
            provider: "google"
        });

        if (!integration || integration.status !== "CONNECTED" || !integration.refresh_token) {
            return res.status(404).json({
                success: false,
                message: "User not found or Google account not connected"
            });
        }

        // Get all pending documents for this user (using Document model)
        const documents = await Document.find({
            userId: userId,
            ocrStatus: "PENDING"
        }).sort({ createdAt: -1 });

        if (documents.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No documents to process",
                totalDocuments: 0,
                processed: 0
            });
        }

        // Group by vendor
        const vendorGroups = {};
        for (const doc of documents) {
            const vendorKey = doc.vendorFolderId || doc.vendorName || "Unknown";
            if (!vendorGroups[vendorKey]) {
                vendorGroups[vendorKey] = {
                    vendorName: doc.vendorName,
                    vendorFolderId: doc.vendorFolderId,
                    invoiceFolderId: doc.invoiceFolderId,
                    invoices: []
                };
            }
            vendorGroups[vendorKey].invoices.push({
                fileId: doc.driveFileId,
                fileName: doc.fileName,
                mimeType: "application/pdf",
                webViewLink: doc.webViewLink,
                webContentLink: doc.webContentLink
            });
        }

        // Trigger OCR for each vendor batch
        const results = [];
        for (const batch of Object.values(vendorGroups)) {
            try {
                const payload = {
                    userId,
                    vendorName: batch.vendorName,
                    vendorFolderId: batch.vendorFolderId,
                    invoiceFolderId: batch.invoiceFolderId,
                    refreshToken: integration.refresh_token,
                    invoices: batch.invoices
                };

                logger.info("Triggering batch OCR processing", {
                    userId,
                    vendorName: batch.vendorName,
                    invoiceCount: batch.invoices.length
                });

                const response = await axios.post(
                    `${OCR_BASE_URL}/api/v1/processing/vendor`,
                    payload,
                    { timeout: 90000 }
                );

                results.push({
                    vendor: batch.vendorName,
                    status: "queued",
                    invoiceCount: batch.invoices.length,
                    response: response.data
                });

                logger.info("Batch OCR processing queued", {
                    userId,
                    vendorName: batch.vendorName,
                    status: response.status
                });

            } catch (error) {
                logger.error("Failed to trigger batch OCR", {
                    userId,
                    vendorName: batch.vendorName,
                    error: error.message
                });
                results.push({
                    vendor: batch.vendorName,
                    status: "failed",
                    error: error.message
                });
            }
        }

        const totalQueued = results.filter(r => r.status === "queued").length;
        const totalFailed = results.filter(r => r.status === "failed").length;

        return res.status(200).json({
            success: true,
            message: `Processing started for ${totalQueued} vendor${totalQueued !== 1 ? 's' : ''}`,
            totalDocuments: documents.length,
            vendorsProcessed: totalQueued,
            vendorsFailed: totalFailed,
            results
        });

    } catch (error) {
        logger.error("Error in processDocuments", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to process documents",
            error: error.message
        });
    }
};

/**
 * Get simple document status for a user
 * Returns all documents with their processing status
 */
export const getDocumentStatus = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required"
            });
        }

        // Get all attachments for this user
        const attachments = await Document.find({
            userId
        }).sort({ createdAt: -1 }).limit(100);

        // For now, we'll query the OCR service for detailed status
        // In the future, we'll have a unified status collection
        let statusDetails = [];
        try {
            const ocrResponse = await axios.get(
                `${OCR_BASE_URL}/api/v1/processing/status/summary?userId=${userId}`,
                { timeout: 5000 }
            );
            statusDetails = ocrResponse.data;
        } catch (error) {
            logger.warn("Could not fetch OCR status", { error: error.message });
        }

        // Map attachments to simple status format
        const documents = attachments.map(att => ({
            fileId: att.driveFileId,
            filename: att.fileName,
            vendor: att.vendorName,
            status: "pending", // Will be enhanced with actual status
            uploadedAt: att.createdAt,
            webViewLink: att.webViewLink
        }));

        const summary = {
            totalDocuments: documents.length,
            completed: 0,
            failed: 0,
            pending: documents.length,
            processing: 0
        };

        // If we have OCR status, merge it
        if (statusDetails && statusDetails.by_status) {
            summary.completed = statusDetails.by_status.COMPLETED || 0;
            summary.failed = (statusDetails.by_status.OCR_FAILED || 0) + (statusDetails.by_status.CHAT_FAILED || 0);
            summary.processing = (statusDetails.by_status.OCR_PROCESSING || 0) + (statusDetails.by_status.CHAT_INDEXING || 0);
            summary.pending = statusDetails.by_status.PENDING || 0;
        }

        return res.status(200).json({
            success: true,
            userId,
            summary,
            documents,
            ocrStatus: statusDetails
        });

    } catch (error) {
        logger.error("Error getting document status", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get document status",
            error: error.message
        });
    }
};

/**
 * Get pending documents count for a user
 * Returns count of documents with ocrStatus: PENDING
 */
export const getPendingDocuments = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required"
            });
        }

        // Get pending documents from MongoDB
        const pendingDocs = await Document.find({
            userId,
            ocrStatus: "PENDING"
        }).select("driveFileId fileName vendorName createdAt").sort({ createdAt: -1 }).limit(100);

        return res.status(200).json({
            success: true,
            userId,
            count: pendingDocs.length,
            documents: pendingDocs.map(doc => ({
                fileId: doc.driveFileId,
                filename: doc.fileName,
                vendor: doc.vendorName,
                createdAt: doc.createdAt
            }))
        });

    } catch (error) {
        logger.error("Error getting pending documents", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get pending documents",
            error: error.message
        });
    }
};

/**
 * Retry failed or pending documents for a user
 * Securely retrieves refresh token from database and triggers OCR retry
 */
export const retryDocuments = async (req, res) => {
    try {
        const { userId, vendorName, driveFileIds } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required"
            });
        }

        // Get user's Google integration with refresh token
        const integration = await GoogleIntegration.findOne({
            auth_user_id: userId,
            provider: "google"
        });

        if (!integration || integration.status !== "CONNECTED" || !integration.refresh_token) {
            return res.status(404).json({
                success: false,
                message: "User not found or Google account not connected"
            });
        }

        // Call OCR service retry endpoint with secure refresh token
        const payload = {
            userId,
            vendorName,
            driveFileIds,
            refreshToken: integration.refresh_token,
            maxOcrRetries: 3,
            maxChatRetries: 3
        };

        logger.info("Triggering document retry", {
            userId,
            vendorName: vendorName || "all vendors",
            fileCount: driveFileIds?.length || "all failed"
        });

        const response = await axios.post(
            `${OCR_BASE_URL}/api/v1/processing/retry`,
            payload,
            {
                timeout: 90000,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        logger.info("Document retry completed", {
            userId,
            status: response.status,
            retried: response.data.retried
        });

        return res.status(200).json({
            success: true,
            message: response.data.message,
            ...response.data
        });

    } catch (error) {
        logger.error("Error in retryDocuments", {
            error: error.message,
            response: error.response?.data
        });
        return res.status(500).json({
            success: false,
            message: "Failed to retry documents",
            error: error.response?.data?.message || error.message
        });
    }
};
