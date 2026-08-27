import { useEffect, useRef } from "react";

/**
 * Registers the roster service worker and subscribes the current crew member
 * to web push notifications. Safe to call on every render — only runs once
 * per browser session (deduped by SW registration state).
 */
export function usePushSubscription(officerId: string | undefined) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!officerId) return;
    if (subscribedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    subscribedRef.current = true;

    (async () => {
      try {
        // 1. Register (or reuse) the service worker
        const reg = await navigator.serviceWorker.register("/roster/sw-roster.js", {
          scope: "/roster/",
        });

        // 2. Request permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        // 3. Fetch VAPID public key
        const keyRes = await fetch("/api/push/vapid-key");
        if (!keyRes.ok) return;
        const { publicKey } = await keyRes.json();

        // 4. Subscribe
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        // 5. Register with server, tagging with officerId
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ subscription, type: "crew", officerId }),
        });
      } catch {
        // Non-fatal — push is best-effort
      }
    })();
  }, [officerId]);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // `new Uint8Array(n)` is always backed by a real ArrayBuffer (never
  // SharedArrayBuffer), unlike `Uint8Array.from()`'s inferred
  // `Uint8Array<ArrayBufferLike>` return type — PushSubscriptionOptionsInit's
  // applicationServerKey wants BufferSource, which SharedArrayBuffer-backed
  // views don't satisfy.
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
