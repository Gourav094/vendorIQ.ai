/**
 * Centralized API Service — UPDATED FOR API GATEWAY
 * All frontend calls now go through:
 * http://localhost:4000/{service-prefix}/...
 */

const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";

export const API_ENDPOINTS = {
  AUTH: `${API_GATEWAY_URL}/auth`,
  EMAIL: `${API_GATEWAY_URL}/email`,
  OCR: `${API_GATEWAY_URL}/ocr`,
  CHAT: `${API_GATEWAY_URL}/chat`,
  ANALYTICS: `${API_GATEWAY_URL}/analytics`,
};

export interface SyncStatus {
  userId: string;
  email: string;
  lastSyncedAt: string | null;
  hasGoogleConnection: boolean;
  message: string;
}

export interface ProcessDocuments {
  success: boolean;
  message: string;
  totalDocuments: number;
  vendorsProcessed: number;
  vendorsFailed?: number;
  results?: Array<{
    vendor: string;
    status: string;
    invoiceCount: number;
    response?: {
      status: string;
      summary: {
        userId: string;
        vendorName: string;
        invoiceFolderId: string;
        processed: any[];
        skipped: Array<{
          reason: string;
          invoice: any;
          file_id?: string;
        }>;
      };
    };
  }>;
}
interface DocumentStatus {
  success: boolean;
  message?: string;
  userId: string;
  summary: {
    totalDocuments: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  };
  documents: Array<{
    fileId: string;
    filename: string;
    vendor: string;
    status: "pending" | "processing" | "completed" | "failed";
    error?: string;
    attempts?: number;
    lastAttempt?: string;
    webViewLink?: string;
  }>;
  ocrStatus: {
    by_status: string;
  };
}

export interface Vendor {
  id: string;
  name: string;
  createdTime: string;
  webViewLink?: string;
}

export interface Invoice {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
}

export interface MasterRecord extends Record<string, unknown> {
  drive_file_id?: string;
  file_name?: string;
  vendor_name?: string;
  processed_at?: string;
  web_view_link?: string | null;
  web_content_link?: string | null;
}

export interface MasterSummary {
  userId: string;
  vendorFolderId: string;
  invoiceFolderId: string | null;
  masterFileId: string | null;
  updatedAt: string | null;
  size: number | null;
  missing: boolean;
  reason?: string | null;
  records: MasterRecord[];
}

export interface ScheduledJob {
  jobId: string;
  userId: string;
  filters: {
    emails?: string[];
    emailCount?: number;
    onlyPdf?: boolean;
    fromDate: string;
    forceSync?: boolean;
  };
  frequency: "hourly" | "daily" | "weekly";
  nextRun?: string;
  status?: "active" | "paused";
  createdAt: string;
}

export interface ChatSource {
  rank: number;
  vendor_name?: string;
  similarity?: number;
  content_excerpt?: string;
}

export interface ChatAnswerResponse {
  success: boolean;
  vendor_name: string | null;
  question: string;
  answer: string;
  sources: ChatSource[];
  message?: string;
  context_text?: string;
  vendor_detection?: string;
}

export interface ChatVendorSummary {
  success: boolean;
  vendor_info?: {
    vendor_name: string;
    total_chunks: number;
    invoices: { invoice_number: string; amount: any; invoice_date: string }[];
    summary: { last_updated?: string; total_invoices?: number; total_amount?: number };
  };
  message?: string;
}

export interface AnalyticsResponse {
  success?: boolean;
  insights: {
    highestSpend: { vendor: string; amount: number };
    averageInvoice: number;
    costReduction: number;
    avgPaymentTime: number;
    totalSpend?: number;
    totalInvoices?: number;
    vendorCount?: number;
  };
  monthlyTrend: { name: string; value: number }[];
  topVendors: { name: string; value: number }[];
  spendByCategory: { name: string; value: number }[];
  quarterlyTrend: { name: string; value: number }[];
  period?: string;
  message?: string;
  cached?: boolean;
  llmSummary?: string;
}

export interface FetchEmailsRequest {
  userId: string;
  fromDate: string;
  email?: string;
  onlyPdf?: boolean;
  forceSync?: boolean;
  schedule: "manual" | { type: "auto"; frequency: "hourly" | "daily" | "weekly" };
}

export interface FetchEmailsResponse {
  message: string;
  jobId?: string;
  details?: string;
  suggestions?: string[];
  statusEndpoint?: string;
  result?: {
    totalProcessed: number;
    filesUploaded: number;
    uploadedFiles: Array<{
      vendor: string;
      filename: string;
      path: string;
      uploadedAt: string;
    }>;
    vendorsDetected: string[];
  };
  filtersUsed?: {
    emails: string[];
    emailCount: number;
    onlyPdf: boolean;
    fromDate: string;
    forceSync: boolean;
  };
}

