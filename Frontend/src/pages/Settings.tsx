import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from 'react';
import { AlertCircle, Mail, CheckCircle2, ExternalLink, Unplug, Loader2, AlertTriangle, RotateCcw, Database, Brain, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { useSyncStatus, useDisconnectGoogle } from "@/hooks/use-sync-status";
import { useResetEmailSync, useResetOcrProcessing, useResetAiDatabase, useHardReset } from "@/hooks/use-reset";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const Settings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  
  const { 
    data: syncStatus, 
    isLoading, 
    refetch: refetchSyncStatus 
  } = useSyncStatus(user?.id);
  
  const disconnectMutation = useDisconnectGoogle();

  const isConnected = syncStatus?.hasGoogleConnection ?? false;

  // Handle OAuth callback redirect (if user returns here)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const email = params.get('email');

    if (connected === 'true' && email) {
      toast({
        description: `Successfully connected as ${email}`,
      });

      // Clean up URL
      window.history.replaceState({}, '', '/settings');

      // Refresh sync status
      setTimeout(() => refetchSyncStatus(), 1000);
    }
  }, [toast, refetchSyncStatus]);

  const connectGoogleAccount = () => {
    if (!user?.id) {
      toast({
        description: "Please log in before connecting Google account",
        variant: "destructive"
      });
      return;
    }
    window.location.href = api.getGoogleAuthUrl(user.id);
  };

  const handleDisconnectGoogle = () => {
    if (!user?.id) return;
    
    disconnectMutation.mutate(user.id, {
      onSuccess: (data) => {
        setDisconnectDialogOpen(false);
        toast({ description: (data as any).message || "Google account disconnected." });
      },
      onError: (error) => {
        toast({ description: error.message || 'Failed to disconnect. Try again later.', variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-4xl font-semibold">Settings</h1>
        <p className="mt-2 text-muted-foreground">
          Configure your integrations and preferences
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6">User Configuration</h2>
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold">Gmail & Google Drive</h3>
                {isLoading ? (
                  <Badge variant="secondary">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Loading...
                  </Badge>
                ) : isConnected ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Not Connected
                  </Badge>
                )}
              </div>
              {isConnected && syncStatus?.email && (
                <p className="text-sm text-green-600 mb-2">
                  Connected as: {syncStatus.email}
                </p>
              )}
              {syncStatus?.lastSyncedAt && (
                <p className="text-xs text-muted-foreground mb-2">
                  Last synced: {new Date(syncStatus.lastSyncedAt).toLocaleString()}
                </p>
              )}
              <p className="text-sm text-muted-foreground mb-4">
                Connect your Google account to access Gmail and Google Drive. This single connection provides access to:
              </p>
              <ul className="text-sm text-muted-foreground mb-4 ml-4 list-disc">
                <li>Fetch emails and invoice attachments from Gmail</li>
                <li>Automatically organize invoices in Google Drive folders</li>
                <li>Vendor detection and categorization</li>
              </ul>
              {isConnected ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => refetchSyncStatus()} disabled={isLoading}>
                    {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Refresh Status
                  </Button>
                  <Button variant="outline" onClick={connectGoogleAccount}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Reconnect
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => setDisconnectDialogOpen(true)} 
                    disabled={disconnectMutation.isPending}
                    data-testid="button-disconnect-google"
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Unplug className="h-4 w-4 mr-2" />
                    )}
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button data-testid="button-connect-gmail" onClick={connectGoogleAccount}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect Google Account
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6">Preferences</h2>
        
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive alerts for new invoices and updates
              </p>
            </div>
            <Switch data-testid="switch-email-notifications" />
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      <DangerZone userId={user?.id} />

      {/* Disconnect Google Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect your Google Drive & Gmail integration. 
              Email syncing and invoice processing will stop until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnectGoogle}
              className="bg-red-600 hover:bg-red-700"
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// Danger Zone Component
const DangerZone = ({ userId }: { userId: string | undefined }) => {
  const { toast } = useToast();
  const [hardResetDialogOpen, setHardResetDialogOpen] = useState(false);

  const resetEmailSyncMutation = useResetEmailSync();
  const resetOcrMutation = useResetOcrProcessing();
  const resetAiMutation = useResetAiDatabase();
  const hardResetMutation = useHardReset();

  const handleResetEmailSync = () => {
    if (!userId) return;
    resetEmailSyncMutation.mutate(userId, {
      onSuccess: (result) => {
        toast({
          description: `Email sync reset. ${result.data.details.processingJobsDeleted} jobs cleared.`,
        });
      },
      onError: (error) => {
        toast({
          description: error.message || "Failed to reset email sync",
          variant: "destructive",
        });
      },
    });
  };

  const handleResetOcr = () => {
    if (!userId) return;
    resetOcrMutation.mutate(userId, {
      onSuccess: (result) => {
        toast({
          description: `OCR processing reset. ${result.data.details.documentsReset} documents set to pending.`,
        });
      },
      onError: (error) => {
        toast({
          description: error.message || "Failed to reset OCR processing",
          variant: "destructive",
        });
      },
    });
  };

  const handleResetAi = () => {
    if (!userId) return;
    resetAiMutation.mutate(userId, {
      onSuccess: (result) => {
        toast({
          description: `AI database cleared. ${result.data.details.documentsReset} documents will be re-indexed.`,
        });
      },
      onError: (error) => {
        toast({
          description: error.message || "Failed to reset AI database",
          variant: "destructive",
        });
      },
    });
  };

  const handleHardReset = () => {
    if (!userId) return;
    hardResetMutation.mutate(
      { userId, confirmDelete: true },
      {
        onSuccess: (result) => {
          setHardResetDialogOpen(false);
          toast({
            description: result.data.note || "All data has been permanently deleted.",
          });
        },
        onError: (error) => {
          toast({
            description: error.message || "Failed to perform hard reset",
            variant: "destructive",
          });
        },
      }
    );
  };

  if (!userId) return null;

  return (
    <>
      <Card className="p-6 border-red-200 dark:border-red-900">
        <div className="flex items-center gap-2 mb-6">
          <h2 className="text-2xl font-medium">Danger Zone</h2>
        </div>

        <div className="space-y-4">
          {/* Reset Email Sync */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-start gap-3">
              <div>
                <h3 className="font-medium">Reset Email Sync</h3>
                <p className="text-sm text-muted-foreground">
                  Clear all processing jobs and reset last sync date. Next sync will fetch all emails from scratch.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetEmailSync}
              disabled={resetEmailSyncMutation.isPending}
            >
              {resetEmailSyncMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset
            </Button>
          </div>

          {/* Reset OCR Processing */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-start gap-3">
              <div>
                <h3 className="font-medium">Reset OCR Processing</h3>
                <p className="text-sm text-muted-foreground">
                  Set all documents back to pending status. Documents will be reprocessed on next OCR run.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetOcr}
              disabled={resetOcrMutation.isPending}
            >
              {resetOcrMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset
            </Button>
          </div>

          {/* Reset AI Database */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-start gap-3">
              <div>
                <h3 className="font-medium">Reset AI Database</h3>
                <p className="text-sm text-muted-foreground">
                  Clear vector database and reset indexed flags. AI assistant will need to re-index all documents.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAi}
              disabled={resetAiMutation.isPending}
            >
              {resetAiMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset
            </Button>
          </div>

          {/* Hard Reset */}
          <div className="flex items-center justify-between p-4 rounded-lg border ">
            <div className="flex items-start gap-3">
              <div>
                <h3 className="font-medium">Hard Reset - Delete All Data</h3>
                <p className="text-sm text-muted-foreground">
                  Permanently delete all data including MongoDB records, vector database, and Google Drive folders.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setHardResetDialogOpen(true)}
              disabled={hardResetMutation.isPending}
            >
              {hardResetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </div>
        </div>
      </Card>

      {/* Hard Reset Confirmation Dialog */}
      <AlertDialog open={hardResetDialogOpen} onOpenChange={setHardResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete All data from Database and Drive
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This action will permanently delete:</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>All processing jobs and sync history</li>
                <li>All document records from database</li>
                <li>All indexed data from the AI database</li>
                <li>All invoice files from your Google Drive</li>
              </ul>
              <p className="text-sm">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleHardReset}
              className="bg-red-600 hover:bg-red-700"
              disabled={hardResetMutation.isPending}
            >
              {hardResetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Yes, delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Settings;