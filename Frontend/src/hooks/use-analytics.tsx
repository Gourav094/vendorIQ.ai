import { useQuery } from "@tanstack/react-query";

interface AnalyticsApiResponse {
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

// Use API Gateway instead of direct service call
const API_GATEWAY_URL = (import.meta as any).env?.VITE_API_GATEWAY_URL || "http://localhost:4000";

const fetchAnalytics = async (period: string): Promise<AnalyticsApiResponse | null> => {
  const userId = localStorage.getItem("userId");
  
  // userId is REQUIRED by the backend - but don't throw, return null
  if (!userId) {
    console.warn("Analytics: No userId found in localStorage");
    return null;
  }
  
  const url = `${API_GATEWAY_URL}/chat/api/v1/analytics?period=${period}&userId=${userId}`;
  console.log("Fetching analytics:", url);
  
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.log("Analytics API error:", res.status, errorData);
    
    // If no data available, return null instead of throwing
    if (res.status === 400 && (errorData.detail?.includes("No spend data") || errorData.detail?.includes("No spend"))) {
      return null;
    }
    throw new Error(errorData.detail || errorData.message || "Failed to fetch analytics");
  }
  
  const data = await res.json();
  console.log("Analytics data received:", data.success, "invoices:", data.insights?.totalInvoices);
  
  // Check if data has actual content
  if (!data.success || !data.insights || data.insights.totalInvoices === 0) {
    return null;
  }
  
  return data;
};

export const useAnalytics = (period: string = "year") => {
  const userId = localStorage.getItem("userId");
  
  return useQuery({
    queryKey: ["analytics", period, userId],
    queryFn: () => fetchAnalytics(period),
    staleTime: 15 * 60 * 1000, // Data is fresh for 15 minutes
    gcTime: 30 * 60 * 1000, // Cache persists for 30 minutes
    retry: 1, // Only retry once
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    enabled: !!userId, // Only fetch if userId exists
  });
};
