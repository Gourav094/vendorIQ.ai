import GoogleIntegration from "../models/GoogleIntegration.js";
import logger from "../utils/logger.js";
import { listVendorFolders, listVendorInvoices, getVendorMasterData } from "../services/driveService.js";

export const getVendorsByUser = async (req, res) => {
  try {
    const { userId } = req.params; // This is auth_user_id

    if (!userId) {
      return res.status(400).json({ 
        message: "Missing required parameter: userId.",
        details: "The userId path parameter is required to identify which user's vendors to list.",
        example: "/api/v1/drive/users/678a1b2c3d4e5f6789abcdef/vendors"
      });
    }

    // Find Google integration by auth_user_id
    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({ 
        message: "Google account not connected.",
        details: "No Google integration found for this user.",
        action: "Connect your Google account at /auth/google to enable Drive access.",
        userId: userId
      });
    }

    if (integration.status !== "CONNECTED" || !integration.refresh_token) {
      return res.status(400).json({ 
        message: "Google Drive not connected.",
        details: "This user's Google integration is disconnected or missing tokens.",
        action: "Reconnect at /auth/google to grant Drive access.",
        userEmail: integration.email,
        status: integration.status
      });
    }

    const vendorsResult = await listVendorFolders(integration);
    const vendors = Array.isArray(vendorsResult) ? vendorsResult : [];

    return res.status(200).json({
      userId,
      total: vendors.length,
      vendors,
    });
  } catch (error) {
    logger.error(error, { source: "getVendorsByUser" });
    
    let userMessage = "Failed to retrieve vendor folders from Google Drive.";
    let suggestions = [];

    if (error.message?.includes("invalid_grant") || error.message?.includes("Token expired")) {
      userMessage = "Google authentication expired.";
      suggestions = ["Re-authenticate at /auth/google", "Grant permissions again"];
    } else if (error.message?.includes("Folder not found")) {
      userMessage = "Invoice automation folder not found.";
      suggestions = ["Fetch emails first to create the folder structure", "Check if 'invoiceAutomation' folder exists in Drive"];
    }

    return res.status(500).json({
      message: userMessage,
      details: error.message,
      suggestions: suggestions.length > 0 ? suggestions : ["Check server logs for more details", "Verify Google Drive API access"],
      timestamp: new Date().toISOString()
    });
  }
};

export const getInvoicesByVendor = async (req, res) => {
  try {
    const { userId, vendorId } = req.params; // userId is auth_user_id

    if (!userId || !vendorId) {
      return res.status(400).json({ 
        message: "Missing required parameters.",
        details: "Both 'userId' and 'vendorId' path parameters are required.",
        example: "/api/v1/drive/users/678a1b2c3d4e5f6789abcdef/vendors/1ABC123xyz/invoices",
        providedValues: { userId, vendorId }
      });
    }

    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({ 
        message: "Google account not connected.",
        details: "No Google integration found for this user.",
        action: "Connect your Google account at /auth/google.",
        userId: userId
      });
    }

    if (integration.status !== "CONNECTED" || !integration.refresh_token) {
      return res.status(400).json({ 
        message: "Google Drive not connected.",
        details: "This user's Google integration is disconnected or missing tokens.",
        action: "Reconnect at /auth/google to grant Drive access.",
        userEmail: integration.email
      });
    }

    const payload = await listVendorInvoices(integration, vendorId);

    return res.status(200).json({
      userId,
      vendorFolderId: payload.vendorFolderId,
      invoiceFolderId: payload.invoiceFolderId,
      total: payload.invoices.length,
      invoices: payload.invoices,
    });
  } catch (error) {
    logger.error(error, { source: "getInvoicesByVendor" });
    
    let userMessage = "Failed to retrieve invoices for this vendor.";
    let suggestions = [];

    if (error.message?.includes("invalid_grant") || error.message?.includes("Token expired")) {
      userMessage = "Google authentication expired.";
      suggestions = ["Re-authenticate at /auth/google"];
    } else if (error.message?.includes("Vendor folder not found") || error.message?.includes("Invalid vendorId")) {
      userMessage = "Vendor folder not found.";
      suggestions = ["Verify the vendorId is correct", "List all vendors first using GET /api/v1/drive/users/:userId/vendors", "Fetch emails first to populate vendor folders"];
    } else if (error.message?.includes("Invoice folder not found")) {
      userMessage = "No invoices folder found for this vendor.";
      suggestions = ["This vendor may not have any invoices yet", "Fetch emails to populate invoices"];
    }

    return res.status(500).json({
      message: userMessage,
      details: error.message,
      suggestions: suggestions.length > 0 ? suggestions : ["Check server logs", "Verify Google Drive access"],
      timestamp: new Date().toISOString()
    });
  }
};

export const getVendorMaster = async (req, res) => {
  try {
    const { userId, vendorId } = req.params; // userId is auth_user_id

    if (!userId || !vendorId) {
      return res.status(400).json({
        message: "Missing required parameters.",
        details: "Both 'userId' and 'vendorId' path parameters are required.",
        example: "/api/v1/drive/users/678a1b2c3d4e5f6789abcdef/vendors/1ABC123xyz/master",
        providedValues: { userId, vendorId },
      });
    }

    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({
        message: "Google account not connected.",
        details: "No Google integration found for this user.",
        action: "Connect your Google account at /auth/google.",
        userId: userId,
      });
    }

    if (integration.status !== "CONNECTED" || !integration.refresh_token) {
      return res.status(400).json({
        message: "Google Drive not connected.",
        details: "This user's Google integration is disconnected or missing tokens.",
        action: "Reconnect at /auth/google to grant Drive access.",
        userEmail: integration.email,
      });
    }

    const masterPayload = await getVendorMasterData(integration, vendorId);

    return res.status(200).json({
      userId,
      vendorFolderId: masterPayload.vendorFolderId,
      invoiceFolderId: masterPayload.invoiceFolderId,
      masterFileId: masterPayload.masterFileId,
      updatedAt: masterPayload.updatedAt,
      size: masterPayload.size,
      missing: masterPayload.missing,
      reason: masterPayload.reason || null,
      records: masterPayload.records,
    });
  } catch (error) {
    logger.error(error, { source: "getVendorMaster" });

    let userMessage = "Failed to retrieve master.json for this vendor.";
    let suggestions = [];

    if (error.message?.includes("invalid_grant") || error.message?.includes("Token expired")) {
      userMessage = "Google authentication expired.";
      suggestions = ["Re-authenticate at /auth/google"];
    } else if (error.message?.includes("Vendor folder not found")) {
      userMessage = "Vendor folder not found.";
      suggestions = ["Verify the vendorId is correct", "List vendors using GET /api/v1/drive/users/:userId/vendors"];
    }

    return res.status(500).json({
      message: userMessage,
      details: error.message,
      suggestions: suggestions.length > 0 ? suggestions : ["Check server logs", "Verify Google Drive access"],
      timestamp: new Date().toISOString(),
    });
  }
};
