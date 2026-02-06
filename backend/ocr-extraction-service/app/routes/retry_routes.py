"""
Retry routes for OCR extraction service.
Provides endpoints for querying processing status and retrying failed operations.
"""
from fastapi import APIRouter, HTTPException, Query, Header
from pydantic import BaseModel, Field
from typing import Optional, List
import os

from app.services.retry_service import (
    get_processing_status,
    retry_failed_invoices,
    get_status_summary,
    clear_user_statuses
)

router = APIRouter(prefix="/api/v1/processing", tags=["Processing & Retry"])

# Optional token-based authentication (same as processing_routes)
OCR_TRIGGER_TOKEN = os.getenv("OCR_TRIGGER_TOKEN")


def _validate_token(trigger_header: Optional[str]) -> None:
    """Validate trigger token if configured"""
    if OCR_TRIGGER_TOKEN and trigger_header != OCR_TRIGGER_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid trigger token")


class RetryRequest(BaseModel):
    """Request model for retrying failed invoices"""
    userId: str = Field(..., description="User identifier")
    vendorName: Optional[str] = Field(None, description="Specific vendor to retry (if None, retry all failed)")
    driveFileIds: Optional[List[str]] = Field(None, description="Specific file IDs to retry (if None, retry all failed for vendor)")
    refreshToken: str = Field(..., description="Google OAuth refresh token for Drive access")
    maxOcrRetries: int = Field(3, description="Maximum OCR retry attempts")
    maxChatRetries: int = Field(3, description="Maximum chat indexing retry attempts")


@router.get("/status", summary="Get Invoice Processing Status")
async def get_status_endpoint(
    userId: str = Query(..., description="User identifier"),
    vendorName: Optional[str] = Query(None, description="Filter by vendor name"),
    status: Optional[str] = Query(None, description="Filter by status (e.g., OCR_FAILED, CHAT_FAILED)"),
):
    """
    Get processing status for invoices.
    
    Returns detailed status information including:
    - Current processing state
    - Error details
    - Retry attempts
    - Timestamps
    """
    # No auth required for status checking - it's read-only and user-specific
    
    result = await get_processing_status(
        user_id=userId,
        vendor_name=vendorName,
        status_filter=status
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to get status"))
    
    return result


@router.get("/status/summary", summary="Get Processing Status Summary")
async def get_summary_endpoint(
    userId: str = Query(..., description="User identifier"),
    vendorName: Optional[str] = Query(None, description="Filter by vendor name"),
):
    """
    Get a quick summary of processing status (counts by status).
    
    Useful for dashboard widgets showing:
    - Total invoices processed
    - Failed count
    - Retryable count
    """
    # No auth required for summary - it's read-only and user-specific
    
    result = get_status_summary(user_id=userId, vendor_name=vendorName)
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to get summary"))
    
    return result


@router.post("/retry", summary="Retry Failed Invoice Processing")
async def retry_endpoint(
    request: RetryRequest,
    trigger_header: Optional[str] = Header(None, alias="x-ocr-token"),
):
    """
    Retry failed OCR extraction and/or chat indexing operations.
    
    This endpoint will:
    1. Find all failed invoices for the user (optionally filtered by vendor/file IDs)
    2. Check retry limits
    3. Re-process failed invoices through the OCR → Chat pipeline
    4. Return detailed results
    
    Retries are intelligent:
    - Only retries operations marked as retryable
    - Respects max retry limits
    - Handles partial failures gracefully
    """
    _validate_token(trigger_header)
    
    result = await retry_failed_invoices(
        user_id=request.userId,
        refresh_token=request.refreshToken,
        vendor_name=request.vendorName,
        drive_file_ids=request.driveFileIds,
        max_ocr_retries=request.maxOcrRetries,
        max_chat_retries=request.maxChatRetries
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Retry operation failed"))
    
    return result


@router.delete("/status", summary="Clear Invoice Processing Status")
async def clear_status_endpoint(
    userId: str = Query(..., description="User identifier"),
):
    """Clear all processing status records for a user."""
    result = clear_user_statuses(user_id=userId)
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to clear status"))
    
    return result
