import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import api, { type SyncStatus } from "@/services/api";

export default function EmailSync() {
    const { toast } = useToast();
    const { user } = useAuth();
    const navigate = useNavigate();

    const [fromDate, setFromDate] = useState(() => {
        const stored = localStorage.getItem("emailSyncFromDate");
        if (stored) return new Date(stored);
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    });

    const [vendorEmails, setVendorEmails] = useState(() => localStorage.getItem("emailSyncVendorEmails") || "");
    const [forceSync, setForceSync] = useState(() => localStorage.getItem("emailSyncForceSync") === "true");

    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fetchedDocuments, setFetchedDocuments] = useState<any[]>(() => {
        const stored = localStorage.getItem("fetchedDocuments");
        return stored ? JSON.parse(stored) : [];
    });
    const [statusMessage, setStatusMessage] = useState("");
    const [activityLogs, setActivityLogs] = useState<string[]>([]);
    const [isResetting, setIsResetting] = useState(false);

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem("emailSyncFromDate", fromDate.toISOString());
    }, [fromDate]);
    useEffect(() => { localStorage.setItem("emailSyncVendorEmails", vendorEmails); }, [vendorEmails]);
    useEffect(() => { localStorage.setItem("emailSyncForceSync", String(forceSync)); }, [forceSync]);
    useEffect(() => { localStorage.setItem("fetchedDocuments", JSON.stringify(fetchedDocuments)); }, [fetchedDocuments]);

    // Check sync status on mount - use user ID from authenticated user
    useEffect(() => {
        if (user?.id) {
            fetchSyncStatus();
        }
    }, [user?.id]);

    const addLog = (message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setActivityLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
    };

    const fetchSyncStatus = async () => {
        if (!user?.id) {
            setStatusMessage("Please log in to continue");
            return;
        }

        try {
            // Use the authenticated user's ID directly (same ID across both services now!)
            const { data, response } = await api.getUserSyncStatus(user.id);
            if (response.ok) {
                setSyncStatus(data);
                setIsConnected(data.hasGoogleConnection);
                setStatusMessage(data.message);
                addLog(`Sync status loaded: ${data.message}`);
            } else {
                setStatusMessage("Failed to fetch sync status");
                setIsConnected(false);
                addLog("Failed to load sync status");
            }
        } catch (error) {
            setStatusMessage("Network error");
            setIsConnected(false);
            addLog("Network error while loading sync status");
        }
    };

    const handleResetSync = async () => {
        if (!user?.id) {
            toast({
                title: "Not Connected",
                description: "Please log in first",
                variant: "destructive",
            });
            return;
        }

        setIsResetting(true);
        addLog("Resetting sync status...");

        try {
            // Reset sync status and clear invoice processing records
            const [syncResponse] = await Promise.all([
                api.resetUserSyncStatus(user.id),
                api.clearInvoiceProcessingStatus(user.id)
            ]);

            if (syncResponse.response.ok) {
                setFetchedDocuments([]);
                localStorage.removeItem("fetchedDocuments");
                
                toast({ title: "Success", description: "Sync status reset successfully" });
                addLog("Sync status reset successfully");
                await fetchSyncStatus();
            } else {
                throw new Error("Reset failed");
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to reset sync",
                variant: "destructive",
            });
            addLog("Failed to reset sync status");
        } finally {
            setIsResetting(false);
        }
    };

    const handleFetchEmails = async () => {
        if (!user?.id) {
            toast({
                title: "Not Connected",
                description: "Please log in first",
                variant: "destructive",
            });
            return;
        }

        if (!fromDate) {
            toast({
                title: "Missing Date",
                description: "Please select a 'From Date'.",
                variant: "destructive",
            });
            return;
        }

        setIsFetching(true);
        setStatusMessage("Fetching emails from Gmail...");
        setFetchedDocuments([]);
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
                const docs = result.result.uploadedFiles || [];
                setFetchedDocuments(docs);
                setStatusMessage(`✅ Fetched ${result.result.filesUploaded} documents successfully`);
                addLog(`✅ Successfully fetched ${result.result.filesUploaded} documents`);
                addLog(`Vendors found: ${result.result.vendorsDetected?.join(", ") || "None"}`);
                docs.forEach((doc: any, i: number) => {
                    if (i < 5) addLog(`  - ${doc.vendor}: ${doc.filename}`);
                });
                if (docs.length > 5) addLog(`  ... and ${docs.length - 5} more documents`);

                toast({
                    title: "Fetch Complete!",
                    description: `${result.result.filesUploaded} documents ready for processing`,
                });
            } else {
                throw new Error("Fetch failed");
            }
        } catch (error) {
            setStatusMessage("❌ Fetch failed");
            addLog(`❌ Error: ${error instanceof Error ? error.message : "Failed to fetch emails"}`);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to fetch emails",
                variant: "destructive",
            });
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
        addLog(`Starting OCR processing for ${fetchedDocuments.length} documents...`);

        try {
            const { data, response } = await api.processDocuments(user.id);

            if (response.ok && data.success) {
                // Clear from both state and localStorage before navigating
                setFetchedDocuments([]);
                localStorage.removeItem("fetchedDocuments");

                toast({
                    title: "Processing Started!",
                    description: `${data.totalDocuments} documents are being processed.`,
                });

                // Redirect to Processing Status page with invoices tab
                navigate("/processing-status?tab=invoices");
            } else {
                throw new Error(data.message || "Processing failed");
            }
        } catch (error) {
            setStatusMessage("❌ Processing failed");
            addLog(`❌ Processing error: ${error instanceof Error ? error.message : "Unknown error"}`);
            toast({
                title: "Error",
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

            {/* Connection Status */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <CardTitle className="flex items-center gap-2 pb-2">
                                <Mail className="h-5 w-5" />
                                Google Account
                            </CardTitle>
                            <CardDescription>
                                {isConnected
                                    ? `Connected as: ${syncStatus?.email || user?.email || "Unknown"}`
                                    : "Connect your Google account from Settings to start"
                                }
                            </CardDescription>
                            {syncStatus?.lastSyncedAt && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Last synced: {new Date(syncStatus.lastSyncedAt).toLocaleString()}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {isConnected ? (
                                <>
                                    <Button
                                        onClick={handleResetSync}
                                        disabled={isResetting}
                                        variant="outline"
                                        size="sm"
                                    >
                                        {isResetting ? (
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

            {/* Main Actions */}
            <div className="grid gap-6 md:grid-cols-2">
                {/* Step 1: Fetch Emails */}
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

                {/* Step 2: Process Documents */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-sm">2</span>
                            Process Documents
                        </CardTitle>
                        <CardDescription>Extract data with OCR and index for AI queries</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {fetchedDocuments.length > 0 ? (
                            <>
                                <Alert>
                                    <FileText className="h-4 w-4" />
                                    <AlertDescription>
                                        <strong>{fetchedDocuments.length} documents</strong> ready to process
                                        <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                                            {fetchedDocuments.slice(0, 5).map((doc, i) => (
                                                <div key={i} className="text-muted-foreground">
                                                    • {doc.vendor}: {doc.filename}
                                                </div>
                                            ))}
                                            {fetchedDocuments.length > 5 && (
                                                <div className="text-muted-foreground">
                                                    ... and {fetchedDocuments.length - 5} more
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
                                    No documents to process. Fetch emails first.
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Status Message */}
            {statusMessage && (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{statusMessage}</AlertDescription>
                </Alert>
            )}

            {/* Activity Logs */}
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
