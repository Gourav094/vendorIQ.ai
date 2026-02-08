// filepath: /Users/I528930/vendorIQ/backend/email-storage-service/src/controllers/resetController.js
import GoogleIntegration from "../models/GoogleIntegration.js";
import ProcessingJob from "../models/ProcessingJob.js";
import Document from "../models/Document.js";
import { google } from "googleapis";

/**
 * Reset Email Sync - Clear processing jobs + reset lastSyncedAt
 */
export const resetEmailSync = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Clear processing jobs for this user
    const jobsDeleted = await ProcessingJob.deleteMany({ userId });

    // Reset lastSyncedAt
    const syncReset = await GoogleIntegration.updateOne(
      { auth_user_id: userId },
      { $set: { lastSyncedAt: null } }
    );

    return res.status(200).json({
      success: true,
      message: "Email sync reset successfully",
      details: {
        processingJobsDeleted: jobsDeleted.deletedCount,
        syncStatusReset: syncReset.modifiedCount > 0
      }
    });

  } catch (error) {
    console.error("Error in resetEmailSync:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset email sync",
      error: error.message
    });
  }
};

/**
 * Reset OCR Processing - Set all documents ocrStatus = PENDING
 */
export const resetOcrProcessing = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Reset all documents to PENDING status
    const result = await Document.updateMany(
      { userId },
      { 
        $set: { 
          ocrStatus: "PENDING",
          ocrError: null,
          ocrCompletedAt: null,
          updatedAt: new Date()
        } 
      }
    );

    return res.status(200).json({
      success: true,
      message: "OCR processing reset successfully",
      details: {
        documentsReset: result.modifiedCount
      }
    });

  } catch (error) {
    console.error("Error in resetOcrProcessing:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset OCR processing",
      error: error.message
    });
  }
};

/**
 * Reset AI Database - Clear indexed flag (VectorDB cleared via chat-service)
 */
export const resetAiDatabase = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Reset indexed flag for all documents
    const result = await Document.updateMany(
      { userId },
      { 
        $set: { 
          indexed: false,
          indexedAt: null,
          updatedAt: new Date()
        } 
      }
    );

    return res.status(200).json({
      success: true,
      message: "AI database flags reset successfully",
      details: {
        documentsReset: result.modifiedCount
      }
    });

  } catch (error) {
    console.error("Error in resetAiDatabase:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset AI database",
      error: error.message
    });
  }
};

/**
 * Hard Reset - Delete all user data including Drive folders
 */
export const hardReset = async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirmDelete } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    if (confirmDelete !== true) {
      return res.status(400).json({
        success: false,
        message: "Confirmation required. Set confirmDelete: true in request body.",
        warning: "This action will permanently delete all your data including Google Drive files."
      });
    }

    const results = {
      processingJobsDeleted: 0,
      documentsDeleted: 0,
      syncStatusReset: false,
      driveFoldersDeleted: 0,
      driveError: null
    };

    // 1. Delete processing jobs
    const jobsResult = await ProcessingJob.deleteMany({ userId });
    results.processingJobsDeleted = jobsResult.deletedCount;

    // 2. Get Google integration for Drive access
    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    // 3. Delete Drive folders if integration exists
    if (integration?.refresh_token) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: integration.refresh_token });

        const drive = google.drive({ version: "v3", auth: oauth2Client });

        // Find and delete the parent "invoiceAutomation" folder
        const folderSearch = await drive.files.list({
          q: "name='invoiceAutomation' and mimeType='application/vnd.google-apps.folder' and trashed=false",
          fields: "files(id, name)",
          spaces: "drive"
        });

        if (folderSearch.data.files?.length > 0) {
          for (const folder of folderSearch.data.files) {
            await drive.files.delete({ fileId: folder.id });
            results.driveFoldersDeleted++;
            console.log(`Deleted Drive folder: ${folder.name} (${folder.id})`);
          }
        }
      } catch (driveError) {
        console.error("Error deleting Drive folders:", driveError.message);
        results.driveError = driveError.message;
      }
    }

    // 4. Delete all documents from MongoDB
    const docsResult = await Document.deleteMany({ userId });
    results.documentsDeleted = docsResult.deletedCount;

    // 5. Reset sync status
    const syncResult = await GoogleIntegration.updateOne(
      { auth_user_id: userId },
      { $set: { lastSyncedAt: null } }
    );
    results.syncStatusReset = syncResult.modifiedCount > 0;

    return res.status(200).json({
      success: true,
      message: "Hard reset completed successfully",
      details: results,
      note: results.driveError 
        ? "Some Drive folders may not have been deleted. Please check manually." 
        : "All data has been permanently deleted."
    });

  } catch (error) {
    console.error("Error in hardReset:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to perform hard reset",
      error: error.message
    });
  }
};
