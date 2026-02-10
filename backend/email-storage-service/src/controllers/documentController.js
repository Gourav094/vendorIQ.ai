import axios from "axios";
import GoogleIntegration from "../models/GoogleIntegration.js";
import Document from "../models/Document.js";
import logger from "../utils/logger.js";

const OCR_BASE_URL = process.env.OCR_SERVICE_URL || "http://localhost:4003";

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
 * Get document status for a user from MongoDB (single source of truth)
 * Returns all documents with OCR status and indexed status
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

        // Get all documents from MongoDB (single source of truth)
        const documents = await Document.find({ userId })
            .sort({ createdAt: -1 })
            .limit(200);

        // Calculate summary from actual MongoDB data
        const summary = {
            total: documents.length,
            pending: documents.filter(d => d.ocrStatus === "PENDING").length,
            processing: documents.filter(d => d.ocrStatus === "PROCESSING").length,
            completed: documents.filter(d => d.ocrStatus === "COMPLETED").length,
            failed: documents.filter(d => d.ocrStatus === "FAILED").length,
            indexed: documents.filter(d => d.indexed === true).length,
            pendingIndex: documents.filter(d => d.ocrStatus === "COMPLETED" && !d.indexed).length,
        };

        // Map documents to response format
        const docs = documents.map(doc => ({
            driveFileId: doc.driveFileId,
            fileName: doc.fileName,
            vendorName: doc.vendorName,
            ocrStatus: doc.ocrStatus,
            indexed: doc.indexed || false,
            indexedAt: doc.indexedAt || null,
            ocrCompletedAt: doc.ocrCompletedAt || null,
            ocrError: doc.ocrError || null,
            webViewLink: doc.webViewLink,
            webContentLink: doc.webContentLink,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        }));

        return res.status(200).json({
            success: true,
            userId,
            summary,
            documents: docs,
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
