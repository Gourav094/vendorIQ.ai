import os
from typing import Any, Dict, List, Optional
import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.services.invoice_processor import process_all_invoices, process_vendor_invoices

router = APIRouter(prefix="/api/v1/processing", tags=["Processing"], include_in_schema=False)

logger = logging.getLogger(__name__)


class InvoicePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    fileId: str = Field(..., description="Drive file ID")
    fileName: str = Field(..., description="Original filename")
    mimeType: Optional[str] = Field("application/pdf", description="File MIME type")


class VendorProcessingRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    userId: str = Field(..., description="Internal user identifier")
    vendorName: str = Field(..., description="Display name for vendor")
    vendorFolderId: Optional[str] = Field(None, description="Drive folder ID for the vendor root")
    invoiceFolderId: Optional[str] = Field(None, description="Drive folder ID for the invoices subfolder")
    refreshToken: str = Field(..., description="Google OAuth refresh token for Drive access")
    invoices: List[InvoicePayload] = Field(default_factory=list)


class FullSyncRequest(BaseModel):
    userId: str = Field(..., description="Internal user identifier")
    refreshToken: str = Field(..., description="Google OAuth refresh token for Drive access")


@router.post("/vendor", status_code=status.HTTP_200_OK)
async def process_vendor(payload: VendorProcessingRequest) -> Dict[str, Any]:
    """Process invoices for a specific vendor."""
    if not payload.invoices:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No invoices provided")

    if not payload.refreshToken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing refresh token")

    logger.info(f"Processing vendor: {payload.vendorName} (user: {payload.userId}, invoices: {len(payload.invoices)})")

    summary = await process_vendor_invoices(
        user_id=payload.userId,
        vendor_name=payload.vendorName,
        invoice_folder_id=payload.invoiceFolderId,
        invoices=[invoice.model_dump() for invoice in payload.invoices],
        vendor_folder_id=payload.vendorFolderId,
        refresh_token=payload.refreshToken,
    )
    
    return {"status": "processed", "summary": summary}


@router.post("/vendor/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_vendor_invoices(payload: FullSyncRequest) -> Dict[str, Any]:
    """Process all invoices for all vendors of a user."""
    if not payload.refreshToken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing refresh token")

    logger.info(f"Starting full vendor sync for user: {payload.userId}")

    results = await process_all_invoices(user_id=payload.userId, refresh_token=payload.refreshToken)
    
    return {"status": "processing", "results": results}
