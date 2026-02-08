import { useQuery } from "@tanstack/react-query";
import api, { type PendingDocumentsResponse } from "@/services/api";

const fetchPendingDocuments = async (userId: string): Promise<PendingDocumentsResponse> => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  const { data, response } = await api.getPendingDocuments(userId);

  if (!response.ok) {
    throw new Error("Failed to fetch pending documents");
  }

  return data;
};

export const usePendingDocuments = (userId: string | undefined, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["pendingDocuments", userId],
    queryFn: () => fetchPendingDocuments(userId!),
    staleTime: 30 * 1000, // Fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 2,
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
  });
};
