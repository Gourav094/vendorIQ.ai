"""
Retry service for handling failed invoice processing operations.
Now uses MongoDB for status tracking instead of file-based storage.
"""
import logging
from typing import Dict, List, Optional

from app.db import get_db, update_ocr_status
from app.services.invoice_processor import process_vendor_invoices

logger = logging.getLogger(__name__)


async def get_processing_status(
    user_id: str,
    vendor_name: Optional[str] = None,
    status_filter: Optional[str] = None
) -> Dict:
    """
    Get processing status for invoices from MongoDB.
    Returns structure compatible with frontend InvoiceStatusResponse.
    """
    try:
        db = get_db()
        docs = db["documents"]
        
        query = {"userId": user_id}
        if vendor_name:
            query["vendorName"] = vendor_name
        if status_filter:
            query["ocrStatus"] = status_filter
        
        documents = list(docs.find(query))
        
        # Group by status for summary - use ocrStatus as the key
        by_status = {}
        for doc in documents:
            status = doc.get("ocrStatus", "PENDING")
            if status not in by_status:
                by_status[status] = []
            
            # Build errors array from ocrError if present
            errors = []
            if doc.get("ocrError"):
                errors.append({
                    "phase": "ocr",
                    "message": doc.get("ocrError"),
                    "code": "OCR_ERROR",
                    "retryable": True,
                    "timestamp": doc.get("updatedAt").isoformat() if doc.get("updatedAt") else None
                })
            
            by_status[status].append({
                "user_id": user_id,
                "vendor_name": doc.get("vendorName"),
                "drive_file_id": doc.get("driveFileId"),
                "file_name": doc.get("fileName"),
                "status": status,  # Frontend expects 'status' not 'ocr_status'
                "ocr_attempt_count": 1 if status in ["COMPLETED", "FAILED"] else 0,
                "chat_attempt_count": 1 if doc.get("indexed") else 0,
                "errors": errors,
                "created_at": doc.get("createdAt").isoformat() if doc.get("createdAt") else None,
                "updated_at": doc.get("updatedAt").isoformat() if doc.get("updatedAt") else None,
                "ocr_completed_at": doc.get("ocrCompletedAt").isoformat() if doc.get("ocrCompletedAt") else None,
                "web_view_link": doc.get("webViewLink"),
                "vendor_folder_id": doc.get("vendorFolderId"),
                "invoice_folder_id": doc.get("invoiceFolderId"),
            })
        
        return {
            "success": True,
            "user_id": user_id,
            "vendor_name": vendor_name,
            "total_count": len(documents),
            "by_status": by_status,
            "summary": {status: len(items) for status, items in by_status.items()}
        }
    except Exception as e:
        logger.error(f"Failed to get processing status: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def retry_failed_invoices(
    user_id: str,
    refresh_token: str,
    vendor_name: Optional[str] = None,
    drive_file_ids: Optional[List[str]] = None,
    max_retries: int = 3
) -> Dict:
    """
    Retry failed invoice processing operations.
    """
    try:
        db = get_db()
        docs = db["documents"]
        
        # Query failed documents
        query = {"userId": user_id, "ocrStatus": "FAILED"}
        if vendor_name:
            query["vendorName"] = vendor_name
        if drive_file_ids:
            query["driveFileId"] = {"$in": drive_file_ids}
        
        failed_docs = list(docs.find(query))
        
        if not failed_docs:
            return {
                "success": True,
                "message": "No failed invoices found to retry",
                "user_id": user_id,
                "vendor_name": vendor_name,
                "retried": 0,
                "results": []
            }
        
        # Group by vendor for batch processing
        by_vendor = {}
        for doc in failed_docs:
            vendor = doc.get("vendorName", "Unknown")
            if vendor not in by_vendor:
                by_vendor[vendor] = {
                    "vendor_folder_id": doc.get("vendorFolderId"),
                    "invoice_folder_id": doc.get("invoiceFolderId"),
                    "invoices": []
                }
            
            by_vendor[vendor]["invoices"].append({
                "fileId": doc.get("driveFileId"),
                "fileName": doc.get("fileName"),
                "mimeType": "application/pdf",
                "webViewLink": doc.get("webViewLink")
            })
        
        # Retry each vendor batch
        results = []
        total_retried = 0
        
        for vendor, batch_data in by_vendor.items():
            try:
                logger.info(f"Retrying {len(batch_data['invoices'])} invoices for vendor {vendor}")
                
                # Reset status to PENDING before retry
                for inv in batch_data["invoices"]:
                    update_ocr_status(user_id, inv["fileId"], "PENDING")
                
                summary = await process_vendor_invoices(
                    user_id=user_id,
                    vendor_name=vendor,
                    invoice_folder_id=batch_data["invoice_folder_id"],
                    invoices=batch_data["invoices"],
                    vendor_folder_id=batch_data["vendor_folder_id"],
                    refresh_token=refresh_token
                )
                
                total_retried += len(batch_data["invoices"])
                results.append({
                    "vendor": vendor,
                    "status": "completed",
                    "processed": len(summary.get("processed", [])),
                    "skipped": len(summary.get("skipped", []))
                })
                
                logger.info(f"Retry completed for vendor {vendor}")
                
            except Exception as e:
                logger.error(f"Retry failed for vendor {vendor}: {e}", exc_info=True)
                results.append({
                    "vendor": vendor,
                    "status": "failed",
                    "error": str(e)
                })
        
        return {
            "success": True,
            "message": f"Retried {total_retried} invoices across {len(by_vendor)} vendors",
            "user_id": user_id,
            "vendor_name": vendor_name,
            "total_failed": len(failed_docs),
            "retried": total_retried,
            "results": results
        }
        
    except Exception as e:
        logger.error(f"Failed to retry invoices: {e}", exc_info=True)
        return {"success": False, "error": str(e), "user_id": user_id}


def get_status_summary(user_id: str, vendor_name: Optional[str] = None) -> Dict:
    """Get a quick summary of processing status (counts by status).
    Returns structure compatible with frontend InvoiceStatusSummaryResponse.
    """
    try:
        db = get_db()
        docs = db["documents"]
        
        query = {"userId": user_id}
        if vendor_name:
            query["vendorName"] = vendor_name
        
        # Count by ocrStatus
        pipeline = [
            {"$match": query},
            {"$group": {"_id": "$ocrStatus", "count": {"$sum": 1}}}
        ]
        
        status_counts = list(docs.aggregate(pipeline))
        # Frontend expects 'by_status' not 'by_ocr_status'
        by_status = {item["_id"] or "PENDING": item["count"] for item in status_counts}
        
        total = docs.count_documents(query)
        failed_count = by_status.get("FAILED", 0)
        
        return {
            "success": True,
            "user_id": user_id,
            "vendor_name": vendor_name,
            "total": total,
            "by_status": by_status,  # Frontend expects 'by_status'
            "retryable": failed_count  # Frontend expects 'retryable'
        }
    except Exception as e:
        logger.error(f"Failed to get status summary: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def clear_user_documents(user_id: str) -> Dict:
    """Delete all document records for a user from MongoDB."""
    try:
        db = get_db()
        docs = db["documents"]
        
        result = docs.delete_many({"userId": user_id})
        
        return {
            "success": True,
            "deleted_count": result.deleted_count
        }
    except Exception as e:
        logger.error(f"Failed to clear user documents: {e}")
        return {"success": False, "error": str(e)}
