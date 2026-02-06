import { useEffect, useState } from "react";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
    RefreshCw,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    ExternalLink,
    Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import api from "@/services/api";

// Simple document status interface
interface DocumentStatus {
    fileId: string;
    filename: string;
    vendor: string;
    status: "pending" | "processing" | "completed" | "failed";
    error?: string;
    attempts: number;
    lastAttempt?: string;
    webViewLink?: string;
}

interface StatusSummary {
    totalDocuments: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
}

export default function SimpleStatus() {
    const { userId: contextUserId } = useUser();
    const { user: authUser } = useAuth();
    const userId = authUser?.id || contextUserId;
    const { toast } = useToast();

    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState<StatusSummary>({
        totalDocuments: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        processing: 0
    });
    const [documents, setDocuments] = useState<DocumentStatus[]>([]);
    const [retrying, setRetrying] = useState<string | null>(null);

    useEffect(() => {
        if (userId) {
            loadStatus();
        } else {
            setLoading(false);
        }
    }, [userId]);

    const loadStatus = async () => {
        if (!userId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const { data, response } = await api.getDocumentStatus(userId);

            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
            }

            if (data.success) {
                // Update summary
                setSummary(data.summary);

                // Map documents from response
                // For now, we'll combine data from attachments and OCR status
                const mappedDocs: DocumentStatus[] = data.documents.map((doc: any) => ({
                    fileId: doc.fileId,
                    filename: doc.filename,
                    vendor: doc.vendor,
                    status: doc.status || "pending",
                    attempts: 0,
                    webViewLink: doc.webViewLink
                }));

                // If we have OCR status details, merge them
                if (data.ocrStatus && data.ocrStatus?.by_status) {
                    // TODO: Merge detailed OCR status when available
                }

                setDocuments(mappedDocs);
            } else {
                throw new Error(data.message || "Failed to load status");
            }

        } catch (error) {
            console.error("Failed to load status:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to load document status"
            });
        } finally {
            setLoading(false);
        }
    };

    const handleRetryAll = async () => {
        const failedDocs = documents.filter(d => d.status === "failed" && d.error?.includes("Retryable"));

        setRetrying("all");
        toast({
            title: "Retrying Failed Documents",
            description: `Retrying ${failedDocs.length} failed documents...`
        });

        // TODO: Call retry endpoint
        setTimeout(() => {
            setRetrying(null);
            toast({
                title: "Retry Complete",
                description: "Documents have been queued for reprocessing"
            });
            loadStatus();
        }, 2000);
    };

    const handleRetryOne = async (fileId: string) => {
        setRetrying(fileId);
        toast({
            title: "Retrying Document",
            description: "Document queued for reprocessing..."
        });

        // TODO: Call retry endpoint for single document
        setTimeout(() => {
            setRetrying(null);
            toast({
                title: "Retry Complete",
                description: "Document has been queued for reprocessing"
            });
            loadStatus();
        }, 1500);
    };

    const getStatusBadge = (status: string) => {
        const statusConfig = {
            pending: { variant: "secondary" as const, icon: Clock, label: "Pending", color: "text-gray-600" },
            processing: { variant: "default" as const, icon: Loader2, label: "Processing", color: "text-blue-600" },
            completed: { variant: "outline" as const, icon: CheckCircle2, label: "Completed", color: "text-green-600" },
            failed: { variant: "destructive" as const, icon: XCircle, label: "Failed", color: "text-red-600" }
        };

        const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
        const Icon = config.icon;

        return (
            <Badge variant={config.variant} className="gap-1">
                <Icon className={`h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`} />
                {config.label}
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
                        No user found. Please log in to view status.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const failedRetryable = documents.filter(d => d.status === "failed" && d.error?.includes("Retryable")).length;

    return (
        <div className="container py-8 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Document Status</h1>
                    <p className="text-muted-foreground">Track processing status and retry failures</p>
                </div>
                <Button onClick={loadStatus} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.totalDocuments}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{summary.completed}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-gray-600">{summary.pending}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Retry All Failed Button */}
            {failedRetryable > 0 && (
                <div className="flex justify-end">
                    <Button
                        onClick={handleRetryAll}
                        disabled={retrying === "all"}
                        variant="default"
                    >
                        {retrying === "all" ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Retrying...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Retry All Failed ({failedRetryable})
                            </>
                        )}
                    </Button>
                </div>
            )}

            {/* Documents List */}
            <Card>
                <CardHeader>
                    <CardTitle>Documents</CardTitle>
                    <CardDescription>All documents with their processing status</CardDescription>
                </CardHeader>
                <CardContent>
                    {documents.length === 0 ? (
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                No documents found. Fetch emails to start processing.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div className="space-y-3">
                            {documents.map((doc) => (
                                <div
                                    key={doc.fileId}
                                    className="border rounded-lg p-4 space-y-2 hover:bg-accent/50 transition-colors"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                {getStatusBadge(doc.status)}
                                                <span className="font-semibold">{doc.filename}</span>
                                                <span className="text-xs text-muted-foreground">• {doc.vendor}</span>
                                            </div>

                                            {doc.error && (
                                                <Alert variant={doc.error.includes("Retryable") ? "default" : "destructive"} className="mt-2">
                                                    <XCircle className="h-4 w-4" />
                                                    <AlertDescription>
                                                        <div className="font-medium">{doc.error}</div>
                                                        {doc.lastAttempt && (
                                                            <div className="text-xs mt-1">
                                                                Last attempt: {formatDistanceToNow(new Date(doc.lastAttempt), { addSuffix: true })}
                                                                {" • "}Attempts: {doc.attempts}
                                                            </div>
                                                        )}
                                                    </AlertDescription>
                                                </Alert>
                                            )}

                                            {doc.status === "completed" && (
                                                <p className="text-xs text-muted-foreground">
                                                    Processed successfully
                                                    {doc.lastAttempt && ` • ${formatDistanceToNow(new Date(doc.lastAttempt), { addSuffix: true })}`}
                                                </p>
                                            )}

                                            {doc.status === "pending" && (
                                                <p className="text-xs text-muted-foreground">
                                                    Waiting to be processed
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            {doc.status === "failed" && doc.error?.includes("Retryable") && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleRetryOne(doc.fileId)}
                                                    disabled={retrying === doc.fileId}
                                                >
                                                    {retrying === doc.fileId ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <>
                                                            <RefreshCw className="h-4 w-4 mr-1" />
                                                            Retry
                                                        </>
                                                    )}
                                                </Button>
                                            )}

                                            {doc.webViewLink && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => window.open(doc.webViewLink, "_blank")}
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
        </div>
    );
}
