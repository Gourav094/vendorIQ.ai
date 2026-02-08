import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  FileText, 
  RefreshCw, 
  Download, 
  ExternalLink, 
  Calendar, 
  Loader2, 
  AlertCircle,
  ArrowLeft,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { type MasterRecord } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useInvoices } from "@/hooks/use-invoices";
import { useExchangeRates, BASE_CURRENCY } from "@/hooks/use-exchange-rates";

const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const Invoices = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  
  const userId = user?.id || "";
  
  // Get vendor from URL params or localStorage
  const urlVendorId = searchParams.get("vendorId");
  const urlVendorName = searchParams.get("vendorName");
  
  const [vendorId] = useState(() => {
    if (urlVendorId) {
      localStorage.setItem('lastVendorId', urlVendorId);
      if (urlVendorName) {
        localStorage.setItem('lastVendorName', urlVendorName);
      }
      return urlVendorId;
    }
    return localStorage.getItem('lastVendorId') || "";
  });
  
  const [vendorName] = useState(() => {
    if (urlVendorName) {
      return urlVendorName;
    }
    return localStorage.getItem('lastVendorName') || "";
  });

  // React Query hooks
  const { 
    data: invoicesData, 
    isLoading, 
    isFetching,
    refetch 
  } = useInvoices(userId, vendorId);

  const {
    data: ratesData,
    isLoading: ratesLoading,
    error: ratesError,
  } = useExchangeRates(true);

  const invoices = invoicesData?.invoices ?? [];
  const masterSummary = invoicesData?.masterSummary ?? null;
  const masterError = invoicesData?.masterError ?? null;
  const exchangeRates = ratesData?.rates ?? null;
  const ratesTimestamp = ratesData?.timestamp ?? null;

  const [searchQuery, setSearchQuery] = useState("");
  const [currencyPreference, setCurrencyPreference] = useState<SupportedCurrency>(BASE_CURRENCY);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) {
      toast({
        description: "Please log in to view invoices",
        variant: "destructive",
      });
      navigate('/login');
    }
  }, [user, navigate, toast]);

  // Show toast when master summary is loaded
  useEffect(() => {
    if (masterSummary?.records?.length) {
      toast({
        description: `Loaded ${masterSummary.records.length} processed invoice ${
          masterSummary.records.length === 1 ? "entry" : "entries"
        } from master.json`,
      });
    }
  }, [masterSummary?.records?.length]);

  const openInvoice = (webViewLink: string, fileName: string) => {
    window.open(webViewLink, '_blank', 'noopener,noreferrer');
    toast({
      description: `Opening ${fileName} in a new tab`,
    });
  };

  const downloadInvoice = (webContentLink: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = webContentLink;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({
      description: `Downloading ${fileName} to your device`,
    });
  };

  // Exclude master.json (the processed summary file) from the invoice list display
  const filteredInvoices = invoices
    .filter(inv => inv.name.toLowerCase() !== 'master.json')
    .filter(invoice => invoice.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Pagination (7 per page)
  const PAGE_SIZE = 7;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const paginatedInvoices = filteredInvoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [filteredInvoices.length, totalPages, page]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatFileSize = (size?: string) => {
    if (!size) return "N/A";
    const bytes = parseInt(size);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const masterRecords = masterSummary?.records ?? [];

  const getRecordField = (record: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  };

  const parseAmount = (value: unknown) => {
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[^0-9.-]/g, "");
      const amount = Number(cleaned);
      return Number.isNaN(amount) ? 0 : amount;
    }
    return 0;
  };

  const inferCurrency = (record: Record<string, unknown>) => {
    const currencyValue = getRecordField(record, ["currency", "currency_code", "currencyCode"]);
    if (typeof currencyValue === "string" && currencyValue.length === 3) {
      return currencyValue.toUpperCase();
    }
    return BASE_CURRENCY;
  };

  const formatAmount = (amount: number, currencyCode: string) => {
    const normalizedCurrency = typeof currencyCode === "string" && currencyCode.length === 3
      ? currencyCode.toUpperCase()
      : BASE_CURRENCY;
    try {
      const locale = normalizedCurrency === "INR" ? "en-IN" : "en-US";
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: normalizedCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  };

  const convertToBase = (amount: number, sourceCurrency: string) => {
    if (!Number.isFinite(amount)) return { value: 0, available: false } as const;
    if (sourceCurrency === BASE_CURRENCY) {
      return { value: amount, available: true } as const;
    }

    const rate = exchangeRates?.[sourceCurrency];
    if (!rate || rate === 0) {
      return { value: amount, available: false } as const;
    }

    return { value: amount / rate, available: true } as const;
  };

  const convertFromBase = (amount: number, targetCurrency: SupportedCurrency) => {
    if (!Number.isFinite(amount)) return { value: 0, available: false } as const;
    if (targetCurrency === BASE_CURRENCY) {
      return { value: amount, available: true } as const;
    }

    const rate = exchangeRates?.[targetCurrency];
    if (!rate || rate === 0) {
      return { value: amount * (rate || 0), available: false } as const;
    }

    return { value: amount * rate, available: true } as const;
  };

  type AnalyticsRow = {
    invoiceNumber: string;
    invoiceDateDisplay: string;
    dueDateDisplay: string;
    dueDateRaw: Date | null;
    rawAmount: number;
    sourceCurrency: string;
    baseAmount: number;
    baseAvailable: boolean;
    displayAmount: number;
    displayCurrency: string;
    displayAvailable: boolean;
    processedDisplay: string;
    record: MasterRecord;
  };

  const analyticsRows: AnalyticsRow[] = masterRecords.map((record) => {
    const invoiceNumber = getRecordField(record, [
      "invoice_number",
      "invoiceNumber",
      "invoice_no",
      "invoiceNo",
      "invoice_id",
    ]);
    const invoiceDateValue = getRecordField(record, ["invoice_date", "invoiceDate", "date"]);
    const dueDateValue = getRecordField(record, ["due_date", "dueDate"]);
    const totalAmount = parseAmount(
      getRecordField(record, ["total_amount", "totalAmount", "amount_due", "amountDue", "grand_total", "grandTotal"])
    );
    const processedAtValue = getRecordField(record, ["processed_at", "processedAt"]);
    const sourceCurrency = inferCurrency(record);

    const dueDateRaw = dueDateValue ? new Date(String(dueDateValue)) : null;
    const baseConversion = convertToBase(totalAmount, sourceCurrency);
    const targetConversion = convertFromBase(baseConversion.value, currencyPreference);

    const displayAvailable = baseConversion.available && targetConversion.available;
    const displayCurrency = displayAvailable ? currencyPreference : sourceCurrency;
    const displayAmount = displayAvailable ? targetConversion.value : totalAmount;

    return {
      invoiceNumber: invoiceNumber ? String(invoiceNumber) : "N/A",
      invoiceDateDisplay: invoiceDateValue ? formatDate(String(invoiceDateValue)) : "N/A",
      dueDateDisplay: dueDateValue ? formatDate(String(dueDateValue)) : "N/A",
      dueDateRaw,
      rawAmount: totalAmount,
      sourceCurrency,
      baseAmount: baseConversion.value,
      baseAvailable: baseConversion.available,
      displayAmount,
      displayCurrency,
      displayAvailable,
      processedDisplay: processedAtValue ? formatDate(String(processedAtValue)) : "N/A",
      record,
    };
  });

  const conversionEligibleRows = analyticsRows.filter((item) => item.displayAvailable);

  const totalAmountSum = conversionEligibleRows.reduce((sum, item) => sum + item.displayAmount, 0);
  const averageInvoiceValue = conversionEligibleRows.length
    ? totalAmountSum / conversionEligibleRows.length
    : 0;

  const conversionUnavailableCount = analyticsRows.length - conversionEligibleRows.length;
  const aggregateCurrency = currencyPreference;

  const currencyOptions: { value: SupportedCurrency; label: string }[] = SUPPORTED_CURRENCIES.map((code) => ({
    value: code,
    label: code === BASE_CURRENCY ? `${code} (Base)` : code,
  }));

  const isMasterLoading = isLoading;

  const analyticsCard =
    (isMasterLoading || masterSummary || masterError) && (
      <Card>
        <CardHeader className="flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Vendor Analytics</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Insights derived from OCR processed invoices for this vendor.
            </CardDescription>
          </div>
          {!masterError && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <Label htmlFor="currency-select" className="text-xs uppercase text-muted-foreground whitespace-nowrap">
                Currency
              </Label>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select
                  value={currencyPreference}
                  onValueChange={(value) => setCurrencyPreference(value as SupportedCurrency)}
                  disabled={ratesLoading}
                >
                  <SelectTrigger id="currency-select" className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ratesLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                )}
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isMasterLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : masterError ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-foreground mb-1">No Analytics Available</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Invoice data hasn't been processed yet. Process documents via OCR to see analytics.
              </p>
            </div>
          ) : masterSummary && (
            <>
              {ratesError && (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="break-words">{ratesError.message}</span>
                </div>
              )}
              {ratesTimestamp && !ratesError && (
                <p className="text-xs text-muted-foreground break-words">
                  Rates updated: {ratesTimestamp} (base {BASE_CURRENCY})
                </p>
              )}
              {conversionUnavailableCount > 0 && !ratesError && !ratesLoading && (
                <p className="text-xs text-muted-foreground">
                  Missing exchange rates for {conversionUnavailableCount} invoice
                  {conversionUnavailableCount === 1 ? "" : "s"}. Those amounts remain in their
                  original currency.
                </p>
              )}
              <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border px-3 py-2.5 sm:px-4 sm:py-3">
                  <p className="text-[10px] sm:text-xs uppercase text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">Processed Invoices</p>
                  <p className="mt-1 text-xl sm:text-2xl font-semibold">{analyticsRows.length}</p>
                </div>
                <div className="rounded-md border px-3 py-2.5 sm:px-4 sm:py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] sm:text-xs uppercase text-muted-foreground whitespace-nowrap">Total Amount</p>
                    <span className="font-mono text-[9px] sm:text-[10px] text-muted-foreground/80 flex-shrink-0">{aggregateCurrency}</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-semibold break-words overflow-hidden">
                    {conversionEligibleRows.length
                      ? formatAmount(totalAmountSum, aggregateCurrency)
                      : "N/A"}
                  </p>
                </div>
                <div className="rounded-md border px-3 py-2.5 sm:px-4 sm:py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] sm:text-xs uppercase text-muted-foreground whitespace-nowrap">Average Invoice</p>
                    <span className="font-mono text-[9px] sm:text-[10px] text-muted-foreground/80 flex-shrink-0">{aggregateCurrency}</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-semibold break-words overflow-hidden">
                    {conversionEligibleRows.length
                      ? formatAmount(averageInvoiceValue, aggregateCurrency)
                      : "N/A"}
                  </p>
                </div>
                <div className="rounded-md border px-3 py-2.5 sm:px-4 sm:py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] sm:text-xs uppercase text-muted-foreground whitespace-nowrap">Master Updated</p>
                  </div>
                  <p className="font-mono text-[9px] sm:text-[10px] text-muted-foreground/80 flex-shrink-0">
                    {masterSummary.updatedAt ? formatDate(masterSummary.updatedAt) : "Not available"}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 mt-6 sm:px-6">
                <div className="inline-block min-w-full align-middle">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b text-left text-[10px] sm:text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-2 sm:pr-4 whitespace-nowrap">Invoice #</th>
                        <th className="py-2 pr-2 sm:pr-4 whitespace-nowrap">Invoice Date</th>
                        <th className="py-2 pr-2 sm:pr-4 whitespace-nowrap">Due Date</th>
                        <th className="py-2 pr-2 sm:pr-4 whitespace-nowrap">Total</th>
                        <th className="py-2 pr-2 sm:pr-4 whitespace-nowrap">Processed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsRows.map((row, index) => (
                        <tr key={`master-row-${index}`} className="border-b last:border-b-0">
                          <td className="py-2 pr-2 sm:pr-4 font-mono text-[10px] sm:text-xs whitespace-nowrap">{row.invoiceNumber}</td>
                          <td className="py-2 pr-2 sm:pr-4 whitespace-nowrap">{row.invoiceDateDisplay}</td>
                          <td className="py-2 pr-2 sm:pr-4 whitespace-nowrap">{row.dueDateDisplay}</td>
                          <td className="py-2 pr-2 sm:pr-4 whitespace-nowrap">
                            {row.displayAvailable ? (
                              formatAmount(row.displayAmount, row.displayCurrency)
                            ) : (
                              <span className="text-[10px] sm:text-xs text-muted-foreground">
                                {formatAmount(row.rawAmount, row.sourceCurrency)}
                                <span className="ml-1">(rate unavailable)</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-2 sm:pr-4 whitespace-nowrap">{row.processedDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {analyticsRows.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Master file available but no structured invoice data detected yet.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => navigate('/vendors')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
            <p className="text-muted-foreground mt-1">
              {vendorName ? `Viewing invoices for ${vendorName}` : "View invoice files from Google Drive"}
            </p>
          </div>
        </div>
        <Button onClick={() => refetch()} disabled={isLoading || isFetching || !vendorId}>
          <RefreshCw className={`mr-2 h-4 w-4 ${(isLoading || isFetching) ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Vendor Info Badge */}
      {vendorName && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="px-3 py-1 text-sm">
            Vendor: {vendorName}
          </Badge>
          {!urlVendorId && vendorId && (
            <Badge variant="secondary" className="px-3 py-1 text-xs">
              📌 Last viewed
            </Badge>
          )}
        </div>
      )}

      {analyticsCard}

      {/* Search Bar */}
      {invoices.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      )}

      {/* Invoices List */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading invoices...</p>
            </div>
          </CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-10 px-6">
            {invoices.length === 0 ? (
              <div className="flex flex-col items-center text-center">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <FileText className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Invoices Available</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md">
                  {vendorId 
                    ? `No invoice files found for ${vendorName || 'this vendor'}.`
                    : "Select a vendor to view invoices."}
                </p>
                {vendorId && (
                  <p className="text-xs text-muted-foreground mb-4">
                    Try syncing emails or check if files exist in Google Drive.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button onClick={() => navigate('/vendors')} variant="outline" size="sm">
                    Browse Vendors
                  </Button>
                  {vendorId && (
                    <Button onClick={() => navigate('/email-sync')} size="sm">
                      Go to Email Sync
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Search className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Matches Found</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  No invoices match "{searchQuery}"
                </p>
                <Button onClick={() => setSearchQuery("")} variant="outline" size="sm">
                  Clear Search
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {paginatedInvoices.map((invoice, index) => (
              <Card
                key={invoice.id}
                className="hover:shadow-md transition-all animate-in fade-in slide-in-from-left-4"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{invoice.name}</h3>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          {invoice.createdTime && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(invoice.createdTime)}
                            </span>
                          )}
                          {invoice.size && (
                            <span>{formatFileSize(invoice.size)}</span>
                          )}
                          <span className="font-mono truncate">{invoice.id.substring(0, 10)}...</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openInvoice(invoice.webViewLink, invoice.name)}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => downloadInvoice(invoice.webContentLink, invoice.name)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Invoices;
