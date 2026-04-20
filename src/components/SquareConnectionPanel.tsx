import { useEffect, useState } from "react";
import {
  Plug, PlugZap, Loader2, Eye, EyeOff, Save, TestTube2, Unplug, ShieldAlert, CheckCircle2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  loadSquareSettings,
  saveSquareSettings,
  disconnectSquare,
  testSquareConnection,
  type SquareSettings,
} from "@/lib/square-settings";

export function SquareConnectionPanel() {
  const [settings, setSettings] = useState<SquareSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Local form state
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [postsPerWindow, setPostsPerWindow] = useState(100);

  useEffect(() => {
    (async () => {
      try {
        const s = await loadSquareSettings();
        setSettings(s);
        setUrl(s.endpoint_url ?? "");
        setKey(s.api_key ?? "");
        setEnabled(s.enabled);
        setPostsPerWindow(s.posts_per_window);
      } catch (e: any) {
        toast.error("Could not load settings", { description: e.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isConnected = !!(settings?.endpoint_url && settings?.api_key);

  const onSave = async () => {
    setSaving(true);
    try {
      const updated = await saveSquareSettings({
        endpoint_url: url.trim() || null,
        api_key: key.trim() || null,
        enabled,
        posts_per_window: Math.max(1, Math.min(500, Number(postsPerWindow) || 100)),
      });
      setSettings(updated);
      toast.success("Connection saved");
    } catch (e: any) {
      toast.error("Save failed", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const r = await testSquareConnection(url.trim(), key.trim());
      const updated = await saveSquareSettings({
        last_tested_at: new Date().toISOString(),
        last_test_ok: r.ok,
        last_test_message: r.message,
      });
      setSettings(updated);
      if (r.ok) toast.success("Connection OK", { description: r.message });
      else toast.error("Connection failed", { description: r.message });
    } catch (e: any) {
      toast.error("Test failed", { description: e.message });
    } finally {
      setTesting(false);
    }
  };

  const onDisconnect = async () => {
    if (!confirm("Disconnect? This will clear the saved API key and endpoint URL.")) return;
    setSaving(true);
    try {
      const updated = await disconnectSquare();
      setSettings(updated);
      setUrl("");
      setKey("");
      setEnabled(false);
      toast.success("Disconnected", { description: "API key and URL cleared" });
    } catch (e: any) {
      toast.error("Disconnect failed", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-surface/40 px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Loading connection…
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border bg-surface/40">
      {/* Status strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded border px-2 py-1 font-bold",
              isConnected && enabled
                ? "border-bull/50 bg-bull/10 text-bull"
                : isConnected
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                  : "border-border bg-surface-elevated text-muted-foreground",
            )}
          >
            {isConnected && enabled ? (
              <PlugZap className="size-3" />
            ) : isConnected ? (
              <Plug className="size-3" />
            ) : (
              <Unplug className="size-3" />
            )}
            {isConnected && enabled ? "Connected · Active" : isConnected ? "Connected · Paused" : "Not connected"}
          </span>
          {settings?.last_tested_at && (
            <span className="flex items-center gap-1 text-muted-foreground">
              {settings.last_test_ok ? (
                <CheckCircle2 className="size-3 text-bull" />
              ) : (
                <XCircle className="size-3 text-bear" />
              )}
              Last test: {new Date(settings.last_tested_at).toLocaleTimeString()} · {settings.last_test_message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="size-3 text-amber-400" />
          API key stored in your project DB · clear it with Disconnect
        </div>
      </div>

      {/* Form */}
      <div className="grid gap-2 px-4 pb-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Endpoint URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-square-endpoint.example.com/post"
            className="h-8 rounded border border-border bg-surface-elevated px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">API key (Bearer token)</span>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="paste-your-key-here"
              className="h-8 w-full rounded border border-border bg-surface-elevated px-2 pr-8 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            </button>
          </div>
        </label>

        <div className="flex items-end gap-1.5">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Posts/window</span>
            <input
              type="number"
              min={1}
              max={500}
              value={postsPerWindow}
              onChange={(e) => setPostsPerWindow(Number(e.target.value))}
              className="h-8 w-20 rounded border border-border bg-surface-elevated px-2 font-mono text-[11px] text-foreground focus:border-primary/60 focus:outline-none"
            />
          </label>
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border bg-surface-elevated px-2 font-mono text-[10px] uppercase tracking-wider text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-primary"
            />
            Enabled
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20 disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          Save
        </button>
        <button
          onClick={onTest}
          disabled={testing || !url || !key}
          className="flex items-center gap-1.5 rounded border border-border bg-surface-elevated px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground hover:border-primary/50 hover:text-primary disabled:opacity-60"
        >
          {testing ? <Loader2 className="size-3 animate-spin" /> : <TestTube2 className="size-3" />}
          Test connection
        </button>
        <button
          onClick={onDisconnect}
          disabled={saving || !isConnected}
          className="flex items-center gap-1.5 rounded border border-destructive/50 bg-destructive/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/20 disabled:opacity-60"
        >
          <Unplug className="size-3" />
          Disconnect
        </button>
      </div>
    </div>
  );
}
