import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from app.db import update_ocr_status

load_dotenv()

logger = logging.getLogger(__name__)

EMAIL_BASE = os.getenv("EMAIL_SERVICE_BASE_URL", "http://localhost:4002")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
OCR_PORT = int(os.getenv("OCR_PORT", "4003"))
OCR_INTERNAL_BASE_URL = os.getenv("OCR_INTERNAL_BASE_URL", f"http://127.0.0.1:{OCR_PORT}")
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


def _load_master(path: str) -> List[Dict]:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except json.JSONDecodeError:
            logger.warning("Existing master.json invalid JSON", extra={"path": path})
    return []


def _write_master(path: str, payload: List[Dict]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=4)


async def _upload_master_to_drive(folder_id: str, local_path: str, refresh_token: str) -> Optional[str]:
    """Upload master.json to Drive and return the Drive path."""
    if not folder_id:
        logger.info("No Drive folder provided for master.json upload")
        return None

    creds = _build_credentials(DRIVE_SCOPES, refresh_token)
    if not creds:
        return None

    service = build("drive", "v3", credentials=creds)

    # Remove existing master.json
    query = f"'{folder_id}' in parents and name='master.json' and trashed=false"
    try:
        result = service.files().list(q=query, fields="files(id)").execute()
        for item in result.get("files", []):
            service.files().delete(fileId=item["id"]).execute()
    except Exception as exc:
        logger.error("Failed to remove existing master.json", exc_info=exc, extra={"folder_id": folder_id})

    metadata = {"name": "master.json", "parents": [folder_id]}
    media = MediaFileUpload(local_path, mimetype="application/json")

    try:
        uploaded = service.files().create(body=metadata, media_body=media, fields="id").execute()
        logger.info("Uploaded master.json to Drive", extra={"folder_id": folder_id})
        return f"{folder_id}/master.json"
    except Exception as exc:
        logger.error("Failed to upload master.json", exc_info=exc, extra={"folder_id": folder_id})
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
    Process invoices for a vendor:
    1. Check DB for document status (ocrStatus)
    2. Only process if status is PENDING or FAILED
    3. Download PDF from Drive using drive_file_id
    4. Run OCR extraction
    5. Write to master.json (local + Drive)
    6. Update MongoDB with ocr_status=COMPLETED
    
    Database = source of truth for what needs processing
    Google Drive = source of truth for files
    Local storage = temporary cache only
    """
    if not refresh_token:
        logger.error(
            "Refresh token required for vendor processing",
            extra={"user_id": user_id, "vendor": vendor_name},
        )
        return {
            "userId": user_id,
            "vendorName": vendor_name,
            "invoiceFolderId": invoice_folder_id,
            "processed": [],
            "skipped": [{"reason": "missing refresh token", "invoice": None}],
        }
    
    from app.db import get_db
    
    _ensure_folder(INVOICES_ROOT)

    folder_key = invoice_folder_id or vendor_folder_id or vendor_name or "default"
    local_folder = os.path.join(INVOICES_ROOT, folder_key)
    _ensure_folder(local_folder)

    master_path = os.path.join(local_folder, "master.json")
    master_records = _load_master(master_path)
    master_index = {str(entry.get("drive_file_id")): entry for entry in master_records if entry.get("drive_file_id")}

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
            skipped.append({"reason": "missing identifiers", "invoice": invoice})
            continue

        if mime_type and mime_type != "application/pdf":
            skipped.append({"reason": "unsupported mime", "invoice": invoice})
            continue

        # Check DB status - this is the source of truth!
        doc_in_db = docs_collection.find_one({
            "userId": user_id,
            "driveFileId": file_id
        })

        if doc_in_db:
            ocr_status = doc_in_db.get("ocrStatus", "PENDING")
            
            # Skip if already completed
            if ocr_status == "COMPLETED":
                skipped.append({"reason": "already completed (DB)", "invoice": invoice, "file_id": file_id})
                continue
            
            # Skip if currently processing (avoid duplicate processing)
            if ocr_status == "PROCESSING":
                skipped.append({"reason": "already processing", "invoice": invoice, "file_id": file_id})
                continue
            
            # Process if PENDING or FAILED
            logger.info(f"Processing document with status {ocr_status}", extra={
                "file_id": file_id,
                "file_name": file_name,
                "status": ocr_status
            })
        else:
            # Document not in DB yet - this shouldn't happen in normal flow
            logger.warning(f"Document not found in DB, will process anyway", extra={
                "file_id": file_id,
                "user_id": user_id
            })

        # Update MongoDB: OCR processing started
        update_ocr_status(user_id, file_id, "PROCESSING")

        # Always download from Drive - we don't cache PDFs locally
        pdf_bytes = await _download_pdf(file_id, refresh_token)
        if not pdf_bytes:
            update_ocr_status(user_id, file_id, "FAILED", ocr_error="Failed to download PDF from Drive")
            skipped.append({"reason": "download failed", "invoice": invoice, "file_id": file_id})
            continue

        # Run OCR
        ocr_payload = await _run_invoice_ocr(file_name, pdf_bytes)
        if not ocr_payload or "error" in ocr_payload:
            error_msg = ocr_payload.get("error") if ocr_payload else "OCR extraction failed"
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

        master_records.append(enriched)
        master_index[file_id] = enriched

        # Write individual invoice JSON
        with open(os.path.join(local_folder, f"{file_id}.json"), "w", encoding="utf-8") as handle:
            json.dump(enriched, handle, indent=4)

        processed.append(file_id)

    # Write master.json locally
    _write_master(master_path, master_records)

    # Upload master.json to Drive and get path
    master_json_path = None
    if processed:
        master_json_path = await _upload_master_to_drive(invoice_folder_id, master_path, refresh_token)

    # Update MongoDB for all processed invoices: ocr_status=COMPLETED, indexed=false
    for file_id in processed:
        update_ocr_status(
            user_id=user_id,
            drive_file_id=file_id,
            ocr_status="COMPLETED",
            master_json_path=master_json_path,
        )

    if processed:
        logger.info(
            "Processed invoices (OCR complete, pending indexing)",
            extra={"vendor": vendor_name, "processed": len(processed), "skipped": len(skipped)},
        )
    else:
        logger.info(
            "No new invoices to process",
            extra={"vendor": vendor_name, "skipped": len(skipped)},
        )

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
