import { useState, useEffect, useCallback } from "react";

type PushState =
  | "unsupported"
  | "default"
  | "granted"
  | "denied"
  | "subscribing";

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

export function usePush(): {
  state: PushState;
  subscribe: () => Promise<void>;
} {
  const [state, setState] = useState<PushState>("unsupported");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "granted" : "default");
    });
  }, []);

  const subscribe = useCallback(async () => {
    setState("subscribing");
    try {
      const reg = await navigator.serviceWorker.ready;

      const resp = await fetch("/api/push/vapid-key");
      const { publicKey } = await resp.json();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        }),
      });

      setState("granted");
    } catch (e) {
      console.error("Push subscription failed:", e);
      setState(Notification.permission === "denied" ? "denied" : "default");
    }
  }, []);

  return { state, subscribe };
}
