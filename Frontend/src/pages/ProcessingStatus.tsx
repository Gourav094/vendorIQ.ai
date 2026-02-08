import { useState, useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
    useProcessingStatus,
    useRetryDocument,
    useRetryAllFailed,
    useRetryJob,
    useSyncToAI,
} from "@/hooks/use-processing-status";
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

export default function ProcessingStatus() {
    const { userId: contextUserId } = useUser();
    const { user: authUser } = useAuth();
    const userId = authUser?.id || contextUserId;
    const [searchParams, setSearchParams] = useSearchParams();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") || "invoices");
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

    // React Query hooks - initial fetch
    const { 
        data, 
        isLoading, 
        refetch,
        isFetching 
    } = useProcessingStatus(userId, true);

    // Enable auto-polling when there are processing documents
    const isProcessing = (data?.summary?.processing ?? 0) > 0;
    
    useEffect(() => {
        if (!isProcessing || !userId) return;
        
        const interval = setInterval(() => {
            queryClient.invalidateQueries({ queryKey: ["processingStatus", userId] });
        }, 10000); // Poll every 10 seconds

        return () => clearInterval(interval);
    }, [isProcessing, userId, queryClient]);

    // Mutations
    const retryDocumentMutation = useRetryDocument();
    const retryAllFailedMutation = useRetryAllFailed();
    const retryJobMutation = useRetryJob();
    const syncToAIMutation = useSyncToAI();

    const documents = data?.documents ?? [];
    const summary = data?.summary ?? null;
    const emailJobs = data?.emailJobs ?? [];

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        setSearchParams({ tab: value });
    };

    const handleRetryInvoice = async (driveFileId: string, ocrStatus: string) => {
        if (!userId) return;

        retryDocumentMutation.mutate(
            { userId, driveFileId, ocrStatus },
            {
                onSuccess: (data) => {
                    toast({ description: data.message || "Document retry queued." });
                },
                onError: (error) => {
                    toast({ description: error.message || "Could not process the document." });
                },
            }
        );
    };

    const handleRetryAllFailed = async () => {
        if (!userId) return;

        retryAllFailedMutation.mutate(userId, {
            onSuccess: (data) => {
                toast({ description: `Retried ${data.retried} documents.` });
            },
            onError: (error) => {
                toast({ description: error.message || "Could not retry documents." });
            },
        });
    };

    const handleSyncToAI = async () => {
        if (!userId) return;

        syncToAIMutation.mutate(userId, {
            onSuccess: (data) => {
                toast({ description: data.message || "Synced to AI knowledge base." });
            },
            onError: (error) => {
                toast({ description: error.message || "Could not sync to AI." });
            },
        });
    };

    const handleRetryJob = async (jobId: string) => {
        if (!userId) return;

        retryJobMutation.mutate(
            { jobId, userId },
            {
                onSuccess: () => {
                    toast({ description: "Job queued for retry." });
                },
                onError: (error) => {
                    toast({ description: error.message || "Could not retry the job." });
                },
            }
        );
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

    if (isLoading) {
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
                    <p className="text-muted-foreground">
                        Monitor document processing and AI indexing
                        {isProcessing && (
                            <span className="ml-2 text-xs text-primary">(auto-refreshing)</span>
                        )}
                    </p>
                </div>
                <div className="flex gap-2">
                    {summary && summary.pendingIndex > 0 && (
                        <Button onClick={handleSyncToAI} disabled={syncToAIMutation.isPending} variant="default">
                            {syncToAIMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                            Sync to AI ({summary.pendingIndex})
                        </Button>
                    )}
                    <Button onClick={() => refetch()} variant="outline" disabled={isFetching}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
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
                                    <Button 
                                        size="sm" 
                                        onClick={handleRetryAllFailed} 
                                        disabled={retryAllFailedMutation.isPending} 
                                        variant="outline"
                                    >
                                        {retryAllFailedMutation.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                        )}
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
                                                        <Button 
                                                            size="sm" 
                                                            variant="outline" 
                                                            onClick={() => handleRetryInvoice(doc.driveFileId, doc.ocrStatus)} 
                                                            disabled={retryDocumentMutation.isPending && retryDocumentMutation.variables?.driveFileId === doc.driveFileId}
                                                        >
                                                            {retryDocumentMutation.isPending && retryDocumentMutation.variables?.driveFileId === doc.driveFileId ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <RefreshCw className="h-4 w-4 mr-1" />
                                                            )}
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
                                                                <Button 
                                                                    size="sm" 
                                                                    variant="outline" 
                                                                    onClick={() => handleRetryJob(job.jobId)} 
                                                                    disabled={retryJobMutation.isPending && retryJobMutation.variables?.jobId === job.jobId}
                                                                >
                                                                    {retryJobMutation.isPending && retryJobMutation.variables?.jobId === job.jobId ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                                    ) : (
                                                                        <RefreshCw className="h-4 w-4 mr-2" />
                                                                    )}
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
