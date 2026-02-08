import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Mail,
    RefreshCw,
    Calendar,
    CheckCircle2,
    AlertCircle,
    Loader2,
    ExternalLink,
    FileText
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { useSyncStatus, useResetSyncStatus } from "@/hooks/use-sync-status";
import { usePendingDocuments } from "@/hooks/use-pending-documents";

export default function EmailSync() {
    const { toast } = useToast();
    const { user } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // React Query hooks
    const { data: syncStatus, isLoading: isSyncLoading } = useSyncStatus(user?.id);
    const { data: pendingData, isLoading: isLoadingPending, refetch: refetchPending } = usePendingDocuments(user?.id);
    const resetSyncMutation = useResetSyncStatus();

    const isConnected = syncStatus?.hasGoogleConnection ?? false;
    const pendingDocuments = pendingData?.documents ?? [];

    const [fromDate, setFromDate] = useState(() => {
        const stored = localStorage.getItem("emailSyncFromDate");
        if (stored) return new Date(stored);
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    });

    const [vendorEmails, setVendorEmails] = useState(() => localStorage.getItem("emailSyncVendorEmails") || "");
    const [forceSync, setForceSync] = useState(() => localStorage.getItem("emailSyncForceSync") === "true");

    const [isFetching, setIsFetching] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [activityLogs, setActivityLogs] = useState<string[]>([]);

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem("emailSyncFromDate", fromDate.toISOString());
    }, [fromDate]);
    useEffect(() => { localStorage.setItem("emailSyncVendorEmails", vendorEmails); }, [vendorEmails]);
    useEffect(() => { localStorage.setItem("emailSyncForceSync", String(forceSync)); }, [forceSync]);

    const addLog = (message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setActivityLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
    };

    // Log when pending documents are loaded
    useEffect(() => {
        if (pendingData?.count && pendingData.count > 0) {
            addLog(`Found ${pendingData.count} documents pending OCR processing`);
        }
    }, [pendingData?.count]);

    const handleResetSync = async () => {
        if (!user?.id) {
            toast({ description: "Please log in first" });
            return;
        }

        addLog("Resetting sync status...");

        resetSyncMutation.mutate(user.id, {
            onSuccess: () => {
                toast({ title: "Success", description: "Sync status reset successfully" });
                addLog("Sync status reset successfully");
            },
            onError: (error) => {
                toast({
                    title: "Error",
                    description: error.message || "Failed to reset sync",
                    variant: "destructive",
                });
                addLog("Failed to reset sync status");
            }
        });
    };

    const handleFetchEmails = async () => {
        if (!user?.id) {
            toast({ description: "Please log in first" });
            return;
        }

        if (!fromDate) {
            toast({ description: "Please select a 'From Date'." });
            return;
        }

        setIsFetching(true);
        setStatusMessage("Fetching emails from Gmail...");
        addLog(`Starting email fetch from ${new Date(fromDate).toLocaleDateString()}`);
        if (vendorEmails) addLog(`Filtering by vendors: ${vendorEmails}`);
        if (forceSync) addLog("Force sync enabled - ignoring last sync timestamp");

        try {
            const result = await api.fetchEmailsWithPolling({
                userId: user.id,
                fromDate: fromDate.toISOString(),
                email: vendorEmails.trim() || undefined,
                forceSync,
                schedule: "manual"
            }, (status) => {
                setStatusMessage(`Status: ${status.status}`);
                addLog(`Email fetch status: ${status.status}`);
            });

            if (result.status === "completed" && result.result) {
                const newDocs = (result.result.uploadedFiles || []).filter((doc: any) => !doc.skipped);
                const skippedCount = (result.result.uploadedFiles?.length || 0) - newDocs.length;
                
                setStatusMessage(`Fetched ${newDocs.length} new documents successfully`);
                addLog(`Successfully fetched ${newDocs.length} new documents (${skippedCount} skipped as duplicates)`);
                
                // Invalidate and refetch pending documents
                refetchPending();

                toast({ description: `${newDocs.length} new documents uploaded to Drive` });
            } else {
                throw new Error("Fetch failed");
            }
        } catch (error) {
            setStatusMessage("Fetch failed");
            addLog(`❌ Error: ${error instanceof Error ? error.message : "Failed to fetch emails"}`);
            toast({ description: error instanceof Error ? error.message : "Failed to fetch emails" });
        } finally {
            setIsFetching(false);
        }
    };

    const handleProcessDocuments = async () => {
        if (!user?.id) {
            toast({
                title: "Not Connected",
                description: "Please log in first",
                variant: "destructive",
            });
            return;
        }

        setIsProcessing(true);
        setStatusMessage("Processing documents with OCR and AI...");
        addLog(`Starting OCR processing for ${pendingDocuments.length} documents...`);

        try {
            const { data, response } = await api.processDocuments(user.id);

            if (response.ok && data.success) {
                toast({ description: `${data.totalDocuments} documents are being processed.` });
                
                // Invalidate processing status cache before navigating
                queryClient.invalidateQueries({ queryKey: ["processingStatus", user.id] });
                queryClient.invalidateQueries({ queryKey: ["pendingDocuments", user.id] });

                navigate("/processing-status?tab=invoices");
            } else {
                throw new Error(data.message || "Processing failed");
            }
        } catch (error) {
            setStatusMessage("❌ Processing failed");
            addLog(`❌ Processing error: ${error instanceof Error ? error.message : "Unknown error"}`);
            toast({
                description: error instanceof Error ? error.message : "Failed to process documents",
                variant: "destructive",
            });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex-1 space-y-6 p-8 pt-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Email Sync</h2>
                <p className="text-muted-foreground">
                    Fetch emails from Gmail and process invoices
                </p>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <CardTitle className="flex items-center gap-2 pb-2">
                                <Mail className="h-5 w-5" />
                                Google Account
                            </CardTitle>
                            <CardDescription>
                                {isSyncLoading ? (
                                    "Loading connection status..."
                                ) : isConnected ? (
                                    `Connected as: ${syncStatus?.email || user?.email || "Unknown"}`
                                ) : (
                                    "Connect your Google account from Settings to start"
                                )}
                            </CardDescription>
                            {syncStatus?.lastSyncedAt && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Last synced: {new Date(syncStatus.lastSyncedAt).toLocaleString()}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {isSyncLoading ? (
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            ) : isConnected ? (
                                <>
                                    <Button
                                        onClick={handleResetSync}
                                        disabled={resetSyncMutation.isPending}
                                        variant="outline"
                                        size="sm"
                                    >
                                        {resetSyncMutation.isPending ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Resetting...
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                                Reset Sync
                                            </>
                                        )}
                                    </Button>
                                    <div className="flex items-center gap-2 text-green-600">
                                        <CheckCircle2 className="h-5 w-5" />
                                        <span className="font-medium">Connected</span>
                                    </div>
                                </>
                            ) : (
                                <Button onClick={() => window.location.href = '/settings'} variant="outline">
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Go to Settings
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-sm">1</span>
                            Fetch Emails
                        </CardTitle>
                        <CardDescription>Download email attachments from Gmail to Drive</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="fromDate">From Date & Time</Label>
                            <DatePicker
                                selected={fromDate}
                                onChange={(date) => setFromDate(date || new Date())}
                                showTimeSelect
                                timeFormat="HH:mm"
                                timeIntervals={15}
                                maxDate={new Date()}
                                dateFormat="MMM d, yyyy h:mm aa"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                calendarClassName="!font-sans !shadow-xl !border !border-border !rounded-lg"
                                wrapperClassName="w-full"
                                popperClassName="!z-50"
                                showPopperArrow={false}
                            />
                            <Calendar className="absolute right-3 top-2.5 h-5 w-5 text-muted-foreground pointer-events-none" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="vendorEmails">
                                Filter by Email <span className="text-xs text-muted-foreground">(Optional)</span>
                            </Label>
                            <Input
                                id="vendorEmails"
                                value={vendorEmails}
                                onChange={(e) => setVendorEmails(e.target.value)}
                                placeholder="vendor@example.com"
                            />
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={forceSync}
                                onChange={(e) => setForceSync(e.target.checked)}
                            />
                            <span className="text-sm">Force sync (ignore last sync timestamp)</span>
                        </label>

                        <Button
                            onClick={handleFetchEmails}
                            disabled={!isConnected || isFetching}
                            className="w-full"
                        >
                            {isFetching ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Fetching...
                                </>
                            ) : (
                                <>
                                    <Mail className="h-4 w-4 mr-2" />
                                    Fetch Emails
                                </>
                            )}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-sm">2</span>
                            Process Documents
                        </CardTitle>
                        <CardDescription>Extract data with OCR and index for AI queries</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {isLoadingPending ? (
                            <Alert>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <AlertDescription>Loading pending documents...</AlertDescription>
                            </Alert>
                        ) : pendingDocuments.length > 0 ? (
                            <>
                                <Alert>
                                    <FileText className="h-4 w-4" />
                                    <AlertDescription>
                                        <strong>{pendingDocuments.length} documents</strong> pending OCR processing
                                        <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                                            {pendingDocuments.slice(0, 5).map((doc, i) => (
                                                <div key={i} className="text-muted-foreground">
                                                    • {doc.vendor}: {doc.filename}
                                                </div>
                                            ))}
                                            {pendingDocuments.length > 5 && (
                                                <div className="text-muted-foreground">
                                                    ... and {pendingDocuments.length - 5} more
                                                </div>
                                            )}
                                        </div>
                                    </AlertDescription>
                                </Alert>

                                <Button
                                    onClick={handleProcessDocuments}
                                    disabled={isProcessing}
                                    className="w-full"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                            Process Documents
                                        </>
                                    )}
                                </Button>
                            </>
                        ) : (
                            <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                    No documents pending for OCR. Try fetching new emails
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            </div>

            {statusMessage && (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{statusMessage}</AlertDescription>
                </Alert>
            )}

            {activityLogs.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Activity Logs</CardTitle>
                        <CardDescription>Recent activity and detailed progress</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="bg-muted p-4 rounded-md max-h-64 overflow-y-auto">
                            <div className="space-y-1 font-mono text-xs">
                                {activityLogs.map((log, i) => (
                                    <div key={i} className="text-muted-foreground">
                                        {log}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
