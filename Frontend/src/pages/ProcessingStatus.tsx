import { useEffect, useState } from "react";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    listProcessingJobs,
    getRetryableJobs,
    retryProcessingJob,
    getInvoiceProcessingStatus,
    getInvoiceProcessingStatusSummary,
    retryDocumentsSecure,
    type ProcessingJob,
    type InvoiceProcessingStatus,
    type InvoiceStatusSummaryResponse
} from "@/services/api";
import api from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
    RefreshCw,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    FileText,
    Loader2,
    ChevronDown,
    ChevronUp,
    LucidePersonStanding,
    LoaderIcon,
    ExternalLink,
    Sparkles
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function ProcessingStatus() {
    const { userId: contextUserId } = useUser();
    const { user: authUser } = useAuth();
    const userId = authUser?.id || contextUserId;
    const [searchParams, setSearchParams] = useSearchParams();

    const { toast } = useToast();

    // Get active tab from URL, default to "invoices" (changed from "jobs")
    const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") || "invoices");

    const [emailJobs, setEmailJobs] = useState<ProcessingJob[]>([]);
    const [invoiceSummary, setInvoiceSummary] = useState<InvoiceStatusSummaryResponse | null>(null);
    const [selectedJob, setSelectedJob] = useState<ProcessingJob | null>(null);
    const [allInvoices, setAllInvoices] = useState<InvoiceProcessingStatus[]>([]);
    const [selectedInvoices, setSelectedInvoices] = useState<InvoiceProcessingStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState<string | null>(null);
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);

    // Update URL when tab changes
    const handleTabChange = (value: string) => {
        setActiveTab(value);
        setSearchParams({ tab: value });
    };

    useEffect(() => {
        if (userId) {
            loadStatus();
        } else {
            // Give it some time to load userId from context/auth
            const timer = setTimeout(() => {
                setLoading(false);
            }, 1500);

            return () => clearTimeout(timer);
        }
    }, [userId]);

    const loadStatus = async () => {
        if (!userId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            // Load email processing jobs and invoice data
            const [jobsRes, invoiceRes, allInvoicesRes] = await Promise.all([
                listProcessingJobs(userId, { limit: 50 }),
                getInvoiceProcessingStatusSummary(userId),
                getInvoiceProcessingStatus(userId) // Load all invoices without status filter
            ]);

            if (jobsRes.response.ok && jobsRes.data.jobs) {
                setEmailJobs(jobsRes.data.jobs);
            }

            if (invoiceRes.response.ok && invoiceRes.data.success) {
                setInvoiceSummary(invoiceRes.data);
            }

            if (allInvoicesRes.response.ok && allInvoicesRes.data.success) {
                // Flatten all invoices from all statuses
                const invoices = Object.values(allInvoicesRes.data.by_status).flat();
                setAllInvoices(invoices);
            }
        } catch (error) {
            console.error("Failed to load processing status:", error);
            toast({
                description: "Failed to load processing status. Please try again."
            });
        } finally {
            setLoading(false);
        }
    };

    const handleRetryJob = async (jobId: string) => {
        setRetrying(jobId);
        try {
            const { data, response } = await retryProcessingJob(jobId);

            if (response.ok) {
                toast({
                    description: "The job has been queued for retry. Refresh to see updated status."
                });

                // Refresh data
                await loadStatus();
            } else {
                throw new Error("Failed to retry job");
            }
        } catch (error: any) {
            toast({
                description: error.message || "Could not retry the job."
            });
        } finally {
            setRetrying(null);
        }
    };

    const handleRetryInvoice = async (driveFileId: string, status: string) => {
        if (!userId) return;

        setRetrying(driveFileId);
        try {
            // For PENDING documents, trigger initial processing
            // For FAILED documents, use retry endpoint
            if (status === "PENDING") {
                // Trigger processing for pending document
                const { data, response } = await api.processDocuments(userId);

                if (response.ok && data.success) {
                    toast({
                        description: "Document processing has been initiated. Check status for updates."
                    });
                    await loadStatus();
                } else {
                    throw new Error(data.message || "Failed to start document processing");
                }
            } else {
                // FAILED documents - use retry endpoint
                const { data, response } = await retryDocumentsSecure(userId, undefined, [driveFileId]);

                if (response.ok && data.success) {
                    toast({
                        description: data.message || "Document retry has been queued for processing."
                    });
                    await loadStatus();
                } else {
                    throw new Error(data.message || "Failed to retry document");
                }
            }
        } catch (error: any) {
            toast({
                description: error.message || "Could not process the document."
            });
        } finally {
            setRetrying(null);
        }
    };

    const handleRetryAllFailed = async () => {
        if (!userId) return;

        setRetrying("all-failed");
        try {
            const { data, response } = await retryDocumentsSecure(userId);

            if (response.ok && data.success) {
                toast({
                    description: `Retried ${data.retried} documents. Check status for updates.`
                });
                await loadStatus();
            } else {
                throw new Error(data.message || "Failed to retry documents");
            }
        } catch (error: any) {
            toast({
                description: error.message || "Could not retry documents."
            });
        } finally {
            setRetrying(null);
        }
    };

    const handleRetryVendor = async (vendorName: string) => {
        if (!userId) return;

        setRetrying(`vendor-${vendorName}`);
        try {
            const { data, response } = await retryDocumentsSecure(userId, vendorName);

            if (response.ok && data.success) {
                toast({
                    description: `Retried ${data.retried} documents for ${vendorName}.`
                });
                await loadStatus();
            } else {
                throw new Error(data.message || "Failed to retry vendor documents");
            }
        } catch (error: any) {
            toast({
                description: error.message || "Could not retry vendor documents."
            });
        } finally {
            setRetrying(null);
        }
    };

    const handleSyncToAI = async () => {
        if (!userId) return;

        setSyncing(true);
        try {
            const { data, response } = await api.loadChatKnowledge(userId, true);

            if (response.ok) {
                toast({
                    description: data.message || "Completed invoices have been synced to AI knowledge base. You can now use Chat and Analytics."
                });
            } else {
                throw new Error((data as any).message || "Failed to sync to AI");
            }
        } catch (error: any) {
            toast({
                description: error.message || "Could not sync to AI knowledge base."
            });
        } finally {
            setSyncing(false);
        }
    };

    const loadInvoiceDetails = async (status: string) => {
        if (!userId) return;

        try {
            const { data, response } = await getInvoiceProcessingStatus(userId, undefined, status);

            if (response.ok && data.success) {
                const invoices = data.by_status[status] || [];
                setSelectedInvoices(invoices);
            }
        } catch (error) {
            console.error("Failed to load invoice details:", error);
        }
    };

    const getStatusBadge = (status: string) => {
        const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", icon: any }> = {
            PENDING: { variant: "secondary", icon: Clock },
            PROCESSING: { variant: "default", icon: Loader2 },
            COMPLETED: { variant: "outline", icon: CheckCircle2 },
            FAILED: { variant: "destructive", icon: XCircle },
            // Email job statuses (different from invoice statuses)
            RETRY_PENDING: { variant: "secondary", icon: RefreshCw },
        };

        const config = variants[status] || { variant: "secondary" as const, icon: AlertCircle };
        const Icon = config.icon;

        return (
            <Badge variant={config.variant} className="gap-1 border-0">
                <Icon className={`h-3 w-3 ${status === "PROCESSING" ? "animate-spin" : ""}`} />
                {status.replace(/_/g, " ")}
            </Badge>
        );
    };

    if (loading) {
        return (
            <div className="container py-8 space-y-6">
                <Skeleton className="h-12 w-64" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    if (!userId) {
        return (
            <div className="container py-8">
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        No user found. Please log in to view processing status.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div className="container py-8 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Processing Status</h1>
                    <p className="text-muted-foreground">Monitor and retry failed processing jobs</p>
                </div>
                <div className="flex gap-2">
                    {invoiceSummary && invoiceSummary.by_status["COMPLETED"] > 0 && (
                        <Button 
                            onClick={handleSyncToAI} 
                            disabled={syncing}
                            variant="default"
                        >
                            {syncing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Sparkles className="h-4 w-4 mr-2" />
                            )}
                            Sync to AI
                        </Button>
                    )}
                    <Button onClick={loadStatus} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="invoices">Invoice Processing</TabsTrigger>
                    <TabsTrigger value="jobs">Email Fetch Jobs</TabsTrigger>
                </TabsList>

                <TabsContent value="jobs" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Email Fetch Jobs</CardTitle>
                            <CardDescription>
                                View all email fetch operations and their status
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {emailJobs.length === 0 ? (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        No email fetch jobs found. Start by syncing emails from the Email Sync page.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <div className="rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[50px]"></TableHead>
                                                <TableHead>Job ID</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Progress</TableHead>
                                                <TableHead>Created</TableHead>
                                                <TableHead>Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {emailJobs.map((job) => (
                                                <>
                                                    <TableRow key={job.jobId}>
                                                        <TableCell>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => setExpandedRowId(expandedRowId === job.jobId ? null : job.jobId)}
                                                            >
                                                                {expandedRowId === job.jobId ? (
                                                                    <ChevronUp className="h-4 w-4" />
                                                                ) : (
                                                                    <ChevronDown className="h-4 w-4" />
                                                                )}
                                                            </Button>
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs">{job.jobId.slice(0, 24)}...</TableCell>
                                                        <TableCell>{job.jobType.replace(/_/g, " ")}</TableCell>
                                                        <TableCell>{getStatusBadge(job.status)}</TableCell>
                                                        <TableCell>
                                                            {job.progress && (
                                                                <div className="text-sm">
                                                                    <span className="text-green-600 dark:text-green-400">{job.progress.completed}</span>
                                                                    {" / "}
                                                                    <span>{job.progress.total}</span>
                                                                    {job.progress.failed > 0 && (
                                                                        <span className="text-red-600 dark:text-red-400 ml-2">
                                                                            ({job.progress.failed} failed)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                                                        </TableCell>
                                                        <TableCell>
                                                            {job.status === "FAILED" && job.error?.retryable && job.retryCount < job.maxRetries && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => handleRetryJob(job.jobId)}
                                                                    disabled={retrying === job.jobId}
                                                                >
                                                                    {retrying === job.jobId ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                                    ) : (
                                                                        <RefreshCw className="h-4 w-4 mr-2" />
                                                                    )}
                                                                    Retry ({job.retryCount}/{job.maxRetries})
                                                                </Button>
                                                            )}
                                                            {job.status === "FAILED" && job.retryCount >= job.maxRetries && (
                                                                <span className="text-sm text-muted-foreground">Max retries reached</span>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                    {expandedRowId === job.jobId && (
                                                        <TableRow>
                                                            <TableCell colSpan={7} className="bg-muted/50">
                                                                <div className="p-4 space-y-3">
                                                                    <div>
                                                                        <h4 className="font-semibold mb-2">Filters</h4>
                                                                        <pre className="text-xs bg-background p-3 rounded border overflow-auto">
                                                                            {JSON.stringify(job.payload, null, 2)}
                                                                        </pre>
                                                                    </div>
                                                                    {job.result && (
                                                                        <div>
                                                                            <h4 className="font-semibold mb-2">Result</h4>
                                                                            <pre className="text-xs bg-background p-3 rounded border overflow-auto">
                                                                                {JSON.stringify(job.result, null, 2)}
                                                                            </pre>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="invoices" className="space-y-4">
                    {/* Pending Analytics */}
                    {invoiceSummary && invoiceSummary.by_status["PENDING"] > 0 && (
                        <Card className="border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950/20">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                                    Pending Queue
                                </CardTitle>
                                <CardDescription>
                                    Documents waiting to be processed
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                                        {invoiceSummary.by_status["PENDING"]} invoices
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        These documents are pending. Click "Retry" button below to start processing.
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Failed Documents Alert with Retry */}
                    {invoiceSummary && invoiceSummary.retryable > 0 && (
                        <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                                        Failed Documents
                                    </div>
                                    <Button
                                        size="sm"
                                        onClick={handleRetryAllFailed}
                                        disabled={retrying === "all-failed"}
                                        variant="outline"
                                        className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                                    >
                                        {retrying === "all-failed" ? (
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                        )}
                                        Retry All Failed
                                    </Button>
                                </CardTitle>
                                <CardDescription>
                                    {invoiceSummary.retryable} document{invoiceSummary.retryable !== 1 ? 's' : ''} failed and can be retried
                                </CardDescription>
                            </CardHeader>
                        </Card>
                    )}

                    {/* Summary Cards */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {invoiceSummary && (
                            <>
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{invoiceSummary.total}</div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                                            Completed
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                                            {invoiceSummary.by_status["COMPLETED"] || 0}
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                                            <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                                            Failed
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                                            {(invoiceSummary.by_status["OCR_FAILED"] || 0) + (invoiceSummary.by_status["CHAT_FAILED"] || 0)}
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                                            <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                                            Pending
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                                            {invoiceSummary.by_status["PENDING"] || 0}
                                        </div>
                                    </CardContent>
                                </Card>
                            </>
                        )}
                    </div>

                    {/* Invoice Documents List with Retry Buttons */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Invoice Documents</CardTitle>
                            <CardDescription>All invoice documents with their processing status</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                </div>
                            ) : allInvoices.length === 0 ? (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        No invoice documents found. Fetch emails to start processing.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <div className="space-y-3">
                                    {allInvoices.map((invoice) => (
                                        <div
                                            key={invoice.drive_file_id}
                                            className="border rounded-lg p-4 space-y-2 hover:bg-accent/50 transition-colors"
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-normal">{invoice.file_name}</span>
                                                        <span className="text-xs text-muted-foreground">• {invoice.vendor_name}</span>
                                                        {getStatusBadge(invoice.status)}
                                                    </div>

                                                    {invoice.status === "PENDING" && (
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            Ready to process - use Retry button to start
                                                        </p>
                                                    )}

                                                    {invoice.status === "PROCESSING" && (
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            Currently being processed...
                                                        </p>
                                                    )}

                                                    {invoice.status === "FAILED" && invoice.errors.length > 0 && (
                                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                            Processing failed • OCR Attempts: {invoice.ocr_attempt_count} • AI Attempts: {invoice.chat_attempt_count}
                                                        </p>
                                                    )}

                                                    {invoice.status === "COMPLETED" && (
                                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                                            Successfully processed
                                                        </p>
                                                    )}
                                                </div>

                                                <div className="flex gap-2">
                                                    {/* Retry button for FAILED and PENDING status */}
                                                    {(invoice.status === "FAILED" || invoice.status === "PENDING") && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleRetryInvoice(invoice.drive_file_id, invoice.status)}
                                                            disabled={retrying === invoice.drive_file_id}
                                                            className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30"
                                                        >
                                                            {retrying === invoice.drive_file_id ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <>
                                                                    <RefreshCw className="h-4 w-4 mr-1" />
                                                                    {invoice.status === "PENDING" ? "Start Processing" : "Retry Manually"}
                                                                </>
                                                            )}
                                                        </Button>
                                                    )}
                                                    {invoice.web_view_link && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => window.open(invoice.web_view_link, "_blank")}
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Invoice Details Dialog */}
            <Dialog open={selectedInvoices.length > 0} onOpenChange={() => setSelectedInvoices([])}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Invoice Processing Details</DialogTitle>
                        <DialogDescription>
                            {selectedInvoices.length} invoices with status: {selectedInvoices[0]?.status}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {selectedInvoices.map((invoice) => (
                            <Card key={invoice.drive_file_id}>
                                <CardHeader className="pb-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="text-base">{invoice.file_name}</CardTitle>
                                            <CardDescription>{invoice.vendor_name}</CardDescription>
                                        </div>
                                        {getStatusBadge(invoice.status)}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="flex gap-4 text-sm">
                                        <div>
                                            <span className="text-muted-foreground">OCR Attempts:</span>
                                            <span className="ml-2 font-medium">{invoice.ocr_attempt_count}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">AI Attempts:</span>
                                            <span className="ml-2 font-medium">{invoice.chat_attempt_count}</span>
                                        </div>
                                    </div>
                                    {invoice.errors.length > 0 && (
                                        <div>
                                            <h5 className="text-sm font-semibold mb-2">Errors:</h5>
                                            {invoice.errors.map((error, idx) => (
                                                <Alert key={idx} variant="destructive" className="mb-2">
                                                    <XCircle className="h-4 w-4" />
                                                    <AlertDescription>
                                                        <div className="font-medium">{error.phase.toUpperCase()}: {error.message}</div>
                                                        <div className="text-xs mt-1">
                                                            {formatDistanceToNow(new Date(error.timestamp), { addSuffix: true })}
                                                            {error.retryable && <span className="ml-2 text-yellow-600">(Retryable)</span>}
                                                        </div>
                                                    </AlertDescription>
                                                </Alert>
                                            ))}
                                        </div>
                                    )}
                                    {invoice.web_view_link && (
                                        <a
                                            href={invoice.web_view_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-primary hover:underline"
                                        >
                                            View in Google Drive →
                                        </a>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
