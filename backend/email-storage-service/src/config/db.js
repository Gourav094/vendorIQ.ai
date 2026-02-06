import mongoose from "mongoose";
import logger from "../utils/logger.js";

export const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI environment variable is required");
    }
    await mongoose.connect(mongoUri);
    logger.info("MongoDB Connected Successfully");
  } catch (error) {
    logger.error(error, { msg: "MongoDB Connection Error" });
    process.exit(1);
  }
};
