import mongoose from "mongoose";
import { config } from "../config/index.js";

/**
 * Database Cleanup Script
 * Removes old User collection and clears all existing data for fresh start
 */

async function cleanupDatabase() {
    try {
        console.log("🔄 Starting database cleanup...");
        
        const uri = config.mongoUri || process.env.MONGO_URI;
        await mongoose.connect(uri);
        console.log("✅ Connected to MongoDB");

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        
        console.log("\n📋 Found collections:", collections.map(c => c.name).join(", "));

        // Drop old User collection if it exists
        if (collections.find(c => c.name === "users")) {
            await db.dropCollection("users");
            console.log("✅ Dropped old 'users' collection");
        } else {
            console.log("ℹ️  No 'users' collection found (already clean)");
        }

        // Optional: Clear other collections for fresh start
        const clearAll = process.argv.includes("--clear-all");
        
        if (clearAll) {
            console.log("\n⚠️  Clearing ALL data (--clear-all flag detected)...");
            
            const collectionsToKeep = []; // Add collection names you want to keep
            
            for (const collection of collections) {
                if (!collectionsToKeep.includes(collection.name) && collection.name !== "users") {
                    await db.dropCollection(collection.name);
                    console.log(`✅ Dropped '${collection.name}' collection`);
                }
            }
        }

        console.log("\n✨ Database cleanup completed successfully!");
        console.log("\n📊 Remaining collections:");
        const finalCollections = await db.listCollections().toArray();
        finalCollections.forEach(c => console.log(`   - ${c.name}`));

    } catch (error) {
        console.error("❌ Cleanup failed:", error.message);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log("\n👋 Disconnected from MongoDB");
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    cleanupDatabase()
        .then(() => {
            console.log("\n✅ Done!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Error:", error);
            process.exit(1);
        });
}

export default cleanupDatabase;
// src/utils/cleanupDatabase.js --clear-all