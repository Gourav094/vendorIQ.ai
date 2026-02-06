import { google } from "googleapis";
import GoogleIntegration from "../models/GoogleIntegration.js";
import { config } from "../config/index.js";

const oauth2Client = new google.auth.OAuth2(
  config.google.clientId || process.env.GOOGLE_CLIENT_ID,
  config.google.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
  config.google.redirectUri || process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

// Step 1: Send Google OAuth URL with state containing auth_user_id
export const getGoogleAuthURL = (req, res) => {
  const { userId } = req.query; // Expecting auth_user_id from query
  
  if (!userId) {
    return res.status(400).json({
      message: "Missing userId parameter",
      details: "Please provide userId (auth_user_id) from authentication service"
    });
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: userId // Pass auth_user_id in state
  });

  const acceptsJson = req.headers?.accept?.includes("application/json");
  const fetchMode = req.headers["sec-fetch-mode"];

  if (acceptsJson || fetchMode === "cors") {
    return res.json({ url });
  }

  res.redirect(url);
};

// Step 2: Callback - Google returns code
export const googleOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const auth_user_id = state; // Get auth_user_id from state

    if (!auth_user_id) {
      return res.status(400).json({
        message: "Missing user identification",
        details: "No auth_user_id found in OAuth state"
      });
    }

    const { tokens } = await oauth2Client.getToken(code);

    // Set credentials to call userinfo
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();

    const email = userinfo?.email;
    if (!email) {
      return res.status(400).json({ 
        message: "Unable to retrieve email from Google account.",
        details: "Google OAuth succeeded but no email address was returned. This may indicate missing OAuth scopes.",
        action: "Try authenticating again at /auth/google with proper email scope permissions."
      });
    }

    // Search for existing integration by (auth_user_id + provider)
    const existingIntegration = await GoogleIntegration.findOne({ 
      auth_user_id, 
      provider: "google" 
    });

    if (existingIntegration) {
      // Update existing integration
      existingIntegration.access_token = tokens.access_token;
      existingIntegration.refresh_token = tokens.refresh_token || existingIntegration.refresh_token;
      existingIntegration.email = email;
      existingIntegration.status = "CONNECTED";
      existingIntegration.connected_at = new Date();
      existingIntegration.disconnected_at = null;
      await existingIntegration.save();
    } else {
      // Create new integration
      await GoogleIntegration.create({
        auth_user_id,
        provider: "google",
        email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        status: "CONNECTED",
        connected_at: new Date()
      });
    }

    // Redirect to frontend email sync page
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:8000";
    res.redirect(`${frontendUrl}/email-sync?connected=true&email=${encodeURIComponent(email)}`);
  } catch (error) {
    let userMessage = "Google OAuth authentication failed.";
    let suggestions = [];

    if (error.message?.includes("invalid_grant")) {
      userMessage = "Invalid or expired authorization code.";
      suggestions = ["The authorization code has already been used or expired", "Start the OAuth flow again at /auth/google"];
    } else if (error.message?.includes("redirect_uri_mismatch")) {
      userMessage = "OAuth redirect URI mismatch.";
      suggestions = ["Contact administrator to verify Google OAuth configuration", "Check that redirect URI matches Google Console settings"];
    } else if (!req.query.code) {
      userMessage = "Missing authorization code.";
      suggestions = ["This endpoint should be called by Google after user consent", "Do not call this endpoint directly"];
    } else if (error.code === 11000) {
      // Duplicate key error - should not happen with upsert, but handle anyway
      userMessage = "Integration already exists.";
      suggestions = ["Try disconnecting and reconnecting your Google account"];
    }

    res.status(500).json({ 
      message: userMessage,
      details: error.message,
      suggestions: suggestions.length > 0 ? suggestions : ["Try authenticating again at /auth/google", "Check server logs for more details"],
      timestamp: new Date().toISOString()
    });
  }
};
