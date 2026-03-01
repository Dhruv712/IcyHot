"use client";

import { useState, useEffect, useCallback } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

interface NotificationToggleProps {
  collapsed?: boolean;
  compact?: boolean;
}

export default function NotificationToggle({
  collapsed = false,
  compact = false,
}: NotificationToggleProps) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auto-clear error after 4 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setSupported(false);
        setLoading(false);
        return;
      }

      setSupported(true);

      try {
        // Register SW if not already — makes sure `ready` will resolve
        await navigator.serviceWorker.register("/sw.js");
        const registration = await withTimeout(
          navigator.serviceWorker.ready,
          5000,
          "Service worker ready"
        );
        const subscription = await registration.pushManager.getSubscription();
        setEnabled(!!subscription);
      } catch (err) {
        console.warn("[push] Init check failed:", err);
        // SW not working — still show toggle, user can retry on click
      }
      setLoading(false);
    };

    check();
  }, []);

  const toggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      // Ensure SW is registered before awaiting ready
      await navigator.serviceWorker.register("/sw.js");
      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        5000,
        "Service worker ready"
      );

      if (enabled) {
        // Unsubscribe
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const endpoint = subscription.endpoint;
          await subscription.unsubscribe();
          await fetch("/api/push/unsubscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          });
        }
        setEnabled(false);
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError("Permission denied");
          setLoading(false);
          return;
        }

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          console.error("[push] VAPID public key not found in env");
          setError("Push not configured");
          setLoading(false);
          return;
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });

        const json = subscription.toJSON();
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Subscribe failed (${res.status})`);
        }

        setEnabled(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[push] Toggle failed:", msg, err);
      setError(msg);
    }

    setLoading(false);
  }, [loading, enabled]);

  if (!supported) return null;

  if (compact) {
    return (
      <button
        onClick={toggle}
        disabled={loading}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
          enabled
            ? "border-[var(--amber)] bg-[var(--amber-ghost-bg)] text-[var(--amber)] hover:border-[var(--amber-hover)]"
            : "border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
        }`}
        title={error || (enabled ? "Notifications on" : "Notifications off")}
        aria-label={enabled ? "Disable notifications" : "Enable notifications"}
      >
        <span className="text-base">{enabled ? "\uD83D\uDD14" : "\uD83D\uDD15"}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={toggle}
        disabled={loading}
        className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors w-full disabled:opacity-50 ${
          collapsed ? "justify-center" : ""
        } ${
          enabled
            ? "text-[var(--amber)] hover:bg-[var(--amber-ghost-bg)]"
            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        }`}
        title={
          collapsed
            ? enabled
              ? "Notifications on"
              : "Notifications off"
            : error || undefined
        }
      >
        <span className="text-base flex-shrink-0">
          {enabled ? "\uD83D\uDD14" : "\uD83D\uDD15"}
        </span>
        {!collapsed && (
          <span className="text-sm flex-1 text-left">
            {loading ? "..." : enabled ? "Notifications on" : "Notifications"}
          </span>
        )}
        {!collapsed && (
          <span
            className={`w-8 h-4 rounded-full relative transition-colors ${
              enabled ? "bg-[var(--amber)]" : "bg-[var(--border-medium)]"
            }`}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        )}
      </button>
      {!collapsed && error && (
        <p className="text-[11px] text-[var(--danger)] px-3 mt-0.5">{error}</p>
      )}
    </div>
  );
}
