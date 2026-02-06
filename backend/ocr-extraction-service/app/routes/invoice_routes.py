from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.pdf_extractor import extract_text_from_pdf
from app.services.gemini_client import extract_invoice_json_from_text
from app.models.ocr_models import GeminiResponse

router = APIRouter(prefix="/invoice", tags=["Invoice API"])

@router.post("/extract", summary="Upload a PDF and extract structured invoice JSON")
async def extract_invoice(file: UploadFile = File(...)):
    """
    Upload a PDF invoice, extract text using OCR, and parse structured JSON via Gemini API.
    Returns error dict with 'retryable' flag if processing fails.
    """
    # Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Invalid file format. Please upload a PDF.")

    try:
        # Step 1: Extract text from PDF
        pdf_text = extract_text_from_pdf(file)
        if not pdf_text.strip():
            return {"error": "No text found in the PDF.", "retryable": False}

        # Step 2: Send text to Gemini API
        result = extract_invoice_json_from_text(pdf_text)
        
        # Return result as-is (including error dict with retryable flag if present)
        return result

    except HTTPException as e:
        # Re-raise HTTPException to preserve its status code and message
        raise e
    except Exception as e:
        # Catch-all for unexpected errors - mark as retryable since it's unknown
        return {"error": f"Processing failed: {str(e)}", "retryable": True}
