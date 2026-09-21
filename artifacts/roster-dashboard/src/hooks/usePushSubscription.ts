import { useEffect, useRef } from "react";

interface PushSubscriptionUser {
  role: string;
  officerId?: string;
}

/**
 * Registers the roster service worker and subscribes the current account to
 * web push notifications. Safe to call on every render — only runs once per
 * browser session (deduped by SW registration state).
 *
 * Takes the full user (not just a crew officerId) so every role gets
 * subscribed, not just crew — the backend's push type is "crew" (tagged with
 * officerId, for per-officer sends) vs "manager" (a catch-all for
 * admin/manager/ic, used for broadcast-to-managers sends).
 * .scratch/replit-resync-2026-09-21/issues/18.
 */
export function usePushSubscription(user: PushSubscriptionUser | undefined | null) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    const type = user.role === "crew" ? "crew" : "manager";
    if (type === "crew" && !user.officerId) return;
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

        // 5. Register with server, tagging with type + officerId (crew only)
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ subscription, type, officerId: type === "crew" ? user.officerId : undefined }),
        });
      } catch {
        // Non-fatal — push is best-effort
      }
    })();
  }, [user?.role, user?.officerId]); // eslint-disable-line react-hooks/exhaustive-deps
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
