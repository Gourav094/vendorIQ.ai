import { useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  resetEmailSync, 
  resetOcrProcessing, 
  resetAiDatabase, 
  hardReset 
} from "@/services/api";

export const useResetEmailSync = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => resetEmailSync(userId),
    onSuccess: (_, userId) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["syncStatus", userId] });
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
    },
  });
};

export const useResetOcrProcessing = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => resetOcrProcessing(userId),
    onSuccess: (_, userId) => {
      // Invalidate processing status
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
    },
  });
};

export const useResetAiDatabase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => resetAiDatabase(userId),
    onSuccess: (_, userId) => {
      // Invalidate chat stats and processing status
      queryClient.invalidateQueries({ queryKey: ["chatStats", userId] });
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
    },
  });
};

export const useHardReset = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, confirmDelete }: { userId: string; confirmDelete: boolean }) => 
      hardReset(userId, confirmDelete),
    onSuccess: (_, { userId }) => {
      // Invalidate all user-related queries
      queryClient.invalidateQueries({ queryKey: ["syncStatus", userId] });
      queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
      queryClient.invalidateQueries({ queryKey: ["chatStats", userId] });
      queryClient.invalidateQueries({ queryKey: ["vendors", userId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
};
