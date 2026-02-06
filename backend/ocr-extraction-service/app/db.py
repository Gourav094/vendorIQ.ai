"""
MongoDB connection module for OCR service.
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
        _init_indexes()
        logger.info(f"Connected to MongoDB: {db_name}")
    return _db


def _init_indexes():
    """Create indexes for documents collection."""
    global _db
    docs = _db["documents"]
    docs.create_index([("userId", ASCENDING), ("driveFileId", ASCENDING)], unique=True)
    docs.create_index([("userId", ASCENDING), ("ocrStatus", ASCENDING), ("indexed", ASCENDING)])


def upsert_document(
    user_id: str,
    drive_file_id: str,
    file_name: str,
    vendor_name: str,
    vendor_folder_id: str = None,
    invoice_folder_id: str = None,
    web_view_link: str = None,
    web_content_link: str = None,
    source: str = "email",
    vendor_id: str = None,
    gmail_message_id: str = None,
    gmail_attachment_id: str = None,
) -> dict:
    """
    Create or update a document record.
    Called by email service when uploading attachment to Drive.
    """
    db = get_db()
    docs = db["documents"]
    
    now = datetime.now(timezone.utc)
    
    result = docs.find_one_and_update(
        {"userId": user_id, "driveFileId": drive_file_id},
        {
            "$set": {
                "fileName": file_name,
                "vendorName": vendor_name,
                "vendorFolderId": vendor_folder_id,
                "invoiceFolderId": invoice_folder_id,
                "webViewLink": web_view_link,
                "webContentLink": web_content_link,
                "source": source,
                "vendorId": vendor_id,
                "gmailMessageId": gmail_message_id,
                "gmailAttachmentId": gmail_attachment_id,
                "updatedAt": now,
            },
            "$setOnInsert": {
                "userId": user_id,
                "driveFileId": drive_file_id,
                "ocrStatus": "PENDING",
                "indexed": False,
                "indexVersion": 0,
                "createdAt": now,
            }
        },
        upsert=True,
        return_document=True
    )
    return result


def update_ocr_status(
    user_id: str,
    drive_file_id: str,
    ocr_status: str,
    master_json_path: str = None,
    ocr_error: str = None,
) -> bool:
    """
    Update OCR processing status for a document.
    Called by OCR service after processing.
    """
    db = get_db()
    docs = db["documents"]
    
    now = datetime.now(timezone.utc)
    update_fields = {
        "ocrStatus": ocr_status,
        "updatedAt": now,
    }
    
    if ocr_status == "COMPLETED":
        update_fields["ocrCompletedAt"] = now
        update_fields["indexed"] = False  # Reset indexed flag for new OCR
        if master_json_path:
            update_fields["masterJsonPath"] = master_json_path
    
    if ocr_error:
        update_fields["ocrError"] = ocr_error
    
    result = docs.update_one(
        {"userId": user_id, "driveFileId": drive_file_id},
        {"$set": update_fields}
    )
    return result.modified_count > 0


def get_pending_ocr_documents(user_id: str) -> list:
    """Get documents pending OCR processing for a user."""
    db = get_db()
    docs = db["documents"]
    return list(docs.find({"userId": user_id, "ocrStatus": "PENDING"}))


def get_unindexed_documents(user_id: str) -> list:
    """
    Get documents that completed OCR but not yet indexed.
    Called by chat service during sync.
    """
    db = get_db()
    docs = db["documents"]
    return list(docs.find({
        "userId": user_id,
        "ocrStatus": "COMPLETED",
        "indexed": False
    }))


def mark_document_indexed(user_id: str, drive_file_id: str) -> bool:
    """
    Mark a document as indexed in vector DB.
    Called by chat service after successful indexing.
    """
    db = get_db()
    docs = db["documents"]
    
    now = datetime.now(timezone.utc)
    result = docs.update_one(
        {"userId": user_id, "driveFileId": drive_file_id},
        {
            "$set": {
                "indexed": True,
                "indexedAt": now,
                "updatedAt": now,
            },
            "$inc": {"indexVersion": 1}
        }
    )
    return result.modified_count > 0


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


def get_user_documents(user_id: str, ocr_status: str = None, indexed: bool = None) -> list:
    """Get documents for a user with optional filters."""
    db = get_db()
    docs = db["documents"]
    
    query = {"userId": user_id}
    if ocr_status:
        query["ocrStatus"] = ocr_status
    if indexed is not None:
        query["indexed"] = indexed
    
    return list(docs.find(query))


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