export interface JobStatus {
  jobId: string;
  userId: string;
  status: "processing" | "completed" | "failed";
  filters: {
    emails: string[] | null;
    emailCount: number;
    onlyPdf: boolean;
    fromDate: string;
    forceSync: boolean;
  };
  createdAt: string;
  completedAt?: string;
  result?: {
    totalProcessed: number;
    filesUploaded: number;
    uploadedFiles: Array<{
      vendor: string;
      filename: string;
      path: string;
      uploadedAt: string;
    }>;
    vendorsDetected: string[];
  };
  error?: {
    message: string;
    timestamp: string;
  };
}

// ===============================================
// PROCESSING JOB TYPES (NEW - for persistent retry system)
// ===============================================

export interface ProcessingJobError {
  message: string;
  code?: string;
  details?: any;
  retryable: boolean;
  stackTrace?: string;
}

export interface ProcessingJobProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface ProcessingJob {
  jobId: string;
  userId: string;
  jobType: "EMAIL_FETCH" | "VENDOR_SYNC" | "OCR_RETRY" | "MANUAL_RETRY";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "RETRY_PENDING";
  payload: any;
  result?: any;
  error?: ProcessingJobError;
  retryCount: number;
  maxRetries: number;
  lastRetryAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress?: ProcessingJobProgress;
}

export interface ProcessingJobListResponse {
  message: string;
  userId: string;
  total: number;
  count: number;
  limit: number;
  offset: number;
  filters: {
    status: string;
    jobType: string;
  };
  jobs: ProcessingJob[];
}

export interface RetryableJobsResponse {
  message: string;
  userId: string;
  count: number;
  jobs: ProcessingJob[];
}

// ===============================================
// INVOICE PROCESSING STATUS TYPES (OCR Service)
// ===============================================

export interface InvoiceProcessingError {
  phase: "download" | "ocr" | "chat";
  message: string;
  code?: string;
  retryable: boolean;
  timestamp: string;
}

export type InvoiceProcessingStatusType =
  | "PENDING"      // Not processed yet - after email fetch, before OCR starts
  | "PROCESSING"   // OCR is currently running - when OCR job begins
  | "COMPLETED"    // OCR finished successfully - after master.json is created
  | "FAILED";      // OCR started but failed - any error during processing

export interface InvoiceProcessingStatus {
  user_id: string;
  vendor_name: string;
  drive_file_id: string;
  file_name: string;
  status: InvoiceProcessingStatusType;
  ocr_attempt_count: number;
  chat_attempt_count: number;
  errors: InvoiceProcessingError[];
  created_at: string;
  updated_at: string;
  download_started_at?: string;
  ocr_started_at?: string;
  ocr_completed_at?: string;
  chat_started_at?: string;
  chat_completed_at?: string;
  vendor_folder_id?: string;
  invoice_folder_id?: string;
  web_view_link?: string;
  ocr_result?: any;
}

export interface InvoiceStatusResponse {
  success: boolean;
  user_id: string;
  vendor_name?: string;
  total_count: number;
  by_status: Record<string, InvoiceProcessingStatus[]>;
  summary: Record<string, number>;
}

export interface InvoiceStatusSummaryResponse {
  success: boolean;
  user_id: string;
  vendor_name?: string;
  total: number;
  by_status: Record<string, number>;
  retryable: number;
}

export interface RetryInvoicesRequest {
  userId: string;
  vendorName?: string;
  driveFileIds?: string[];
  refreshToken: string;
  maxOcrRetries?: number;
  maxChatRetries?: number;
}

export interface RetryInvoicesResponse {
  success: boolean;
  message: string;
  user_id: string;
  vendor_name?: string;
  total_failed: number;
  retried: number;
  max_retries_reached: number;
  results: Array<{
    vendor: string;
    status: "completed" | "failed";
    summary?: any;
    error?: string;
  }>;
}

export interface PendingDocumentsResponse {
  success: boolean;
  userId: string;
  count: number;
  documents: Array<{
    fileId: string;
    filename: string;
    vendor: string;
    createdAt: string;
  }>;
}

