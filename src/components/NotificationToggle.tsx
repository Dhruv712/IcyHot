"use client";

import { useState, useEffect } from "react";

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

interface NotificationToggleProps {
  collapsed?: boolean;
}

export default function NotificationToggle({ collapsed = false }: NotificationToggleProps) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setSupported(false);
        setLoading(false);
        return;
      }

      setSupported(true);

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setEnabled(!!subscription);
      } catch {
        // Permission denied or other error
      }
      setLoading(false);
    };

    check();
  }, []);

  const toggle = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;

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
          setLoading(false);
          return;
        }

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          console.error("[push] VAPID public key not found");
          setLoading(false);
          return;
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });

        const json = subscription.toJSON();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
          }),
        });

        setEnabled(true);
      }
    } catch (error) {
      console.error("[push] Toggle failed:", error);
    }

    setLoading(false);
  };

  if (!supported) return null;

  return (
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
      title={collapsed ? (enabled ? "Notifications on" : "Notifications off") : undefined}
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
  );
}
