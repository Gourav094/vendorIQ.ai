import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect } from 'react';
import { AlertCircle, Mail, CheckCircle2, ExternalLink, Unplug, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { useSyncStatus, useDisconnectGoogle } from "@/hooks/use-sync-status";

const Settings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  
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

  const disconnectGoogle = async () => {
    if (!user?.id) return;
    const confirm = window.confirm("Disconnect Google Drive & Gmail integration? This will stop further indexing until reconnected.");
    if (!confirm) return;
    
    disconnectMutation.mutate(user.id, {
      onSuccess: (data) => {
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
                    onClick={disconnectGoogle} 
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
    </div>
  );
};

export default Settings;