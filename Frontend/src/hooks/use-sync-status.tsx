import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { type SyncStatus, disconnectGoogleAccount } from "@/services/api";

const fetchSyncStatus = async (userId: string): Promise<SyncStatus> => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  const { data, response } = await api.getUserSyncStatus(userId);

  if (!response.ok) {
    throw new Error("Failed to fetch sync status");
  }

  return data;
};

export const useSyncStatus = (userId: string | undefined, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["syncStatus", userId],
    queryFn: () => fetchSyncStatus(userId!),
    staleTime: 40 * 1000, // Fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 2,
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
  });
};

export const useResetSyncStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const [syncResponse] = await Promise.all([
        api.resetUserSyncStatus(userId),
        api.clearInvoiceProcessingStatus(userId),
      ]);

      if (!syncResponse.response.ok) {
        throw new Error("Failed to reset sync status");
      }

      return syncResponse.data;
    },
    onSuccess: (_, userId) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["syncStatus", userId] });
      queryClient.invalidateQueries({ queryKey: ["pendingDocuments", userId] });
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
    },
  });
};

export const useDisconnectGoogle = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, response } = await disconnectGoogleAccount(userId);

      if (!response.ok) {
        throw new Error((data as any).message || "Failed to disconnect");
      }

      return data;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ["syncStatus", userId] });
    },
  });
};
