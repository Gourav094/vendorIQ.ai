"""
MongoDB connection module for Chat service.
Connects to shared 'app_database' used by all services.
"""
import os
import logging
import certifi
from pymongo import MongoClient, ASCENDING
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_client = None
_db = None


def get_db():
    """Get MongoDB database instance (lazy initialization)."""
    global _client, _db
    if _db is None:
        mongo_uri = os.getenv("MONGO_URI")
        if not mongo_uri:
            raise RuntimeError("MONGO_URI environment variable is required")
        db_name = os.getenv("MONGO_DB_NAME", "app_database")
        _client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10000, tlsCAFile=certifi.where())
        _db = _client[db_name]
        logger.info(f"Chat service connected to MongoDB: {db_name}")
    return _db


def get_unindexed_documents(user_id: str) -> list:
    """
    Get documents that completed OCR but not yet indexed.
    Called during sync to find what needs indexing.
    """
    db = get_db()
    docs = db["documents"]
    return list(docs.find({
        "userId": user_id,
        "ocrStatus": "COMPLETED",
        "indexed": False
    }))


def mark_documents_indexed(user_id: str, drive_file_ids: list) -> int:
    """
    Mark multiple documents as indexed.
    Returns count of updated documents.
    """
    db = get_db()
    docs = db["documents"]
    
    now = datetime.now(timezone.utc)
    result = docs.update_many(
        {"userId": user_id, "driveFileId": {"$in": drive_file_ids}},
        {
            "$set": {
                "indexed": True,
                "indexedAt": now,
                "updatedAt": now,
            },
            "$inc": {"indexVersion": 1}
        }
    )
    return result.modified_count


def reset_user_index(user_id: str) -> int:
    """
    Reset indexed status for all user documents.
    Called when user wants to re-index everything.
    """
    db = get_db()
    docs = db["documents"]
    
    result = docs.update_many(
        {"userId": user_id, "ocrStatus": "COMPLETED"},
        {"$set": {"indexed": False, "updatedAt": datetime.now(timezone.utc)}}
    )
    return result.modified_count


def get_user_document_stats(user_id: str) -> dict:
    """Get document statistics for a user."""
    db = get_db()
    docs = db["documents"]
    
    total = docs.count_documents({"userId": user_id})
    ocr_completed = docs.count_documents({"userId": user_id, "ocrStatus": "COMPLETED"})
    indexed = docs.count_documents({"userId": user_id, "indexed": True})
    pending_index = docs.count_documents({"userId": user_id, "ocrStatus": "COMPLETED", "indexed": False})
    
    return {
        "total": total,
        "ocr_completed": ocr_completed,
        "indexed": indexed,
        "pending_index": pending_index,
    }
