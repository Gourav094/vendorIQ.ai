"""
Chat Service - Simplified REST API

Endpoints:
  POST /sync       - Index unindexed documents for a user
  GET  /query      - Ask questions (RAG)
  GET  /analytics  - Get spend analytics
  DELETE /reset    - Clear all indexed data
  GET  /health     - Health check
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from app.core.orchestrator import VendorKnowledgeOrchestrator
from app.db import get_unindexed_documents, mark_documents_indexed, reset_user_index, get_user_document_stats
import os
import json
import httpx

router = APIRouter(tags=["Chat Service"])

# Singleton orchestrator
_ORCHESTRATOR: VendorKnowledgeOrchestrator | None = None

def get_orchestrator():
    global _ORCHESTRATOR
    if _ORCHESTRATOR is None:
        _ORCHESTRATOR = VendorKnowledgeOrchestrator()
    return _ORCHESTRATOR


# ============================================================================
# SYNC - Index unindexed documents
# ============================================================================

class SyncRequest(BaseModel):
    user_id: str
    refresh_token: Optional[str] = None  # Needed to fetch master.json from Drive

class SyncResponse(BaseModel):
    success: bool
    documents_indexed: int
    message: str


@router.post("/sync", response_model=SyncResponse, summary="Sync & Index Documents")
async def sync_documents(request: SyncRequest):
    """
    Index documents that have completed OCR but not yet indexed.
    
    Flow:
    1. Query MongoDB for documents where ocr_status=COMPLETED and indexed=false
    2. For each document, call email-storage-service to get master.json
    3. Email-storage-service fetches from Google Drive
    4. Create embeddings and store in vector DB
    5. Mark documents as indexed in MongoDB
    """
    user_id = request.user_id
    
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    
    # Get unindexed documents from MongoDB
    unindexed = get_unindexed_documents(user_id)
    
    if not unindexed:
        return SyncResponse(
            success=True,
            documents_indexed=0,
            message="No documents pending indexing"
        )
    
    orchestrator = get_orchestrator()
    indexed_file_ids = []
    
    # Group documents by vendor for batch processing
    vendors_data = {}
    for doc in unindexed:
        vendor_name = doc.get("vendorName", "Unknown")
        vendor_folder_id = doc.get("vendorFolderId")  # ← Use vendorFolderId, not invoiceFolderId
        
        if not vendor_folder_id:
            print(f"Skipping document {doc.get('driveFileId')}: no vendorFolderId")
            continue
            
        if vendor_name not in vendors_data:
            vendors_data[vendor_name] = {
                "vendor_folder_id": vendor_folder_id,  # ← Changed key name
                "docs": []
            }
        vendors_data[vendor_name]["docs"].append(doc)
    
    print(f"Found {len(vendors_data)} vendors with {len(unindexed)} unindexed documents")
    
    # Process each vendor's documents
    for vendor_name, vendor_info in vendors_data.items():
        try:
            # Fetch master.json via email-storage-service
            master_records = await _fetch_master_via_email_service(
                user_id,
                vendor_info["vendor_folder_id"]  # ← Use vendorFolderId
            )
            
            if not master_records:
                print(f"No master.json found for vendor {vendor_name}")
                continue
            
            # Build dataset for this vendor
            dataset = orchestrator.data_loader.from_raw_vendor_arrays([
                {"vendorName": vendor_name, "records": master_records}
            ])
            
            # Index into vector DB
            result = orchestrator.process_direct_dataset(dataset, incremental=True)
            
            if result.get("success"):
                # Mark these documents as indexed
                file_ids = [doc.get("driveFileId") for doc in vendor_info["docs"]]
                indexed_file_ids.extend(file_ids)
                print(f"✓ Indexed {len(file_ids)} documents for vendor {vendor_name}")
                
        except Exception as e:
            print(f"Error indexing vendor {vendor_name}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    # Update MongoDB
    if indexed_file_ids:
        mark_documents_indexed(user_id, indexed_file_ids)
    
    return SyncResponse(
        success=True,
        documents_indexed=len(indexed_file_ids),
        message=f"Indexed {len(indexed_file_ids)} documents from {len(vendors_data)} vendors"
    )


async def _fetch_master_via_email_service(user_id: str, invoice_folder_id: str) -> list:
    """Fetch master.json via email-storage-service (which fetches from Google Drive)."""
    try:
        from app.config import EMAIL_STORAGE_SERVICE_URL
        
        # Call email-storage-service to get master.json
        # Email-storage-service handles Drive authentication and fetching
        url = f"{EMAIL_STORAGE_SERVICE_URL}/drive/users/{user_id}/vendors/{invoice_folder_id}/master"
        
        print(f"📞 Calling email-storage-service: {url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            
            print(f"📥 Response status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"❌ Failed to fetch master.json via email-storage-service: {response.status_code}")
                return []
            
            data = response.json()
            
            # Debug: Print the entire response structure
            print(f"📦 Response data keys: {list(data.keys())}")
            print(f"📦 Full response: {json.dumps(data, indent=2)}")
            
            # The API returns { userId, vendorFolderId, invoiceFolderId, records: [...] }
            if data.get("records") is not None:
                records = data["records"]
                print(f"✓ Fetched {len(records)} records from master.json")
                return records if isinstance(records, list) else []
            else:
                print(f"⚠️  No 'records' field in response")
                return []
            
    except Exception as e:
        print(f"💥 Error fetching master.json via email-storage-service: {e}")
        import traceback
        traceback.print_exc()
        return []


# ============================================================================
# QUERY - Ask questions using RAG
# ============================================================================

@router.get("/query", summary="Ask a Question")
async def query(
    q: str = Query(..., description="Your question"),
    vendor: Optional[str] = Query(None, description="Filter by vendor name"),
    user_id: Optional[str] = Query(None, description="User ID for access control"),
):
    """
    Ask a question about your invoice data.
    
    Examples:
    - "What is my total spend?"
    - "Show invoices from Acme Corp"
    - "Which vendor has the highest spend?"
    """
    orchestrator = get_orchestrator()
    
    # Optional: verify user has Google connection
    if user_id:
        connected = await _check_user_connection(user_id)
        if not connected:
            raise HTTPException(status_code=403, detail="Google account not connected")
    
    result = orchestrator.answer_query(question=q, vendor_name=vendor)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Query failed"))
    
    return {
        "answer": result.get("answer"),
        "sources": result.get("sources", []),
        "vendor": result.get("vendor_name"),
    }


async def _check_user_connection(user_id: str) -> bool:
    """Check if user has active Google connection."""
    try:
        base_url = os.getenv("EMAIL_STORAGE_SERVICE_URL", "http://localhost:4002/api/v1")
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/users/{user_id}/sync-status")
            if resp.status_code == 200:
                return resp.json().get("hasGoogleConnection", False)
    except Exception:
        pass
    return True  # Default to allowing if check fails


# ============================================================================
# ANALYTICS - Get spend analytics
# ============================================================================

@router.get("/analytics", summary="Get Analytics")
async def analytics(
    period: str = Query("year", description="Time period: month, quarter, year, all"),
    user_id: Optional[str] = Query(None, description="User ID (for future per-user scoping)"),
):
    """
    Get spend analytics and trends.
    
    Returns:
    - Total spend and invoice count
    - Top vendors by spend
    - Monthly/quarterly trends
    - AI-generated summary
    """
    orchestrator = get_orchestrator()
    result = orchestrator.get_analytics(period=period)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Analytics unavailable"))
    
    return result


# ============================================================================
# RESET - Clear all indexed data
# ============================================================================

@router.delete("/reset", summary="Reset Index")
async def reset(
    user_id: Optional[str] = Query(None, description="Reset for specific user (clears MongoDB indexed flags)"),
):
    """
    Clear the vector database and optionally reset MongoDB indexed flags.
    
    Use this when you want to re-index all documents from scratch.
    """
    orchestrator = get_orchestrator()
    result = orchestrator.reset_database()
    
    # Also reset MongoDB indexed flags if user_id provided
    docs_reset = 0
    if user_id:
        docs_reset = reset_user_index(user_id)
    
    return {
        "success": result.get("success"),
        "message": result.get("message"),
        "mongodb_docs_reset": docs_reset,
    }


# ============================================================================
# HEALTH - Health check
# ============================================================================

@router.get("/health", summary="Health Check")
async def health():
    """Check service health and vector DB status."""
    orchestrator = get_orchestrator()
    stats = orchestrator.get_system_stats()
    
    return {
        "status": "ok" if stats.get("success") else "error",
        "service": "chat-service",
        "vector_db": stats.get("stats", {}),
    }


# ============================================================================
# STATS - Get document indexing stats
# ============================================================================

@router.get("/stats", summary="Get Indexing Stats")
async def stats(user_id: str = Query(..., description="User ID")):
    """Get document indexing statistics for a user."""
    return get_user_document_stats(user_id)