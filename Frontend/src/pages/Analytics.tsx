import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnalyticsChart } from "@/components/AnalyticsChart";
import { DashboardMetricCard } from "@/components/ui/DashboardMetricCard";
import { TrendingUp, Calendar, IndianRupee, BarChart3, LucideIcon, RefreshCw, FileText, Upload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalytics } from "@/hooks/use-analytics";
import { syncChatDocuments } from "@/services/api";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Insight {
  title: string;
  value: string;
  icon: LucideIcon;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
}

export default function Analytics() {
  const [period, setPeriod] = useState("year");
  const [expandedVendors, setExpandedVendors] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  // Use React Query hook for analytics data
  const { data: analytics, isLoading, isError, error, isFetching, dataUpdatedAt, refetch } = useAnalytics(period);

  // Memoized insight cards
  const insights: Insight[] = useMemo(() => {
    const data = analytics;
    if (!data || data.success === false || !data.insights) {
      return [];
    }
    return [
      {
        title: "Highest Spend",
        value: `₹${(data.insights.highestSpend?.amount || 0).toLocaleString()}`,
        icon: TrendingUp,
        change: data.insights.highestSpend?.vendor || "N/A",
        changeType: "neutral",
      },
      {
        title: "Average Invoice",
        value: `₹${(data.insights.averageInvoice || 0).toLocaleString()}`,
        icon: IndianRupee,
        changeType: "positive",
      },
      {
        title: "Avg Payment Time",
        value: `${(data.insights.avgPaymentTime || 0).toFixed(0)} days`,
        icon: Calendar,
        changeType: "positive",
      },
      {
        title: "Total Spend",
        value: `₹${(data.insights.totalSpend || 0).toLocaleString()}`,
        icon: IndianRupee,
        changeType: "neutral",
      },
      {
        title: "Invoices Indexed",
        value: `${data.insights.totalInvoices || 0}`,
        icon: BarChart3,
        changeType: "neutral",
      },
      {
        title: "Vendors Indexed",
        value: `${data.insights.vendorCount || 0}`,
        icon: BarChart3,
        changeType: "neutral",
      },
    ];
  }, [analytics]);

  // Handle refresh (refetch analytics directly)
  const handleRefresh = async () => {
    if (!user?.id) {
      toast({ description: "Please log in to view analytics", variant: "destructive" });
      return;
    }
    await refetch();
  };

  // Handle sync (index documents then refresh)
  const handleSync = async () => {
    if (!user?.id) {
      toast({ description: "Please log in to sync documents", variant: "destructive" });
      return;
    }

    setIsSyncing(true);
    setSyncMessage(null);

    try {
      const { data, response } = await syncChatDocuments(user.id);
      console.log("Sync response:", { data, status: response.status });
      
      if (response.ok && data.success) {
        toast({ description: data.message || "Documents synced successfully" });
        // Refresh analytics after successful sync
        await refetch();
      } else {
        toast({ description: data.message || "No new documents to sync" });
      }
    } catch (err) {
      toast({ description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  // Format last sync time
  const formatLastSync = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  // Loading state - Skeleton loader
  if (isLoading) {
    return (
      <div className="space-y-8 max-w-full overflow-x-hidden m-2 py-2 md:px-4 animate-pulse">
        {/* Header Skeleton */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-row items-center justify-between">
            <div className="space-y-2">
              <div className="h-10 w-48 bg-muted rounded-md" />
              <div className="h-4 w-64 bg-muted rounded-md" />
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-24 bg-muted rounded-md" />
              <div className="h-9 w-[180px] bg-muted rounded-md" />
            </div>
          </div>
        </div>

        {/* Metric Cards Skeleton */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-card border rounded-lg p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-8 w-8 bg-muted rounded-full" />
              </div>
              <div className="h-8 w-32 bg-muted rounded" />
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="bg-card border rounded-lg p-6 space-y-4">
              <div className="h-5 w-40 bg-muted rounded" />
              <div className="h-[200px] bg-muted rounded-md flex items-center justify-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground/30" />
              </div>
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        <div className="flex items-center justify-center py-4">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading your analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] w-full px-4">
        <div className="flex flex-col items-center gap-6 max-w-lg text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <h2 className="text-2xl font-semibold text-foreground">
            Unable to Load Analytics
          </h2>
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : "Something went wrong while fetching your analytics."}
          </p>
          <Button onClick={handleRefresh} variant="default" size="lg">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // No data available state
  if (!analytics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] w-full my-4 px-4">
        <div className="flex flex-col items-center gap-6 max-w-xl text-center">
          {/* Icon */}
          <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
          </div>

          {/* Title */}
          <h2 className="text-2xl font-semibold text-foreground">
            No Analytics Data Available
          </h2>

          {/* Description */}
          <div className="space-y-3 text-muted-foreground">
            <p>
              We couldn't find any indexed invoice data for your account.
            </p>
            <p className="text-sm">
              To see analytics, you need to:
            </p>
            <ol className="text-sm text-left list-decimal list-inside space-y-2 bg-muted/50 rounded-lg p-4">
              <li><strong>Connect Gmail</strong> — Go to Settings and connect your Google account</li>
              <li><strong>Fetch Emails</strong> — Sync your invoice emails from Gmail</li>
              <li><strong>Process Documents</strong> — Let OCR extract invoice data</li>
              <li><strong>Index Documents</strong> — Click "Sync" in processing status </li>
            </ol>
          </div>

          {/* Sync message */}
          {syncMessage && (
            <div className={`text-sm px-4 py-2 rounded-md ${
              syncMessage.startsWith("✓") 
                ? "bg-green-50 text-green-700 border border-green-200" 
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}>
              {syncMessage}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <Button 
              onClick={handleRefresh} 
              variant="outline" 
              size="lg"
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              {isFetching ? "Refreshing..." : "Refresh"}
            </Button>
            
            <Button 
              onClick={handleSync} 
              variant="default" 
              size="lg"
              disabled={isSyncing}
            >
              <Upload className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-pulse' : ''}`} />
              {isSyncing ? "Syncing..." : "Sync Documents"}
            </Button>

            <Button 
              onClick={() => navigate("/settings")} 
              variant="secondary" 
              size="lg"
            >
              Go to Settings
            </Button>
          </div>

          {/* Help text */}
          <p className="text-xs text-muted-foreground mt-4">
            If you've already processed invoices, click "Sync Documents" to index them for analytics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-full overflow-x-hidden m-2 py-2 md:px-4">
      {/* Header */}
      <div className="flex flex-col md:items- md:justify-between gap-4">
        <div className="flex flex-row items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold">Analytics</h1>
            <p className="mt-2 text-muted-foreground text-xs md:text-sm">
              Deep insights into your spending patterns
            </p>
            {dataUpdatedAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last synced: {formatLastSync(dataUpdatedAt)}
                {isFetching && <span className="ml-2 text-blue-600">• Updating...</span>}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              {isFetching ? "Syncing..." : "Refresh"}
            </Button>
            <Select value={period} onValueChange={(val) => setPeriod(val)}>
              <SelectTrigger className="w-[180px]" data-testid="select-time-period">
                <SelectValue placeholder="Time period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {analytics.llmSummary && (
          <div className="mt-3 text-sm leading-relaxed bg-muted/40 p-3 rounded-lg border">
            <strong className="block mb-1">AI Summary:</strong>
            <span>{analytics.llmSummary}</span>
          </div>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
        {insights.map((insight) => (
          <DashboardMetricCard key={insight.title} {...insight} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        <AnalyticsChart title="Monthly Spending Trend" type="line" data={analytics.monthlyTrend || []} />
        <AnalyticsChart title="Top Vendors by Spend" type="bar" data={analytics.topVendors || []} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <AnalyticsChart title="Spend by Category" type="pie" data={analytics.spendByCategory || []} />
        <AnalyticsChart title="Quarterly Growth" type="bar" data={analytics.quarterlyTrend || []} />
      </div>

      {/* Vendor table */}
      {analytics.topVendors?.length > 0 ? (
        <div className="bg-card border rounded-md p-4">
          <h3 className="text-lg font-semibold mb-3">Vendor Spend (All)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-[480px] w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4 font-medium">Vendor</th>
                  <th className="py-2 pr-4 font-medium">Total Spend (INR)</th>
                  <th className="py-2 pr-4 font-medium">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {(expandedVendors ? analytics.topVendors : analytics.topVendors.slice(0, 10)).map(v => (
                  <tr key={v.name} className="border-b last:border-0">
                    <td className="py-2 pr-4 max-w-[180px] truncate" title={v.name}>{v.name}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">₹{v.value.toLocaleString()}</td>
                    <td className="py-2 pr-4 whitespace-nowrap"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {analytics.topVendors.length > 10 && (
            <button
              className="mt-3 text-xs underline"
              onClick={() => setExpandedVendors(e => !e)}
            >{expandedVendors ? "Show Less" : "Show More"}</button>
          )}
        </div>
      ) : (
        <div className="bg-card border rounded-md p-4 text-sm text-muted-foreground">No vendor spend data yet.</div>
      )}
    </div>
  );
}