// ===============================================
// Helper wrapper (always uses API Gateway)
// ===============================================
async function apiCall<T>(
  fullPath: string,
  options?: RequestInit & { skipAuth?: boolean; timeout?: number }
): Promise<{ data: T; response: Response }> {
  const timeoutMs = options?.timeout || 120000; // Default 2 minutes

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_GATEWAY_URL}${fullPath}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({} as T));
    return { data, response };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ===============================================
// AUTH APIs (via gateway /auth/...)
// ===============================================

export function getGoogleAuthUrl(userId: string): string {
  return `${API_GATEWAY_URL}/email/auth/google?userId=${userId}`;
}

// ===============================================
// EMAIL APIs (via gateway /email/...)
// ===============================================

export async function fetchEmails(
  request: FetchEmailsRequest
) {
  return apiCall<FetchEmailsResponse>(
    `/email/api/v1/email/fetch`,
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  );
}

/**
 * Check the status of an email fetch job
 * @deprecated Use getProcessingJob instead - this is for backward compatibility
 * Maps new ProcessingJob format to old JobStatus format
 */
export async function getJobStatus(jobId: string) {
  const { data: processingJob, response } = await apiCall<ProcessingJob>(
    `/email/api/v1/processing/jobs/${jobId}`
  );

  if (!response.ok) {
    return { data: null as any, response };
  }

  // Map ProcessingJob to JobStatus for backward compatibility
  const jobStatus: JobStatus = {
    jobId: processingJob.jobId,
    userId: processingJob.userId,
    status: processingJob.status === "COMPLETED" ? "completed"
      : processingJob.status === "FAILED" ? "failed"
        : "processing",
    filters: {
      emails: processingJob.payload?.emails || null,
      emailCount: processingJob.payload?.emailCount || 0,
      onlyPdf: processingJob.payload?.onlyPdf ?? true,
      fromDate: processingJob.payload?.fromDate || "",
      forceSync: processingJob.payload?.forceSync ?? false,
    },
    createdAt: processingJob.createdAt,
    completedAt: processingJob.completedAt,
    result: processingJob.result,
    error: processingJob.error ? {
      message: processingJob.error.message,
      timestamp: processingJob.updatedAt,
    } : undefined,
  };

  return { data: jobStatus, response };
}

/**
 * Poll for job completion with exponential backoff
 * @param jobId - The job ID to poll
 * @param maxAttempts - Maximum number of polling attempts (default: 60)
 * @param initialInterval - Initial polling interval in ms (default: 2000)
 * @param maxInterval - Maximum polling interval in ms (default: 10000)
 * @returns Promise that resolves when job completes or fails
 */
