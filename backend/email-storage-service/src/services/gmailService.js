import { google } from "googleapis";
import axios from "axios";
import crypto from "crypto";

import GoogleIntegration from "../models/GoogleIntegration.js";
import { saveToDrive } from "./driveService.js";
import Document from "../models/Document.js";
import { detectVendor } from "../utils/vendorDetection.js";
import logger from "../utils/logger.js";

const OCR_BASE_URL = process.env.OCR_SERVICE_BASE_URL || "http://localhost:4003";
const OCR_TOKEN = process.env.OCR_TRIGGER_TOKEN;

export const fetchAndProcessEmails = async (userId, fromDate, filters) => {
  // userId is auth_user_id from auth service
  const integration = await GoogleIntegration.findOne({ 
    auth_user_id: userId,
    provider: "google"
  });

  if (!integration || integration.status !== "CONNECTED" || !integration.refresh_token) {
    throw new Error("No Gmail connected");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_EMAIL_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: integration.refresh_token,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const { emails: emailList, onlyPdf = true, forceSync = false } = filters || {};

  // Determine fetch date: use fromDate if forceSync=true or lastSyncedAt is null
  const fetchFrom = (forceSync || !integration.lastSyncedAt)
    ? Math.floor(new Date(fromDate).getTime() / 1000)
    : Math.floor(new Date(integration.lastSyncedAt).getTime() / 1000);

  // Build Gmail search query
  let query = `after:${fetchFrom} has:attachment`;
  if (onlyPdf) {
    query += ` filename:pdf`;
  } else {
    query += ` (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)`;
  }

  // Support multiple email addresses with OR logic
  if (emailList && emailList.length > 0) {
    if (emailList.length === 1) {
      query += ` from:${emailList[0]}`;
    } else {
      const emailQuery = emailList.map(e => `from:${e}`).join(' OR ');
      query += ` (${emailQuery})`;
    }
  }

  logger.info(`Gmail search query: ${query}`, {
    userId,
    userEmail: integration.email,
    fetchFrom: new Date(fetchFrom * 1000).toISOString(),
    emailFilters: emailList || "ALL",
    emailCount: emailList ? emailList.length : 0,
    forceSync,
    lastSyncedAt: integration.lastSyncedAt
  });

  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
  });

  const emails = response.data.messages || [];
  logger.info(`Found ${emails.length} emails matching query`, { userId, query });

  if (emails.length === 0) {
    logger.warn("No emails found matching the search criteria", {
      userId,
      query,
      fetchFrom: new Date(fetchFrom * 1000).toISOString(),
      lastSyncedAt: integration.lastSyncedAt
    });
  }

  let uploadedCount = 0;
  const uploadedFiles = []; // Track uploaded files details
  const vendorsDetected = new Set();

  for (const msg of emails) {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
    });

    const headers = message.data.payload.headers;
    const fromHeader =
      headers.find((h) => h.name === "From")?.value || "Unknown";
    const subjectHeader =
      headers.find((h) => h.name === "Subject")?.value || "";
    const vendor = detectVendor(fromHeader, subjectHeader);
    vendorsDetected.add(vendor);

    const parts = message.data.payload.parts || [];
    for (const part of parts) {
      if (
        part.filename &&
        part.body.attachmentId
      ) {
        // Honor onlyPdf flag
        const lower = (part.filename || "").toLowerCase();
        const isAllowed = onlyPdf ? lower.endsWith(".pdf") : /\.(pdf|jpg|jpeg|png)$/.test(lower);
        if (!isAllowed) continue;

        // Fetch attachment content first to compute sha256 for deduplication
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: msg.id,
          id: part.body.attachmentId,
        });
        const fileBuffer = Buffer.from(attachment.data.data, "base64");

        // Compute sha256 hash for content-based deduplication
        let sha256 = null;
        try {
          const hash = crypto.createHash("sha256");
          hash.update(fileBuffer);
          sha256 = hash.digest("hex");
        } catch (_) { }

        // Duplicate prevention: check by userId + gmailMessageId + sha256
        const existing = await Document.findOne({
          userId: integration.auth_user_id,
          gmailMessageId: msg.id,
          sha256: sha256,
        });

        let uploadResult;
        if (existing) {
          logger.info("Skipping duplicate attachment", {
            userId,
            vendor,
            filename: part.filename,
            sha256,
            driveFileId: existing.driveFileId,
          });
          uploadResult = {
            fileId: existing.driveFileId,
            skipped: true,
            vendorFolderId: existing.vendorFolderId,
            vendorFolderName: existing.vendorName || vendor,
            vendorDisplayName: existing.vendorName || vendor,
            invoiceFolderId: existing.invoiceFolderId,
            webViewLink: existing.webViewLink,
            webContentLink: existing.webContentLink,
          };
        } else {
          try {
            uploadResult = await saveToDrive(integration, vendor, fileBuffer, part.filename);
          } catch (error) {
            logger.error("Failed to save attachment to Drive", {
              userId,
              vendor,
              filename: part.filename,
              error: error.message,
            });
            continue;
          }

          // Create Document record (single source of truth)
          try {
            await Document.create({
              userId: integration.auth_user_id,
              driveFileId: uploadResult.fileId,
              fileName: part.filename,
              vendorName: vendor,
              vendorFolderId: uploadResult.vendorFolderId,
              invoiceFolderId: uploadResult.invoiceFolderId,
              webViewLink: uploadResult.webViewLink,
              webContentLink: uploadResult.webContentLink,
              source: "email",
              gmailMessageId: msg.id,
              gmailAttachmentId: part.body.attachmentId,
              sha256,
              ocrStatus: "PENDING",
              indexed: false,
              indexVersion: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } catch (docErr) {
            // Handle duplicate key error (race condition)
            if (docErr.code === 11000) {
              logger.info("Document already exists (race condition), skipping", {
                userId,
                vendor,
                filename: part.filename,
              });
              uploadResult.skipped = true;
            } else {
              logger.error("Failed to create Document record", { error: docErr.message });
            }
          }
        }

        const uploadInfo = {
          vendor,
          filename: part.filename,
          path: `${vendor}/invoices/${part.filename}`,
          uploadedAt: new Date().toISOString(),
          fileId: uploadResult.fileId,
          vendorFolderId: uploadResult.vendorFolderId,
          vendorFolderName: uploadResult.vendorFolderName,
          vendorDisplayName: uploadResult.vendorDisplayName,
          invoiceFolderId: uploadResult.invoiceFolderId,
          skipped: uploadResult.skipped,
          webViewLink: uploadResult.webViewLink || null,
          webContentLink: uploadResult.webContentLink || null,
        };
        uploadedFiles.push(uploadInfo);

        if (!uploadResult.skipped) {
          uploadedCount++;
        }

        logger.info(`Uploaded file ${uploadedCount}`, { vendor, filename: part.filename });
      }
    }
  }

  // Update lastSyncedAt on the integration
  integration.lastSyncedAt = new Date();
  await integration.save();

  logger.info("Email fetch completed", {
    userId,
    totalEmailsProcessed: emails.length,
    filesUploaded: uploadedCount,
    vendorsDetected: Array.from(vendorsDetected)
  });

  // Return uploaded files info - user will explicitly trigger processing later
  return {
    totalProcessed: emails.length,
    filesUploaded: uploadedCount,
    uploadedFiles: uploadedFiles,
    vendorsDetected: Array.from(vendorsDetected),
    status: uploadedCount > 0 ? "ready_for_processing" : "no_documents_found",
    message: uploadedCount > 0
      ? `${uploadedCount} documents uploaded successfully. Ready for processing.`
      : "No new documents found matching the criteria."
  };
};
