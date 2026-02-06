"""
Invoice processing status tracking models.
Provides persistent tracking of individual invoice processing states
across OCR extraction and chat indexing phases.
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class InvoiceProcessingError(BaseModel):
    """Error details for failed processing"""
    phase: str  # "download", "ocr", "chat"
    message: str
    code: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    retryable: bool = True
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class InvoiceProcessingStatus(BaseModel):
    """
    Tracks the processing status of a single invoice through the pipeline.
    
    Status flow:
    PENDING -> DOWNLOADING -> OCR_PROCESSING -> OCR_SUCCESS -> CHAT_INDEXING -> COMPLETED
                           \-> OCR_FAILED                    \-> CHAT_FAILED
    """
    # Identification
    user_id: str
    vendor_name: str
    drive_file_id: str
    file_name: str
    
    # Current status
    status: str = "PENDING"  # PENDING, DOWNLOADING, OCR_PROCESSING, OCR_SUCCESS, OCR_FAILED, CHAT_INDEXING, CHAT_FAILED, COMPLETED
    
    # Attempt counters
    ocr_attempt_count: int = 0
    chat_attempt_count: int = 0
    
    # Error tracking
    errors: List[InvoiceProcessingError] = Field(default_factory=list)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    download_started_at: Optional[datetime] = None
    ocr_started_at: Optional[datetime] = None
    ocr_completed_at: Optional[datetime] = None
    chat_started_at: Optional[datetime] = None
    chat_completed_at: Optional[datetime] = None
    
    # Metadata
    vendor_folder_id: Optional[str] = None
    invoice_folder_id: Optional[str] = None
    web_view_link: Optional[str] = None
    
    # Result data (optional, can be used for caching)
    ocr_result: Optional[Dict[str, Any]] = None
    
    def add_error(self, phase: str, message: str, retryable: bool = True, **kwargs):
        """Add error to the error list"""
        error = InvoiceProcessingError(
            phase=phase,
            message=message,
            retryable=retryable,
            **kwargs
        )
        self.errors.append(error)
        self.updated_at = datetime.utcnow()
    
    def is_retryable(self) -> bool:
        """Check if this invoice can be retried"""
        if self.status not in ["OCR_FAILED", "CHAT_FAILED"]:
            return False
        
        # Check if last error is retryable
        if self.errors:
            return self.errors[-1].retryable
        
        return True
    
    def should_retry_ocr(self, max_attempts: int = 3) -> bool:
        """Check if OCR should be retried"""
        return (
            self.status == "OCR_FAILED" and
            self.ocr_attempt_count < max_attempts and
            self.is_retryable()
        )
    
    def should_retry_chat(self, max_attempts: int = 3) -> bool:
        """Check if chat indexing should be retried"""
        return (
            self.status == "CHAT_FAILED" and
            self.chat_attempt_count < max_attempts and
            self.is_retryable()
        )
    
    def mark_downloading(self):
        """Mark as downloading from Drive"""
        self.status = "DOWNLOADING"
        self.download_started_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
    
    def mark_ocr_processing(self):
        """Mark as OCR in progress"""
        self.status = "OCR_PROCESSING"
        self.ocr_started_at = datetime.utcnow()
        self.ocr_attempt_count += 1
        self.updated_at = datetime.utcnow()
    
    def mark_ocr_success(self, result: Optional[Dict] = None):
        """Mark OCR as successful"""
        self.status = "OCR_SUCCESS"
        self.ocr_completed_at = datetime.utcnow()
        if result:
            self.ocr_result = result
        self.updated_at = datetime.utcnow()
    
    def mark_ocr_failed(self, error_message: str, retryable: bool = True, **kwargs):
        """Mark OCR as failed"""
        self.status = "OCR_FAILED"
        self.add_error("ocr", error_message, retryable, **kwargs)
    
    def mark_chat_indexing(self):
        """Mark as chat indexing in progress"""
        self.status = "CHAT_INDEXING"
        self.chat_started_at = datetime.utcnow()
        self.chat_attempt_count += 1
        self.updated_at = datetime.utcnow()
    
    def mark_chat_failed(self, error_message: str, retryable: bool = True, **kwargs):
        """Mark chat indexing as failed"""
        self.status = "CHAT_FAILED"
        self.add_error("chat", error_message, retryable, **kwargs)
    
    def mark_completed(self):
        """Mark entire pipeline as completed"""
        self.status = "COMPLETED"
        self.chat_completed_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class ProcessingStatusStore:
    """
    In-memory and file-based storage for invoice processing statuses.
    Uses JSON files organized by user and vendor for persistence.
    """
    
    def __init__(self, storage_dir: str = "processing_status"):
        self.storage_dir = storage_dir
        self._ensure_storage_dir()
    
    def _ensure_storage_dir(self):
        """Ensure storage directory exists"""
        import os
        if not os.path.exists(self.storage_dir):
            os.makedirs(self.storage_dir)
    
    def _get_status_file_path(self, user_id: str, vendor_name: str) -> str:
        """Get file path for vendor status file"""
        import os
        # Sanitize vendor name for file system
        safe_vendor = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in vendor_name)
        return os.path.join(self.storage_dir, f"{user_id}_{safe_vendor}_status.json")
    
    def save_status(self, status: InvoiceProcessingStatus):
        """Save invoice status to file"""
        import json
        
        file_path = self._get_status_file_path(status.user_id, status.vendor_name)
        
        # Load existing statuses
        statuses = self.load_vendor_statuses(status.user_id, status.vendor_name)
        
        # Update or add new status
        updated = False
        for i, existing in enumerate(statuses):
            if existing.drive_file_id == status.drive_file_id:
                statuses[i] = status
                updated = True
                break
        
        if not updated:
            statuses.append(status)
        
        # Write to file
        with open(file_path, 'w') as f:
            json.dump([s.dict() for s in statuses], f, indent=2, default=str)
    
    def load_vendor_statuses(self, user_id: str, vendor_name: str) -> List[InvoiceProcessingStatus]:
        """Load all invoice statuses for a vendor"""
        import json
        import os
        
        file_path = self._get_status_file_path(user_id, vendor_name)
        
        if not os.path.exists(file_path):
            return []
        
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                return [InvoiceProcessingStatus(**item) for item in data]
        except Exception:
            return []
    
    def get_status(self, user_id: str, vendor_name: str, drive_file_id: str) -> Optional[InvoiceProcessingStatus]:
        """Get status for a specific invoice"""
        statuses = self.load_vendor_statuses(user_id, vendor_name)
        for status in statuses:
            if status.drive_file_id == drive_file_id:
                return status
        return None
    
    def get_failed_invoices(self, user_id: str, vendor_name: Optional[str] = None) -> List[InvoiceProcessingStatus]:
        """Get all failed invoices for retry"""
        import os
        
        failed = []
        
        if vendor_name:
            # Get failed for specific vendor
            statuses = self.load_vendor_statuses(user_id, vendor_name)
            failed.extend([s for s in statuses if s.status in ["OCR_FAILED", "CHAT_FAILED"] and s.is_retryable()])
        else:
            # Get failed across all vendors
            for filename in os.listdir(self.storage_dir):
                if filename.startswith(user_id) and filename.endswith('_status.json'):
                    file_path = os.path.join(self.storage_dir, filename)
                    try:
                        import json
                        with open(file_path, 'r') as f:
                            data = json.load(f)
                            statuses = [InvoiceProcessingStatus(**item) for item in data]
                            failed.extend([s for s in statuses if s.status in ["OCR_FAILED", "CHAT_FAILED"] and s.is_retryable()])
                    except Exception:
                        continue
        
        return failed