export async function pollJobStatus(
  jobId: string,
  maxAttempts = 60,
  initialInterval = 2000,
  maxInterval = 10000
): Promise<JobStatus> {
  let attempts = 0;
  let interval = initialInterval;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      const { data, response } = await getJobStatus(jobId);

      if (!response.ok) {
        throw new Error(`Failed to get job status: ${response.statusText}`);
      }

      // Job completed successfully
      if (data.status === "completed") {
        return data;
      }

      // Job failed
      if (data.status === "failed") {
        throw new Error(data.error?.message || "Job failed");
      }

      // Still processing - wait before next poll
      await new Promise(resolve => setTimeout(resolve, interval));

      // Exponential backoff (cap at maxInterval)
      interval = Math.min(interval * 1.5, maxInterval);

    } catch (error) {
      // If it's a job completion error (failed status), throw it
      if (error instanceof Error && error.message.includes("Job failed")) {
        throw error;
      }

      // For network errors, retry
      console.warn(`Poll attempt ${attempts} failed:`, error);

      if (attempts >= maxAttempts) {
        throw new Error("Job polling timeout - max attempts reached");
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  throw new Error("Job polling timeout - max attempts reached");
}

/**
 * Fetch emails with automatic polling until completion
 * This is a convenience wrapper around fetchEmails + pollJobStatus
 */
export async function fetchEmailsWithPolling(
  request: FetchEmailsRequest,
  onProgress?: (status: JobStatus) => void
): Promise<JobStatus> {
  // Start the job
  const { data: startResponse, response } = await fetchEmails(request);

  if (!response.ok) {
    throw new Error(startResponse.message || "Failed to start email fetch");
  }

  const jobId = startResponse.jobId;
  if (!jobId) {
    // Old behavior - job completed synchronously
    return {
      jobId: "sync",
      userId: request.userId,
      status: "completed",
      filters: {
        emails: request.email ? [request.email] : null,
        emailCount: 0,
        onlyPdf: request.onlyPdf ?? true,
        fromDate: request.fromDate,
        forceSync: request.forceSync ?? false,
      },
      createdAt: new Date().toISOString(),
      result: startResponse.result,
    };
  }

  // Poll for completion with progress callbacks
  let lastStatus: JobStatus | null = null;
  const pollWithProgress = async () => {
    return pollJobStatus(jobId, 60, 2000, 10000);
  };

  // Optional: set up interval for progress updates
  let progressInterval: NodeJS.Timeout | null = null;
  if (onProgress) {
    progressInterval = setInterval(async () => {
      try {
        const { data } = await getJobStatus(jobId);
        if (JSON.stringify(data) !== JSON.stringify(lastStatus)) {
          lastStatus = data;
          onProgress(data);
        }
      } catch (err) {
        console.warn("Progress check failed:", err);
      }
    }, 3000);
  }

  try {
    const result = await pollWithProgress();
    return result;
  } finally {
    if (progressInterval) {
      clearInterval(progressInterval);
    }
  }
}

export async function getScheduledJobs(userId: string) {
  return apiCall(`/email/api/v1/emails/schedule/${userId}`);
}

export async function cancelScheduledJob(userId: string, jobId: string) {
  return apiCall(
    `/email/api/v1/emails/schedule/${userId}/${jobId}`,
    { method: "DELETE" }
  );
}

export async function getUserSyncStatus(userId: string) {
  return apiCall<SyncStatus>(`/email/api/v1/users/${userId}/sync-status`);
}

export async function processDocuments(userId: string) {
  return apiCall<ProcessDocuments>('/email/api/v1/documents/process',{
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function getPendingDocuments(userId: string) {
  return apiCall<PendingDocumentsResponse>(
    `/email/api/v1/documents/pending/${userId}`
  );
}

export async function getDocumentStatus(userId: string) {
  return apiCall<DocumentStatus>(`/email/api/v1/documents/status/${userId}`, {
    method: "GET",
  });
}

export async function resetUserSyncStatus(userId: string) {
  return apiCall(`/email/api/v1/users/${userId}/sync-status`, {
    method: "DELETE",
  });
}

export async function disconnectGoogleAccount(userId: string) {
  return apiCall(
    `/email/api/v1/users/${userId}/disconnect-google`,
    { method: "POST" }
  );
}

export async function getVendors(userId: string) {
  return apiCall<{ userId: string; total: number; vendors: Vendor[] }>(
    `/email/api/v1/drive/users/${userId}/vendors`
  );
}

export async function getInvoices(userId: string, vendorId: string) {
  return apiCall(
    `/email/api/v1/drive/users/${userId}/vendors/${vendorId}/invoices`
  );
}

export async function getVendorMaster(userId: string, vendorId: string) {
  return apiCall<MasterSummary>(
    `/email/api/v1/drive/users/${userId}/vendors/${vendorId}/master`
  );
}

// ===============================================
// CHAT APIs (via gateway /chat/...)
// ===============================================

export async function getChatAnswer(question: string, vendorName?: string, userId?: string) {
  return apiCall<ChatAnswerResponse>(
    `/chat/api/v1/query`,
    {
      method: "POST",
      body: JSON.stringify({
        userId,
        question,
        vendorName: vendorName || null
      })
    }
  );
}

export async function syncChatDocuments(userId: string) {
  return apiCall<{ success: boolean; documentsIndexed: number; message: string }>(
    `/chat/api/v1/sync`,
    { 
      method: "POST",
      body: JSON.stringify({ userId })
    }
  );
}

export async function deleteChatUserData(userId: string) {
  return apiCall<{ success: boolean; message: string; mongodbDocsReset: number }>(
    `/chat/api/v1/user/${userId}/data`,
    { method: "DELETE" }
  );
}

export async function getChatStats(userId: string) {
  return apiCall<{ total: number; ocr_completed: number; indexed: number; pending_index: number }>(
    `/chat/api/v1/stats?userId=${userId}`
  );
}

export async function getAnalytics(period: string, userId?: string) {
  const qs = new URLSearchParams({ period });
  if (userId) qs.append("userId", userId);

  return apiCall<AnalyticsResponse>(
    `/chat/api/v1/analytics?${qs.toString()}`
  );
}

// @deprecated - Use syncChatDocuments instead
export async function loadChatKnowledge(userId: string, incremental = true) {
  return syncChatDocuments(userId);
}

// @deprecated - Vendor summary endpoint removed in v2.0
export async function getChatVendorSummary(vendorName: string) {
  console.warn("getChatVendorSummary is deprecated - use getChatAnswer with vendorName filter");
  return apiCall<ChatVendorSummary>(
    `/chat/api/v1/query`,
    {
      method: "POST",
      body: JSON.stringify({
        question: `Give me a summary of ${vendorName}`,
        vendorName
      })
    }
  );
}

// ===============================================
// PROCESSING APIs (via gateway /email/api/v1/processing/...)
// ===============================================

/**
 * Get a specific processing job by ID
 */
export async function getProcessingJob(jobId: string) {
  return apiCall<ProcessingJob>(
    `/email/api/v1/processing/jobs/${jobId}`
  );
}

/**
 * List all processing jobs for a user
 */
export async function listProcessingJobs(
  userId: string,
  options?: {
    status?: string;
    jobType?: string;
    limit?: number;
    offset?: number;
  }
) {
  const params = new URLSearchParams();
  if (options?.status) params.append("status", options.status);
  if (options?.jobType) params.append("jobType", options.jobType);
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.offset) params.append("offset", options.offset.toString());

  const queryString = params.toString();
  return apiCall<ProcessingJobListResponse>(
    `/email/api/v1/processing/users/${userId}/jobs${queryString ? `?${queryString}` : ""}`
  );
}

/**
 * Get retryable (failed) jobs for a user
 */
export async function getRetryableJobs(userId: string) {
  return apiCall<RetryableJobsResponse>(
    `/email/api/v1/processing/users/${userId}/jobs/retryable`
  );
}

/**
 * Retry a failed processing job
 */
export async function retryProcessingJob(jobId: string) {
  return apiCall<ProcessingJob>(
    `/email/api/v1/processing/jobs/${jobId}/retry`,
    { method: "POST" }
  );
}

// ===============================================
// INVOICE PROCESSING STATUS APIs (via gateway /ocr/...)
// ===============================================

/**
 * Get invoice processing status
 */
export async function getInvoiceProcessingStatus(
  userId: string,
  vendorName?: string,
  status?: string
) {
  const params = new URLSearchParams({ userId });
  if (vendorName) params.append("vendorName", vendorName);
  if (status) params.append("status", status);

  return apiCall<InvoiceStatusResponse>(
    `/ocr/api/v1/processing/status?${params.toString()}`
  );
}

/**
 * Get invoice processing status summary (counts)
 */
export async function getInvoiceProcessingStatusSummary(
  userId: string,
  vendorName?: string
) {
  const params = new URLSearchParams({ userId });
  if (vendorName) params.append("vendorName", vendorName);

  return apiCall<InvoiceStatusSummaryResponse>(
    `/ocr/api/v1/processing/status/summary?${params.toString()}`
  );
}

/**
 * Retry failed invoice processing
 */
export async function retryInvoiceProcessing(request: RetryInvoicesRequest) {
  return apiCall<RetryInvoicesResponse>(
    `/ocr/api/v1/processing/retry`,
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  );
}

/**
 * Retry documents via email service (securely handles refresh token)
 */
export async function retryDocumentsSecure(
  userId: string,
  vendorName?: string,
  driveFileIds?: string[]
) {
  return apiCall<RetryInvoicesResponse>(
    `/email/api/v1/documents/retry`,
    {
      method: "POST",
      body: JSON.stringify({
        userId,
        vendorName,
        driveFileIds
      }),
    }
  );
}

/**
 * Clear invoice processing status records for a user
 */
export async function clearInvoiceProcessingStatus(userId: string) {
  return apiCall<{ success: boolean; deleted_count: number }>(
    `/ocr/api/v1/processing/status?userId=${userId}`,
    { method: "DELETE" }
  );
}

export const api = {
  // Auth
  getGoogleAuthUrl,

  // Email
  fetchEmails,
  getJobStatus,
  pollJobStatus,
  fetchEmailsWithPolling,
  processDocuments,
  getScheduledJobs,
  cancelScheduledJob,
  getDocumentStatus,
  getUserSyncStatus,
  resetUserSyncStatus,
  disconnectGoogleAccount,
  getVendors,
  getInvoices,
  getVendorMaster,
  getPendingDocuments,

  // Processing Jobs (NEW)
  getProcessingJob,
  listProcessingJobs,
  getRetryableJobs,
  retryProcessingJob,

  // Invoice Status (NEW)
  getInvoiceProcessingStatus,
  getInvoiceProcessingStatusSummary,
  retryInvoiceProcessing,
  retryDocumentsSecure,
  clearInvoiceProcessingStatus,

  // Chat
  getChatAnswer,
  syncChatDocuments,
  deleteChatUserData,
  getChatStats,
  getAnalytics,
  loadChatKnowledge,
  getChatVendorSummary,
};

export default api;
