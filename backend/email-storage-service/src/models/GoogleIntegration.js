import mongoose from "mongoose";

const googleIntegrationSchema = new mongoose.Schema(
  {
    auth_user_id: { 
      type: String, 
      required: true,
      index: true 
    },
    provider: { 
      type: String, 
      default: "google",
      required: true 
    },
    email: { 
      type: String, 
      required: true 
    },
    access_token: { type: String },
    refresh_token: { type: String },
    status: { 
      type: String, 
      enum: ["CONNECTED", "DISCONNECTED"],
      default: "CONNECTED" 
    },
    lastSyncedAt: { type: Date, default: null },
    connected_at: { type: Date, default: Date.now },
    disconnected_at: { type: Date, default: null }
  },
  { timestamps: true }
);

// Unique constraint: one Google integration per auth user
googleIntegrationSchema.index({ auth_user_id: 1, provider: 1 }, { unique: true });

export default mongoose.model("GoogleIntegration", googleIntegrationSchema);
