import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from app.db import update_ocr_status

logger = logging.getLogger(__name__)

EMAIL_BASE = os.getenv("EMAIL_SERVICE_URL", "http://localhost:4002")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
OCR_PORT = int(os.getenv("OCR_SERVICE_PORT", "4003"))
OCR_INTERNAL_BASE_URL = os.getenv("OCR_SERVICE_URL", f"http://127.0.0.1:{OCR_PORT}")
INVOICES_ROOT = os.getenv("INVOICES_JSON_FOLDER", "invoices_json")
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def _ensure_folder(path: str) -> None:
    if not os.path.exists(path):
        os.makedirs(path)


def _build_credentials(scopes: List[str], refresh_token: Optional[str]) -> Optional[Credentials]:
    if not refresh_token:
        logger.error("Refresh token missing; Drive access unavailable")
        return None

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=scopes,
    )

    try:
        creds.refresh(Request())
    except Exception as exc:
        logger.error("Failed to refresh Google credentials", exc_info=exc)
        return None

    return creds


async def _download_pdf(file_id: str, refresh_token: str) -> Optional[bytes]:
    creds = _build_credentials(DRIVE_SCOPES, refresh_token)
    if not creds:
        return None

    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    headers = {"Authorization": f"Bearer {creds.token}"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.get(url, headers=headers)
            if response.status_code == 200:
                return response.content
            logger.warning("Drive download failed", extra={"file_id": file_id, "status": response.status_code})
        except httpx.HTTPError as exc:
            logger.error("HTTP error downloading from Drive", exc_info=exc, extra={"file_id": file_id})
    return None


async def _run_invoice_ocr(filename: str, content: bytes) -> Optional[Dict]:
    url = f"{OCR_INTERNAL_BASE_URL}/api/v1/invoice/extract"
    files = {"file": (filename, content, "application/pdf")}

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(url, files=files)
            if response.status_code == 200:
                return response.json()
            logger.warning("OCR request failed", extra={"status": response.status_code, "filename": filename})
        except httpx.HTTPError as exc:
            logger.error("HTTP error calling OCR endpoint", exc_info=exc, extra={"filename": filename})
    return None


async def _download_master_from_drive(folder_id: str, refresh_token: str) -> List[Dict]:
    """Download existing master.json from Drive. Returns empty list if not found."""
    if not folder_id:
        logger.info("No folder_id provided, starting with empty master")
        return []
    
    logger.info(f"Attempting to download master.json from Drive folder: {folder_id}")
    
    creds = _build_credentials(DRIVE_SCOPES, refresh_token)
    if not creds:
        logger.error("Failed to build credentials for Drive access")
        return []
    
    service = build("drive", "v3", credentials=creds)
    
    # Search for master.json in the folder
    query = f"'{folder_id}' in parents and name='master.json' and trashed=false"
    try:
        result = service.files().list(q=query, fields="files(id)").execute()
        files = result.get("files", [])
        
        if not files:
            logger.info("No existing master.json found in Drive, starting fresh")
            return []
        
        # Download the file
        file_id = files[0]["id"]
        logger.info(f"Found master.json (file_id: {file_id}), downloading...")
        
        request = service.files().get_media(fileId=file_id)
        
        import io
        file_buffer = io.BytesIO()
        from googleapiclient.http import MediaIoBaseDownload
        downloader = MediaIoBaseDownload(file_buffer, request)
        
        done = False
        while not done:
            status, done = downloader.next_chunk()
        
        file_buffer.seek(0)
        master_data = json.load(file_buffer)
        logger.info(f"Downloaded master.json successfully ({len(master_data)} existing records)")
        return master_data if isinstance(master_data, list) else []
        
    except Exception as exc:
        logger.warning(f"Failed to download master.json from Drive: {str(exc)[:100]}")
        return []


async def _upload_master_to_drive(folder_id: str, local_path: str, refresh_token: str) -> Optional[str]:
    """Upload master.json to Drive and return the Drive path."""
    if not folder_id:
        logger.info("No Drive folder provided, skipping upload")
        return None

    logger.info(f"Uploading master.json to Drive folder: {folder_id}")
    
    creds = _build_credentials(DRIVE_SCOPES, refresh_token)
    if not creds:
        logger.error("Failed to build credentials for Drive upload")
        return None

    service = build("drive", "v3", credentials=creds)

    # Remove existing master.json
    query = f"'{folder_id}' in parents and name='master.json' and trashed=false"
    try:
        result = service.files().list(q=query, fields="files(id)").execute()
        existing_files = result.get("files", [])
        if existing_files:
            logger.info(f"Removing {len(existing_files)} existing master.json file(s)")
            for item in existing_files:
                service.files().delete(fileId=item["id"]).execute()
    except Exception as exc:
        logger.error(f"Failed to remove existing master.json: {str(exc)[:100]}")

    metadata = {"name": "master.json", "parents": [folder_id]}
    media = MediaFileUpload(local_path, mimetype="application/json")

    try:
        uploaded = service.files().create(body=metadata, media_body=media, fields="id").execute()
        logger.info(f"Uploaded master.json successfully (file_id: {uploaded.get('id')})")
        return f"{folder_id}/master.json"
    except Exception as exc:
        logger.error(f"Failed to upload master.json: {str(exc)[:100]}")
        return None


async def process_vendor_invoices(
    user_id: str,
    vendor_name: str,
    invoice_folder_id: Optional[str],
    invoices: List[Dict],
    refresh_token: str,
    vendor_folder_id: Optional[str] = None,
) -> Dict:
    """
    Stateless OCR processing:
    1. Download existing master.json from Drive (or start fresh)
    2. Process new invoices and append to master data
    3. Upload updated master.json to Drive
    4. Delete temporary files (no persistent cache)
    
    Google Drive = single source of truth
    MongoDB = processing status tracking
    Local storage = temporary only (deleted after upload)
    """
    logger.info(f"[OCR] Starting processing for vendor: {vendor_name} (user: {user_id})")
    logger.info(f"[OCR] Total invoices to check: {len(invoices)}")
    
    if not refresh_token:
        logger.error(f"[OCR] Missing refresh token for user: {user_id}")
        return {
            "userId": user_id,
            "vendorName": vendor_name,
            "invoiceFolderId": invoice_folder_id,
            "processed": [],
            "skipped": [{"reason": "missing refresh token", "invoice": None}],
        }
    
    from app.db import get_db
    
    # Step 1: Download existing master.json from Drive (stateless!)
    master_records = await _download_master_from_drive(invoice_folder_id, refresh_token)
    master_index = {str(entry.get("drive_file_id")): entry for entry in master_records if entry.get("drive_file_id")}
    
    logger.info(f"[OCR] Loaded {len(master_records)} existing records from Drive")

    processed, skipped = [], []

    # Get database instance to check document status
    db = get_db()
    docs_collection = db["documents"]

    for invoice in invoices:
        file_id = str(invoice.get("fileId") or invoice.get("file_id") or invoice.get("id"))
        file_name = invoice.get("fileName") or invoice.get("file_name") or invoice.get("name")
        mime_type = invoice.get("mimeType")
        web_view_link = invoice.get("webViewLink") or invoice.get("web_view_link")
        web_content_link = invoice.get("webContentLink") or invoice.get("web_content_link")

        if not file_id or not file_name:
            logger.debug("[OCR] Skipping invoice with missing identifiers")
            skipped.append({"reason": "missing identifiers", "invoice": invoice})
            continue

        if mime_type and mime_type != "application/pdf":
            logger.debug(f"[OCR] Skipping non-PDF file: {file_name} ({mime_type})")
            skipped.append({"reason": "unsupported mime", "invoice": invoice})
            continue

        # Check DB status - this is the source of truth!
        doc_in_db = docs_collection.find_one({
            "userId": user_id,
            "driveFileId": file_id
        })

        if doc_in_db:
            ocr_status = doc_in_db.get("ocrStatus", "PENDING")
            
            if ocr_status == "COMPLETED":
                logger.debug(f"[OCR] Skipping completed: {file_name}")
                skipped.append({"reason": "already completed (DB)", "invoice": invoice, "file_id": file_id})
                continue
            
            if ocr_status == "PROCESSING":
                logger.debug(f"[OCR] Skipping in-progress: {file_name}")
                skipped.append({"reason": "already processing", "invoice": invoice, "file_id": file_id})
                continue
            
            logger.info(f"[OCR] Processing: {file_name} (status: {ocr_status})")
        else:
            logger.warning(f"[OCR] Document not in DB, processing anyway: {file_name}")

        # Update MongoDB: OCR processing started
        update_ocr_status(user_id, file_id, "PROCESSING")

        # Download PDF from Drive
        logger.debug(f"[OCR] Downloading PDF from Drive: {file_name}")
        pdf_bytes = await _download_pdf(file_id, refresh_token)
        if not pdf_bytes:
            logger.error(f"[OCR] Download failed: {file_name}")
            update_ocr_status(user_id, file_id, "FAILED", ocr_error="Failed to download PDF from Drive")
            skipped.append({"reason": "download failed", "invoice": invoice, "file_id": file_id})
            continue

        # Run OCR
        logger.info(f"[OCR] Running OCR extraction on: {file_name}")
        ocr_payload = await _run_invoice_ocr(file_name, pdf_bytes)
        if not ocr_payload or "error" in ocr_payload:
            error_msg = ocr_payload.get("error") if ocr_payload else "OCR extraction failed"
            logger.error(f"[OCR] Extraction failed for {file_name}: {error_msg}")
            update_ocr_status(user_id, file_id, "FAILED", ocr_error=error_msg)
            skipped.append({"reason": "ocr failed", "invoice": invoice, "file_id": file_id, "error": error_msg})
            continue

        # Enrich OCR result with metadata
        enriched = dict(ocr_payload)
        enriched.update({
            "drive_file_id": file_id,
            "file_name": file_name,
            "vendor_name": vendor_name,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        })
        if web_view_link:
            enriched["web_view_link"] = web_view_link
        if web_content_link:
            enriched["web_content_link"] = web_content_link

        # Update or append to master data (avoid duplicates by drive_file_id)
        if file_id in master_index:
            # Update existing entry
            idx = next((i for i, r in enumerate(master_records) if r.get("drive_file_id") == file_id), None)
            if idx is not None:
                master_records[idx] = enriched
                logger.info(f"[OCR] Updated existing record: {file_name}")
            else:
                master_records.append(enriched)
        else:
            # New entry
            master_records.append(enriched)
        
        master_index[file_id] = enriched
        processed.append(file_id)
        logger.info(f"[OCR] Completed: {file_name}")

    # Step 2: Upload updated master.json to Drive (using temporary file)
    master_json_path = None
    if processed:
        logger.info(f"[OCR] Creating temporary master.json with {len(master_records)} total records")
        
        # Create a temporary file for upload
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as temp_file:
            json.dump(master_records, temp_file, indent=4)
            temp_path = temp_file.name
        
        logger.debug(f"[OCR] Temp file created: {temp_path}")
        
        try:
            master_json_path = await _upload_master_to_drive(invoice_folder_id, temp_path, refresh_token)
            
            # Step 3: Delete temporary file immediately after upload
            if os.path.exists(temp_path):
                os.remove(temp_path)
                logger.debug(f"[OCR] Deleted temporary file: {temp_path}")
        except Exception as e:
            logger.error(f"[OCR] Upload/cleanup failed: {str(e)[:100]}")
            # Clean up temp file even on failure
            if os.path.exists(temp_path):
                os.remove(temp_path)

    # Update MongoDB for all processed invoices
    if processed:
        logger.info(f"[OCR] Updating MongoDB status for {len(processed)} documents")
        for file_id in processed:
            update_ocr_status(
                user_id=user_id,
                drive_file_id=file_id,
                ocr_status="COMPLETED",
                master_json_path=master_json_path,
            )

    logger.info(f"[OCR] Complete for {vendor_name}: {len(processed)} processed, {len(skipped)} skipped")
    
    return {
        "userId": user_id,
        "vendorName": vendor_name,
        "invoiceFolderId": invoice_folder_id,
        "processed": processed,
        "skipped": skipped,
    }


async def process_all_invoices(user_id: str, refresh_token: str) -> List[Dict]:
    """Process all invoices for all vendors of a user."""
    results: List[Dict] = []

    if not refresh_token:
        logger.error("Refresh token required for full sync", extra={"user_id": user_id})
        return results

    async with httpx.AsyncClient(timeout=60.0) as client:
        vendor_resp = await client.get(f"{EMAIL_BASE}/api/v1/drive/users/{user_id}/vendors")
        if vendor_resp.status_code != 200:
            logger.error("Failed to fetch vendor list", extra={"user_id": user_id, "status": vendor_resp.status_code})
            return results

        for vendor in vendor_resp.json().get("vendors", []):
            vendor_folder_id = vendor.get("id")
            vendor_name = vendor.get("name", "Unknown Vendor")

            invoice_resp = await client.get(
                f"{EMAIL_BASE}/api/v1/drive/users/{user_id}/vendors/{vendor_folder_id}/invoices"
            )
            if invoice_resp.status_code != 200:
                logger.error(
                    "Failed to fetch invoices",
                    extra={"user_id": user_id, "vendor_id": vendor_folder_id, "status": invoice_resp.status_code},
                )
                continue

            invoice_payload = invoice_resp.json()
            summary = await process_vendor_invoices(
                user_id=user_id,
                vendor_name=vendor_name,
                invoice_folder_id=invoice_payload.get("invoiceFolderId"),
                invoices=invoice_payload.get("invoices", []),
                vendor_folder_id=vendor_folder_id,
                refresh_token=refresh_token,
            )
            results.append(summary)

    logger.info("Full invoice sync complete", extra={"user_id": user_id, "vendors": len(results)})
    return results
