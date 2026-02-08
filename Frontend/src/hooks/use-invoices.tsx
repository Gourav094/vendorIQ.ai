import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { type Invoice, type MasterSummary } from "@/services/api";

interface InvoicesData {
  invoices: Invoice[];
  total: number;
  masterSummary: MasterSummary | null;
  masterError: string | null;
}

const fetchInvoices = async (userId: string, vendorId: string): Promise<InvoicesData> => {
  if (!userId || !/^[a-f0-9]{24}$/i.test(userId)) {
    throw new Error("Invalid User ID format");
  }

  if (!vendorId) {
    throw new Error("Vendor ID is required");
  }

  const { data, response } = await api.getInvoices(userId, vendorId);

  if (!response.ok) {
    throw new Error(
      (data as any).message ||
      (data as any).details ||
      "Failed to fetch invoices"
    );
  }

  const invoiceData = data as { invoices: Invoice[]; total: number };
  
  // Also fetch master summary
  let masterSummary: MasterSummary | null = null;
  let masterError: string | null = null;

  try {
    const masterRes = await api.getVendorMaster(userId, vendorId);
    if (masterRes.response.ok) {
      masterSummary = masterRes.data;
      if (!masterRes.data.records?.length) {
        masterError = "Master file found but contains no processed invoices yet.";
      }
    } else {
      masterError = (masterRes.data as any).message || masterRes.data.reason || "Master data not available for this vendor yet.";
    }
  } catch (error) {
    masterError = "Unable to load master analytics.";
  }

  return {
    invoices: invoiceData.invoices || [],
    total: invoiceData.total || 0,
    masterSummary,
    masterError,
  };
};

export const useInvoices = (
  userId: string | undefined,
  vendorId: string | undefined,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["invoices", userId, vendorId],
    queryFn: () => fetchInvoices(userId!, vendorId!),
    staleTime: 5 * 60 * 1000, // Fresh for 5 minutes
    gcTime: 15 * 60 * 1000, // Cache for 15 minutes
    retry: 2,
    enabled: enabled && !!userId && !!vendorId && /^[a-f0-9]{24}$/i.test(userId),
    refetchOnWindowFocus: false,
  });
};

export const useInvalidateInvoices = () => {
  const queryClient = useQueryClient();

  return (userId: string, vendorId?: string) => {
    if (vendorId) {
      queryClient.invalidateQueries({ queryKey: ["invoices", userId, vendorId] });
    } else {
      queryClient.invalidateQueries({ queryKey: ["invoices", userId] });
    }
  };
};

export type { InvoicesData };
