import mongoose from "mongoose";

/**
 * Document model - Single source of truth for invoice documents
 * Used by: Email Service, OCR Service, Chat Service
 * 
 * Tracks: file locations, OCR status, indexing status
 * Also handles deduplication (merged from ProcessedAttachment)
 */
const DocumentSchema = new mongoose.Schema(
  {
    // User & Source
    userId: { type: String, required: true, index: true },
    source: { 
      type: String, 
      enum: ["google_drive", "email", "manual_upload"], 
      default: "email" 
    },

    // Vendor Info
    vendorId: { type: String },
    vendorName: { type: String, required: true },
    vendorFolderId: { type: String },
    invoiceFolderId: { type: String },

    // File Info
    driveFileId: { type: String, required: true },
    fileName: { type: String, required: true },
    webViewLink: { type: String },
    webContentLink: { type: String },
    
    // Content hash for deduplication (sha256 of file content)
    sha256: { type: String, index: true },

    // Email tracking (if source is email)
    gmailMessageId: { type: String },
    gmailAttachmentId: { type: String },

    // OCR Status
    ocrStatus: { 
      type: String, 
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], 
      default: "PENDING",
      index: true
    },
    ocrError: { type: String },
    ocrCompletedAt: { type: Date },
    masterJsonPath: { type: String }, // Drive path: "vendor_folder_id/master.json"

    // Chat Indexing Status
    indexed: { type: Boolean, default: false, index: true },
    indexedAt: { type: Date },
    indexVersion: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Compound indexes for common queries
DocumentSchema.index({ userId: 1, ocrStatus: 1, indexed: 1 });
DocumentSchema.index({ userId: 1, driveFileId: 1 }, { unique: true });

// Deduplication index: prevent same content from same email being processed twice
DocumentSchema.index({ userId: 1, gmailMessageId: 1, sha256: 1 }, { unique: true, sparse: true });

// Update timestamp on save
DocumentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Document", DocumentSchema);
