import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listProcessingJobs,
  getDocumentStatus,
  retryProcessingJob,
  retryDocumentsSecure,
  type ProcessingJob,
} from "@/services/api";
import api from "@/services/api";

// Document type from MongoDB
interface DocumentRecord {
  driveFileId: string;
  fileName: string;
  vendorName: string;
  ocrStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  indexed: boolean;
  indexedAt: string | null;
  ocrCompletedAt: string | null;
  ocrError: string | null;
  webViewLink: string;
  webContentLink: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentSummary {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  indexed: number;
  pendingIndex: number;
}

interface ProcessingStatusData {
  documents: DocumentRecord[];
  summary: DocumentSummary | null;
  emailJobs: ProcessingJob[];
}

const fetchProcessingStatus = async (userId: string): Promise<ProcessingStatusData> => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  const [jobsRes, docStatusRes] = await Promise.all([
    listProcessingJobs(userId, { limit: 50 }),
    getDocumentStatus(userId),
  ]);

  const emailJobs = jobsRes.response.ok && jobsRes.data.jobs ? jobsRes.data.jobs : [];
  const documents = docStatusRes.response.ok && docStatusRes.data.success ? docStatusRes.data.documents : [];
  const summary = docStatusRes.response.ok && docStatusRes.data.success ? docStatusRes.data.summary : null;

  return { documents, summary, emailJobs };
};

export const useProcessingStatus = (
  userId: string | undefined, 
  enabled: boolean = true,
  pollingInterval?: number | false
) => {
  return useQuery({
    queryKey: ["processingStatus", userId],
    queryFn: () => fetchProcessingStatus(userId!),
    staleTime: 10 * 1000, // Fresh for 10 seconds (real-time data)
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 2,
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
    refetchInterval: pollingInterval, // Auto-poll when set
  });
};

// Hook for polling when there are processing documents
export const useProcessingStatusPolling = (
  userId: string | undefined,
  isProcessing: boolean,
  intervalMs: number = 10000
) => {
  return useQuery({
    queryKey: ["processingStatus", userId],
    queryFn: () => fetchProcessingStatus(userId!),
    staleTime: 5 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    enabled: !!userId && isProcessing,
    refetchInterval: isProcessing ? intervalMs : false,
    refetchOnWindowFocus: false,
  });
};

export const useRetryDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      driveFileId,
      ocrStatus,
    }: {
      userId: string;
      driveFileId: string;
      ocrStatus: string;
    }) => {
      if (ocrStatus === "PENDING") {
        const { data, response } = await api.processDocuments(userId);
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Failed to start processing");
        }
        return data;
      } else {
        const { data, response } = await retryDocumentsSecure(userId, undefined, [driveFileId]);
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Failed to retry document");
        }
        return data;
      }
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
      queryClient.invalidateQueries({ queryKey: ["pendingDocuments", userId] });
    },
  });
};

export const useRetryAllFailed = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, response } = await retryDocumentsSecure(userId);
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to retry documents");
      }
      return data;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
    },
  });
};

export const useRetryJob = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, userId }: { jobId: string; userId: string }) => {
      const { data, response } = await retryProcessingJob(jobId);
      if (!response.ok) {
        throw new Error("Failed to retry job");
      }
      return { data, userId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["processingStatus", result.userId] });
    },
  });
};

export const useSyncToAI = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, response } = await api.syncChatDocuments(userId);
      if (!response.ok) {
        throw new Error((data as any).message || "Failed to sync to AI");
      }
      return data;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
    },
  });
};

export type { DocumentRecord, DocumentSummary, ProcessingStatusData };
