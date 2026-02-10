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
import logging
from app.core.orchestrator import VendorKnowledgeOrchestrator
from app.db import get_unindexed_documents, mark_documents_indexed, mark_documents_indexed_by_sha256, get_user_document_stats
import httpx

router = APIRouter(tags=["Chat Service"])
logger = logging.getLogger(__name__)

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
    documentsSkipped: int
    message: str


@router.post("/sync", response_model=SyncResponse, summary="Sync & Index Documents")
async def sync_documents(request: SyncRequest):
    """
    Index documents that completed OCR but not yet indexed.
    
    Flow:
    1. Query MongoDB for documents where ocr_status=COMPLETED and indexed=false
    2. Check vector DB for already indexed sha256 hashes (skip expensive embedding)
    3. For new documents, fetch master.json and create embeddings
    4. Store in vector DB (user isolated)
    5. Mark documents as indexed in MongoDB
    """
    user_id = request.userId
    
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")
    
    logger.info(f"Sync requested for user: {user_id}")
    
    # Get unindexed documents from MongoDB (includes sha256)
    unindexed = get_unindexed_documents(user_id)
    
    if not unindexed:
        logger.info(f"No documents to index for user: {user_id}")
        return SyncResponse(
            success=True,
            documentsIndexed=0,
            documentsSkipped=0,
            message="No documents pending to index"
        )
    
    orchestrator = get_orchestrator()
    
    # Get already indexed sha256 hashes from vector DB (EARLY CHECK - avoid expensive embedding)
    indexed_hashes = orchestrator.vector_db.get_indexed_sha256_hashes(user_id)
    logger.info(f"Found {len(indexed_hashes)} already indexed sha256 hashes in vector DB")
    
    # Separate documents: already indexed (by content) vs truly new
    already_indexed_docs = []
    new_docs = []
    
    for doc in unindexed:
        sha256 = doc.get("sha256")
        if sha256 and sha256 in indexed_hashes:
            already_indexed_docs.append(doc)
        else:
            new_docs.append(doc)
    
    logger.info(f"Documents: {len(already_indexed_docs)} already in vector DB (by sha256), {len(new_docs)} new to index")
    
    # Mark already-indexed documents in MongoDB (skip embedding entirely)
    if already_indexed_docs:
        sha256_list = [doc.get("sha256") for doc in already_indexed_docs if doc.get("sha256")]
        marked = mark_documents_indexed_by_sha256(user_id, sha256_list)
        logger.info(f"✓ Marked {marked} documents as indexed (content already in vector DB)")
    
    # If no new documents, we're done
    if not new_docs:
        return SyncResponse(
            success=True,
            documentsIndexed=0,
            documentsSkipped=len(already_indexed_docs),
            message=f"All {len(already_indexed_docs)} documents already indexed (by content hash)"
        )
    
    indexed_file_ids = []
    
    # Group NEW documents by vendor for batch processing
    vendors_data = {}
    for doc in new_docs:
        vendor_name = doc.get("vendorName", "Unknown")
        vendor_folder_id = doc.get("vendorFolderId")
        
        if not vendor_folder_id:
            logger.warning(f"Skipping document {doc.get('driveFileId')}: no vendorFolderId")
            continue
            
        if vendor_name not in vendors_data:
            vendors_data[vendor_name] = {
                "vendor_folder_id": vendor_folder_id,
                "docs": []
            }
        vendors_data[vendor_name]["docs"].append(doc)
    
    logger.info(f"Processing {len(vendors_data)} vendors with {len(new_docs)} new documents")
    
    # Process each vendor's documents
    for vendor_name, vendor_info in vendors_data.items():
        try:
            # Fetch master.json via email-storage-service
            master_records = await _fetch_master_via_email_service(
                user_id,
                vendor_info["vendor_folder_id"]
            )
            
            if not master_records:
                logger.warning(f"No master.json found for vendor {vendor_name}")
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
                logger.info(f"✓ Indexed {len(file_ids)} documents for vendor {vendor_name}")
                
        except Exception as e:
            logger.error(f"Error indexing vendor {vendor_name}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    # Update MongoDB for newly indexed documents
    if indexed_file_ids:
        mark_documents_indexed(user_id, indexed_file_ids)
    
    logger.info(f"Sync complete for user {user_id}: {len(indexed_file_ids)} indexed, {len(already_indexed_docs)} skipped")
    
    return SyncResponse(
        success=True,
        documentsIndexed=len(indexed_file_ids),
        documentsSkipped=len(already_indexed_docs),
        message=f"Indexed {len(indexed_file_ids)} new documents, skipped {len(already_indexed_docs)}"
    )


async def _fetch_master_via_email_service(user_id: str, vendor_folder_id: str) -> list:
    """Fetch master.json via email-storage-service."""
    try:
        from app.config import EMAIL_STORAGE_SERVICE_URL
        
        url = f"{EMAIL_STORAGE_SERVICE_URL}/api/v1/drive/users/{user_id}/vendors/{vendor_folder_id}/master"
        
        logger.debug(f"Fetching master.json from: {url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            
            if response.status_code != 200:
                logger.error(f"Failed to fetch master.json: HTTP {response.status_code}")
                return []
            
            data = response.json()
            records = data.get("records", [])
            logger.debug(f"Fetched {len(records)} records from master.json")
            return records if isinstance(records, list) else []
            
    except Exception as e:
        logger.error(f"Error fetching master.json: {e}")
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
    
    logger.info(f"Query from user {request.userId}: {request.question[:50]}...")
    
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
    
    logger.info(f"Analytics requested for user: {userId}, period: {period}")
    
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
    
    logger.info(f"Deleting all data for user: {user_id}")
    
    orchestrator = get_orchestrator()
    result = orchestrator.delete_user_data(user_id)
    
    # Also reset MongoDB indexed flags
    from app.db import reset_user_index
    docs_reset = reset_user_index(user_id)
    
    logger.info(f"Deleted vector DB data and reset {docs_reset} MongoDB docs for user: {user_id}")
    
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