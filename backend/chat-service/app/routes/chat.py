"""
Chat Service - Simplified REST API with User Isolation

Endpoints:
  POST /sync       - Index OCR-processed documents for a user
  POST /query      - Ask questions with RAG (user isolated)
  GET  /analytics  - Get spend analytics per user
  DELETE /user/{user_id}/data - Delete all user data
  GET  /stats      - Get document indexing stats
  GET  /health     - Health check
"""
from fastapi import APIRouter, HTTPException, Query, Path
from pydantic import BaseModel
from typing import Optional
from app.core.orchestrator import VendorKnowledgeOrchestrator
from app.db import get_unindexed_documents, mark_documents_indexed, get_user_document_stats
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
    userId: str
    refreshToken: Optional[str] = None

class SyncResponse(BaseModel):
    success: bool
    documentsIndexed: int
    message: str


@router.post("/sync", response_model=SyncResponse, summary="Sync & Index Documents")
async def sync_documents(request: SyncRequest):
    """
    Index documents that completed OCR but not yet indexed.
    
    Flow:
    1. Query MongoDB for documents where ocr_status=COMPLETED and indexed=false
    2. For each vendor, fetch master.json from email-storage-service
    3. Create embeddings with user_id in metadata
    4. Store in vector DB (user isolated)
    5. Mark documents as indexed in MongoDB
    """
    user_id = request.userId
    
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")
    
    # Get unindexed documents from MongoDB
    unindexed = get_unindexed_documents(user_id)
    
    if not unindexed:
        return SyncResponse(
            success=True,
            documentsIndexed=0,
            message="No documents pending indexing"
        )
    
    orchestrator = get_orchestrator()
    indexed_file_ids = []
    
    # Group documents by vendor for batch processing
    vendors_data = {}
    for doc in unindexed:
        vendor_name = doc.get("vendorName", "Unknown")
        vendor_folder_id = doc.get("vendorFolderId")
        
        if not vendor_folder_id:
            print(f"Skipping document {doc.get('driveFileId')}: no vendorFolderId")
            continue
            
        if vendor_name not in vendors_data:
            vendors_data[vendor_name] = {
                "vendor_folder_id": vendor_folder_id,
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
                vendor_info["vendor_folder_id"]
            )
            
            if not master_records:
                print(f"No master.json found for vendor {vendor_name}")
                continue
            
            # Build dataset for this vendor
            dataset = orchestrator.data_loader.from_raw_vendor_arrays([
                {"vendorName": vendor_name, "records": master_records}
            ])
            
            # Index into vector DB with user_id 
            result = orchestrator.process_direct_dataset(dataset, user_id, incremental=False)
            
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
        documentsIndexed=len(indexed_file_ids),
        message=f"Indexed {len(indexed_file_ids)} documents from {len(vendors_data)} vendors"
    )


async def _fetch_master_via_email_service(user_id: str, vendor_folder_id: str) -> list:
    """Fetch master.json via email-storage-service."""
    try:
        from app.config import EMAIL_STORAGE_SERVICE_URL
        
        url = f"{EMAIL_STORAGE_SERVICE_URL}/drive/users/{user_id}/vendors/{vendor_folder_id}/master"
        
        print(f"📞 Calling email-storage-service: {url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            
            if response.status_code != 200:
                print(f"❌ Failed to fetch master.json: {response.status_code}")
                return []
            
            data = response.json()
            records = data.get("records", [])
            print(f"✓ Fetched {len(records)} records from master.json")
            return records if isinstance(records, list) else []
            
    except Exception as e:
        print(f"💥 Error fetching master.json: {e}")
        import traceback
        traceback.print_exc()
        return []


# ============================================================================
# QUERY - Ask questions using RAG
# ============================================================================

class QueryRequest(BaseModel):
    userId: str
    question: str
    vendorName: Optional[str] = None

class QueryResponse(BaseModel):
    success: bool
    answer: str
    sources: list
    vendorName: Optional[str] = None
    message: Optional[str] = None


@router.post("/query", response_model=QueryResponse, summary="Ask a Question")
async def query(request: QueryRequest):
    """
    Ask a question about invoice data using RAG.
    
    - If vendorName is provided, search only that vendor's data
    - Otherwise, search across all vendors for this user
    - All queries are user-isolated (no cross-user data access)
    
    Examples:
    - "What is my total spend?"
    - "Show invoices from Acme Corp" (with vendorName="Acme Corp")
    - "Which vendor has the highest spend?"
    """
    if not request.userId:
        raise HTTPException(status_code=400, detail="userId is required")
    
    if not request.question:
        raise HTTPException(status_code=400, detail="question is required")
    
    orchestrator = get_orchestrator()
    
    result = orchestrator.answer_query(
        question=request.question,
        user_id=request.userId,
        vendor_name=request.vendorName
    )
    
    # Return the result even if no documents found - let frontend show the helpful message
    return QueryResponse(
        success=result.get("success", False),
        answer=result.get("answer", ""),
        sources=result.get("sources", []),
        vendorName=result.get("vendor_name"),
        message=result.get("message")
    )


# ============================================================================
# ANALYTICS - Get spend analytics
# ============================================================================

@router.get("/analytics", summary="Get Analytics")
async def analytics(
    userId: str = Query(..., description="User ID"),
    period: str = Query("year", description="Time period: month, quarter, year, all"),
):
    """
    Get spend analytics and trends for a user.
    
    Returns:
    - Total spend and invoice count
    - Top vendors by spend
    - Monthly/quarterly trends
    - AI-generated summary
    
    All data is user-isolated.
    """
    if not userId:
        raise HTTPException(status_code=400, detail="userId is required")
    
    orchestrator = get_orchestrator()
    result = orchestrator.get_analytics(user_id=userId, period=period)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Analytics unavailable"))
    
    return result


# ============================================================================
# DELETE USER DATA - Clear all user data from vector DB
# ============================================================================

@router.delete("/user/{user_id}/data", summary="Delete User Data")
async def delete_user_data(
    user_id: str = Path(..., description="User ID to delete data for"),
):
    """
    Delete all indexed data for a specific user from the vector database.
    
    This is useful when:
    - User wants to re-index all documents from scratch
    - User wants to clear all their data
    
    Note: This does NOT affect MongoDB document records or Google Drive files.
    """
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    
    orchestrator = get_orchestrator()
    result = orchestrator.delete_user_data(user_id)
    
    # Also reset MongoDB indexed flags
    from app.db import reset_user_index
    docs_reset = reset_user_index(user_id)
    
    return {
        "success": result.get("success"),
        "message": result.get("message"),
        "mongodbDocsReset": docs_reset,
    }


# ============================================================================
# STATS - Get document indexing stats
# ============================================================================

@router.get("/stats", summary="Get Indexing Stats")
async def stats(userId: str = Query(..., description="User ID")):
    """Get document indexing statistics for a user."""
    if not userId:
        raise HTTPException(status_code=400, detail="userId is required")
    
    return get_user_document_stats(userId)


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
        "version": "2.0.0",
        "vectorDb": stats.get("stats", {}),
    }