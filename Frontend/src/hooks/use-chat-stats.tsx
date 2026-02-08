import { useQuery } from "@tanstack/react-query";
import { getChatStats } from "@/services/api";

interface ChatStatsData {
  indexed: number;
  total: number;
}

const fetchChatStats = async (userId: string): Promise<ChatStatsData> => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  const { data, response } = await getChatStats(userId);

  if (!response.ok) {
    throw new Error("Failed to fetch chat stats");
  }

  return data;
};

export const useChatStats = (userId: string | undefined, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["chatStats", userId],
    queryFn: () => fetchChatStats(userId!),
    staleTime: 5 * 60 * 1000, // Fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Cache for 10 minutes
    retry: 2,
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
  });
};
