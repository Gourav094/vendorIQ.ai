"""
Retry service for handling failed invoice processing operations.
Provides endpoints and logic to retry failed OCR extractions and chat indexing.
"""
import logging
import os
from typing import Dict, List, Optional

from app.models.invoice_status import ProcessingStatusStore
from app.services.invoice_processor import process_vendor_invoices

logger = logging.getLogger(__name__)

# Initialize status store (same as invoice_processor)
_status_store = ProcessingStatusStore(storage_dir=os.getenv("PROCESSING_STATUS_DIR", "processing_status"))


async def get_processing_status(
    user_id: str,
    vendor_name: Optional[str] = None,
    status_filter: Optional[str] = None
) -> Dict:
    """
    Get processing status for invoices.
    
    Args:
        user_id: User identifier
        vendor_name: Optional vendor name filter
        status_filter: Optional status filter (e.g., "FAILED", "OCR_FAILED", "CHAT_FAILED")
    
    Returns:
        Dictionary with status information
    """
    try:
        import json
        
        if vendor_name:
            # Get status for specific vendor
            statuses = _status_store.load_vendor_statuses(user_id, vendor_name)
        else:
            # Get ALL invoices across vendors (not just failed)
            statuses = []
            if os.path.exists(_status_store.storage_dir):
                for filename in os.listdir(_status_store.storage_dir):
                    if filename.startswith(user_id) and filename.endswith('_status.json'):
                        file_path = os.path.join(_status_store.storage_dir, filename)
                        try:
                            with open(file_path, 'r') as f:
                                data = json.load(f)
                                from app.models.invoice_status import InvoiceProcessingStatus
                                statuses.extend([InvoiceProcessingStatus(**item) for item in data])
                        except Exception:
                            continue
        
        # Apply status filter if provided
        if status_filter:
            statuses = [s for s in statuses if s.status == status_filter or status_filter in s.status]
        
        # Group by status for summary
        by_status = {}
        for status in statuses:
            if status.status not in by_status:
                by_status[status.status] = []
            by_status[status.status].append({
                "drive_file_id": status.drive_file_id,
                "file_name": status.file_name,
                "vendor_name": status.vendor_name,
                "status": status.status,
                "ocr_attempt_count": status.ocr_attempt_count,
                "chat_attempt_count": status.chat_attempt_count,
                "errors": [e.dict() for e in status.errors] if status.errors else [],
                "created_at": status.created_at.isoformat(),
                "updated_at": status.updated_at.isoformat(),
                "ocr_completed_at": status.ocr_completed_at.isoformat() if status.ocr_completed_at else None,
                "web_view_link": status.web_view_link
            })
        
        return {
            "success": True,
            "user_id": user_id,
            "vendor_name": vendor_name,
            "total_count": len(statuses),
            "by_status": by_status,
            "summary": {
                status: len(items) for status, items in by_status.items()
            }
        }
    except Exception as e:
        logger.error(f"Failed to get processing status: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


async def retry_failed_invoices(
    user_id: str,
    refresh_token: str,
    vendor_name: Optional[str] = None,
    drive_file_ids: Optional[List[str]] = None,
    max_ocr_retries: int = 3,
    max_chat_retries: int = 3
) -> Dict:
    """
    Retry failed invoice processing operations.
    
    Args:
        user_id: User identifier
        refresh_token: Google OAuth refresh token for Drive access
        vendor_name: Optional vendor name to retry (if None, retry all failed)
        drive_file_ids: Optional list of specific file IDs to retry
        max_ocr_retries: Maximum OCR retry attempts
        max_chat_retries: Maximum chat indexing retry attempts
    
    Returns:
        Dictionary with retry results
    """
    try:
        # Get failed invoices to retry
        if vendor_name:
            failed_statuses = _status_store.load_vendor_statuses(user_id, vendor_name)
            failed_statuses = [s for s in failed_statuses if s.status in ["OCR_FAILED", "CHAT_FAILED"] and s.is_retryable()]
        else:
            failed_statuses = _status_store.get_failed_invoices(user_id, vendor_name)
        
        # Filter by specific file IDs if provided
        if drive_file_ids:
            failed_statuses = [s for s in failed_statuses if s.drive_file_id in drive_file_ids]
        
        # Filter by retry limits
        retryable = []
        max_retries_reached = []
        
        for status in failed_statuses:
            if status.status == "OCR_FAILED" and status.ocr_attempt_count >= max_ocr_retries:
                max_retries_reached.append(status)
            elif status.status == "CHAT_FAILED" and status.chat_attempt_count >= max_chat_retries:
                max_retries_reached.append(status)
            else:
                retryable.append(status)
        
        if not retryable:
            return {
                "success": True,
                "message": "No retryable invoices found",
                "user_id": user_id,
                "vendor_name": vendor_name,
                "total_failed": len(failed_statuses),
                "max_retries_reached": len(max_retries_reached),
                "retried": 0,
                "results": []
            }
        
        # Group by vendor for batch processing
        by_vendor = {}
        for status in retryable:
            vendor = status.vendor_name
            if vendor not in by_vendor:
                by_vendor[vendor] = {
                    "vendor_folder_id": status.vendor_folder_id,
                    "invoice_folder_id": status.invoice_folder_id,
                    "invoices": []
                }
            
            by_vendor[vendor]["invoices"].append({
                "fileId": status.drive_file_id,
                "fileName": status.file_name,
                "mimeType": "application/pdf",
                "webViewLink": status.web_view_link
            })
        
        # Retry each vendor batch
        results = []
        for vendor, batch_data in by_vendor.items():
            try:
                logger.info(f"Retrying {len(batch_data['invoices'])} invoices for vendor {vendor}")
                
                summary = await process_vendor_invoices(
                    user_id=user_id,
                    vendor_name=vendor,
                    invoice_folder_id=batch_data["invoice_folder_id"],
                    invoices=batch_data["invoices"],
                    vendor_folder_id=batch_data["vendor_folder_id"],
                    refresh_token=refresh_token
                )
                
                results.append({
                    "vendor": vendor,
                    "status": "completed",
                    "summary": summary
                })
                
                logger.info(f"Retry completed for vendor {vendor}: {len(summary.get('processed', []))} processed, {len(summary.get('skipped', []))} skipped")
                
            except Exception as e:
                logger.error(f"Retry failed for vendor {vendor}: {e}", exc_info=True)
                results.append({
                    "vendor": vendor,
                    "status": "failed",
                    "error": str(e)
                })
        
        return {
            "success": True,
            "message": f"Retried {len(retryable)} invoices across {len(by_vendor)} vendors",
            "user_id": user_id,
            "vendor_name": vendor_name,
            "total_failed": len(failed_statuses),
            "retried": len(retryable),
            "max_retries_reached": len(max_retries_reached),
            "results": results
        }
        
    except Exception as e:
        logger.error(f"Failed to retry invoices: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "user_id": user_id,
            "vendor_name": vendor_name
        }


def get_status_summary(user_id: str, vendor_name: Optional[str] = None) -> Dict:
    """Get a quick summary of processing status (counts by status)."""
    try:
        if vendor_name:
            statuses = _status_store.load_vendor_statuses(user_id, vendor_name)
        else:
            import json
            statuses = []
            
            if os.path.exists(_status_store.storage_dir):
                for filename in os.listdir(_status_store.storage_dir):
                    if filename.startswith(user_id) and filename.endswith('_status.json'):
                        file_path = os.path.join(_status_store.storage_dir, filename)
                        try:
                            with open(file_path, 'r') as f:
                                data = json.load(f)
                                from app.models.invoice_status import InvoiceProcessingStatus
                                statuses.extend([InvoiceProcessingStatus(**item) for item in data])
                        except Exception:
                            continue
        
        counts = {}
        retryable_count = 0
        
        for status in statuses:
            counts[status.status] = counts.get(status.status, 0) + 1
            if status.is_retryable():
                retryable_count += 1
        
        return {
            "success": True,
            "user_id": user_id,
            "vendor_name": vendor_name,
            "total": len(statuses),
            "by_status": counts,
            "retryable": retryable_count
        }
    except Exception as e:
        logger.error(f"Failed to get status summary: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def clear_user_statuses(user_id: str) -> Dict:
    """Delete all status files for a user."""
    try:
        deleted = 0
        if os.path.exists(_status_store.storage_dir):
            for f in os.listdir(_status_store.storage_dir):
                if f.startswith(user_id) and f.endswith('_status.json'):
                    os.remove(os.path.join(_status_store.storage_dir, f))
                    deleted += 1
        return {"success": True, "deleted_count": deleted}
    except Exception as e:
        logger.error(f"Failed to clear user statuses: {e}")
        return {"success": False, "error": str(e)}
