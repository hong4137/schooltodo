import { supabase } from "./supabase";

// VAPID public key - generate a pair and put public key here
// Generate with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = null; // Will be set from Supabase config or env

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.log("Service Worker not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/schooltodo/sw.js");
    console.log("SW registered:", registration.scope);
    return registration;
  } catch (err) {
    console.error("SW registration failed:", err);
    return null;
  }
}

export async function subscribePush(userId) {
  if (!("PushManager" in window)) {
    console.log("Push not supported");
    return null;
  }

  const registration = await navigator.serviceWorker.ready;

  // Check existing subscription
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    // Get VAPID key from Supabase app_settings or use hardcoded
    const vapidKey = await getVapidKey();
    if (!vapidKey) {
      console.error("No VAPID key configured");
      return null;
    }

    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    } catch (err) {
      console.error("Push subscription failed:", err);
      return null;
    }
  }

  // Save subscription to Supabase
  const subJson = subscription.toJSON();
  try {
    // Upsert push subscription
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
        is_active: true,
      },
      { onConflict: "endpoint" }
    );
    console.log("Push subscription saved");
  } catch (err) {
    console.error("Failed to save subscription:", err);
  }

  return subscription;
}

export async function unsubscribePush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    // Deactivate in DB
    await supabase
      .from("push_subscriptions")
      .update({ is_active: false })
      .eq("endpoint", endpoint);
  }
}

export async function isPushSubscribed() {
  if (!("PushManager" in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

async function getVapidKey() {
  // Try fetching from Supabase app_settings
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vapid_public_key")
      .single();
    if (data?.value) return data.value;
  } catch {}
  
  return VAPID_PUBLIC_KEY;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
