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
    retryProcessingJob,
    getDocumentStatus,
    retryDocumentsSecure,
    type ProcessingJob,
} from "@/services/api";
import api from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
    RefreshCw,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Sparkles,
    Database
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Document type from MongoDB (single source of truth)
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

export default function ProcessingStatus() {
    const { userId: contextUserId } = useUser();
    const { user: authUser } = useAuth();
    const userId = authUser?.id || contextUserId;
    const [searchParams, setSearchParams] = useSearchParams();

    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") || "invoices");

    const [emailJobs, setEmailJobs] = useState<ProcessingJob[]>([]);
    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [summary, setSummary] = useState<DocumentSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState<string | null>(null);
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [isPolling, setIsPolling] = useState(false);

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        setSearchParams({ tab: value });
    };

    useEffect(() => {
        if (userId) {
            loadStatus();
        } else {
            const timer = setTimeout(() => {
                setLoading(false);
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [userId]);

    useEffect(() => {
        const hasProcessing = summary && summary.processing > 0;
        
        if (!hasProcessing || !userId) {
            setIsPolling(false);
            return;
        }

        setIsPolling(true);
        const pollInterval = setInterval(() => {
            loadStatusSilent(); // Silent refresh (no loading state)
        }, 10000); // Poll every 10 seconds

        return () => {
            clearInterval(pollInterval);
            setIsPolling(false);
        };
    }, [summary?.processing, userId]);

    const loadStatus = async () => {
        if (!userId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            await fetchDocumentStatus();
        } catch (error) {
            console.error("Failed to load processing status:", error);
            toast({
                description: "Failed to load processing status. Please try again."
            });
        } finally {
            setLoading(false);
        }
    };

    // Silent refresh without loading indicator (for polling)
    const loadStatusSilent = async () => {
        if (!userId) return;
        try {
            await fetchDocumentStatus();
        } catch (error) {
            console.error("Silent refresh failed:", error);
        }
    };

    const fetchDocumentStatus = async () => {
        const [jobsRes, docStatusRes] = await Promise.all([
            listProcessingJobs(userId!, { limit: 50 }),
            getDocumentStatus(userId!),
        ]);

        if (jobsRes.response.ok && jobsRes.data.jobs) {
            setEmailJobs(jobsRes.data.jobs);
        }

        if (docStatusRes.response.ok && docStatusRes.data.success) {
            setDocuments(docStatusRes.data.documents);
            setSummary(docStatusRes.data.summary);
        }
    };

    const handleRetryInvoice = async (driveFileId: string, ocrStatus: string) => {
        if (!userId) return;

        setRetrying(driveFileId);
        try {
            if (ocrStatus === "PENDING") {
                const { data, response } = await api.processDocuments(userId);
                if (response.ok && data.success) {
                    await loadStatus();
                } else {
                    throw new Error(data.message || "Failed to start processing");
                }
            } else {
                const { data, response } = await retryDocumentsSecure(userId, undefined, [driveFileId]);
                if (response.ok && data.success) {
                    toast({ description: data.message || "Document retry queued." });
                    await loadStatus();
                } else {
                    throw new Error(data.message || "Failed to retry document");
                }
            }
        } catch (error: any) {
            toast({ description: error.message || "Could not process the document." });
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
                toast({ description: `Retried ${data.retried} documents.` });
                await loadStatus();
            } else {
                throw new Error(data.message || "Failed to retry documents");
            }
        } catch (error: any) {
            toast({ description: error.message || "Could not retry documents." });
        } finally {
            setRetrying(null);
        }
    };

    const handleSyncToAI = async () => {
        if (!userId) return;
        setSyncing(true);
        try {
            const { data, response } = await api.syncChatDocuments(userId);
            if (response.ok) {
                toast({ description: data.message || "Synced to AI knowledge base." });
                await loadStatus(); // Refresh to show updated indexed status
            } else {
                throw new Error((data as any).message || "Failed to sync to AI");
            }
        } catch (error: any) {
            toast({ description: error.message || "Could not sync to AI." });
        } finally {
            setSyncing(false);
        }
    };

    const handleRetryJob = async (jobId: string) => {
        setRetrying(jobId);
        try {
            const { data, response } = await retryProcessingJob(jobId);
            if (response.ok) {
                toast({ description: "Job queued for retry." });
                await loadStatus();
            } else {
                throw new Error("Failed to retry job");
            }
        } catch (error: any) {
            toast({ description: error.message || "Could not retry the job." });
        } finally {
            setRetrying(null);
        }
    };

    const getOcrStatusBadge = (status: string) => {
        const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", icon: any, className?: string }> = {
            PENDING: { variant: "secondary", icon: Clock },
            PROCESSING: { variant: "default", icon: Loader2 },
            COMPLETED: { variant: "outline", icon: CheckCircle2, className: "text-green-600 border-green-300" },
            FAILED: { variant: "destructive", icon: XCircle },
        };
        const c = config[status] || { variant: "secondary" as const, icon: AlertCircle };
        const Icon = c.icon;
        return (
            <Badge variant={c.variant} className={`gap-1 ${c.className || ""}`}>
                <Icon className={`h-3 w-3 ${status === "PROCESSING" ? "animate-spin" : ""}`} />
                {status}
            </Badge>
        );
    };

    const getIndexedBadge = (indexed: boolean) => {
        return indexed ? (
            <Badge variant="outline" className="gap-1 text-blue-600 border-blue-300">
                <Database className="h-3 w-3" />
                Indexed
            </Badge>
        ) : (
            <Badge variant="secondary" className="gap-1">
                <Database className="h-3 w-3" />
                Not Indexed
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
                    <AlertDescription>No user found. Please log in.</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div className="container py-8 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Processing Status</h1>
                    <p className="text-muted-foreground">Monitor document processing and AI indexing</p>
                </div>
                <div className="flex gap-2">
                    {summary && summary.pendingIndex > 0 && (
                        <Button onClick={handleSyncToAI} disabled={syncing} variant="default">
                            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                            Sync to AI ({summary.pendingIndex})
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

                <TabsContent value="invoices" className="space-y-4">
                    {summary && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Total Documents</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{summary.total}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Pending OCR</CardTitle>
                                    <Clock className="h-4 w-4 text-yellow-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-3xl font-bold text-yellow-600">{summary.pending}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">OCR Completed</CardTitle>
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-3xl font-medium text-green-600">{summary.completed}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Failed</CardTitle>
                                    <XCircle className="h-4 w-4 text-red-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-3xl font-medium text-red-600">{summary.failed}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">AI Indexed</CardTitle>
                                    <Database className="h-4 w-4 text-blue-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-3xl font-medium text-blue-600">{summary.indexed}</div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Alerts */}
                    {summary && summary.failed > 0 && (
                        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <XCircle className="h-5 w-5 text-red-600" />
                                        {summary.failed} Failed Documents
                                    </div>
                                    <Button size="sm" onClick={handleRetryAllFailed} disabled={retrying === "all-failed"} variant="outline">
                                        {retrying === "all-failed" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                        Retry All Failed
                                    </Button>
                                </CardTitle>
                            </CardHeader>
                        </Card>
                    )}

                    {/* Documents List */}
                    <Card>
                        <CardHeader>
                            <CardTitle>All Documents</CardTitle>
                            <CardDescription>OCR status and AI indexing status from MongoDB</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {documents.length === 0 ? (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>No documents found. Fetch emails to start.</AlertDescription>
                                </Alert>
                            ) : (
                                <div className="space-y-3">
                                    {documents.map((doc) => (
                                        <div key={doc.driveFileId} className="border rounded-lg p-4 transition-colors">
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                                                        <span className="font-medium">{doc.fileName}</span>
                                                        <span className="text-xs text-muted-foreground">• {doc.vendorName}</span>
                                                        {getOcrStatusBadge(doc.ocrStatus)}
                                                        {getIndexedBadge(doc.indexed)}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {doc.ocrStatus === "COMPLETED" && doc.ocrCompletedAt && (
                                                            <span>OCR completed {formatDistanceToNow(new Date(doc.ocrCompletedAt), { addSuffix: true })}</span>
                                                        )}
                                                        {doc.indexed && doc.indexedAt && (
                                                            <span className="ml-2">• Indexed {formatDistanceToNow(new Date(doc.indexedAt), { addSuffix: true })}</span>
                                                        )}
                                                        {doc.ocrStatus === "FAILED" && doc.ocrError && (
                                                            <span className="text-red-600">Error: {doc.ocrError}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    {(doc.ocrStatus === "FAILED" || doc.ocrStatus === "PENDING") && (
                                                        <Button size="sm" variant="outline" onClick={() => handleRetryInvoice(doc.driveFileId, doc.ocrStatus)} disabled={retrying === doc.driveFileId}>
                                                            {retrying === doc.driveFileId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                                                            {doc.ocrStatus === "PENDING" ? "Process" : "Retry"}
                                                        </Button>
                                                    )}
                                                    {doc.webViewLink && (
                                                        <Button size="sm" variant="ghost" onClick={() => window.open(doc.webViewLink, "_blank")}>
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

                <TabsContent value="jobs" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Email Fetch Jobs</CardTitle>
                            <CardDescription>View all email fetch operations</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {emailJobs.length === 0 ? (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>No email fetch jobs found.</AlertDescription>
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
                                                <TableHead>Created</TableHead>
                                                <TableHead>Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {emailJobs.map((job) => (
                                                <>
                                                    <TableRow key={job.jobId}>
                                                        <TableCell>
                                                            <Button variant="ghost" size="sm" onClick={() => setExpandedRowId(expandedRowId === job.jobId ? null : job.jobId)}>
                                                                {expandedRowId === job.jobId ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                            </Button>
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs">{job.jobId.slice(0, 24)}...</TableCell>
                                                        <TableCell>{job.jobType.replace(/_/g, " ")}</TableCell>
                                                        <TableCell>{getOcrStatusBadge(job.status)}</TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                                                        </TableCell>
                                                        <TableCell>
                                                            {job.status === "FAILED" && job.retryCount < job.maxRetries && (
                                                                <Button size="sm" variant="outline" onClick={() => handleRetryJob(job.jobId)} disabled={retrying === job.jobId}>
                                                                    {retrying === job.jobId ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                                                    Retry
                                                                </Button>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                    {expandedRowId === job.jobId && (
                                                        <TableRow>
                                                            <TableCell colSpan={6} className="bg-muted/50">
                                                                <div className="p-4">
                                                                    <pre className="text-xs bg-background p-3 rounded border overflow-auto">
                                                                        {JSON.stringify(job.payload, null, 2)}
                                                                    </pre>
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
            </Tabs>
        </div>
    );
}
