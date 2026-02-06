import GoogleIntegration from "../models/GoogleIntegration.js";
import logger from "../utils/logger.js";

export const getUserSyncStatus = async (req, res) => {
  try {
    const { userId } = req.params; // This is auth_user_id from auth service

    // Find Google integration by auth_user_id
    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({ 
        message: "Google account not connected.",
        details: "No Google integration found for this user.",
        action: "Connect your Google account to enable email sync.",
        userId: userId,
        hasGoogleConnection: false
      });
    }

    const hasConnection = integration.status === "CONNECTED" && !!integration.refresh_token;
    const lastSync = integration.lastSyncedAt;

    let message = "User has never synced emails.";
    if (lastSync) {
      message = `User last synced on ${lastSync.toISOString()}. Next fetch will only get emails after this date unless forceSync=true is set.`;
    }

    return res.status(200).json({
      userId: integration.auth_user_id,
      email: integration.email,
      lastSyncedAt: lastSync,
      hasGoogleConnection: hasConnection,
      status: integration.status,
      message,
    });
  } catch (error) {
    logger.error(error, { context: "getUserSyncStatus" });
    return res.status(500).json({
      message: "Failed to retrieve user sync status.",
      details: error.message,
      suggestions: ["Check if the database connection is working", "Verify the userId is correct"],
      timestamp: new Date().toISOString()
    });
  }
};

export const resetUserSyncStatus = async (req, res) => {
  try {
    const { userId } = req.params; // This is auth_user_id

    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({ 
        message: "Google account not connected.",
        details: "No Google integration found for this user.",
        userId: userId
      });
    }

    integration.lastSyncedAt = null;
    await integration.save();

    logger.info("User sync status reset", { userId, email: integration.email });

    return res.status(200).json({
      message: "Sync status reset successfully. Next fetch will use the fromDate parameter.",
      userId,
    });
  } catch (error) {
    logger.error(error, { context: "resetUserSyncStatus" });
    return res.status(500).json({
      message: "Failed to reset sync status.",
      details: error.message,
      suggestions: ["Check database connection", "Verify the userId exists", "Try again in a few moments"],
      timestamp: new Date().toISOString()
    });
  }
};

export const disconnectGoogleAccount = async (req, res) => {
  try {
    const { userId } = req.params; // This is auth_user_id

    const integration = await GoogleIntegration.findOne({ 
      auth_user_id: userId,
      provider: "google"
    });

    if (!integration) {
      return res.status(404).json({
        message: "Google account not connected.",
        details: "No Google integration found for this user.",
        userId
      });
    }

    // Update integration to disconnected state
    integration.status = "DISCONNECTED";
    integration.access_token = null;
    integration.refresh_token = null;
    integration.disconnected_at = new Date();
    await integration.save();

    logger.info("Google account disconnected", { userId, email: integration.email });

    return res.status(200).json({
      message: "Google Drive connection disconnected successfully.",
      userId,
      hasGoogleConnection: false
    });
  } catch (error) {
    logger.error(error, { context: "disconnectGoogleAccount" });
    return res.status(500).json({
      message: "Failed to disconnect Google account.",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
