// Push notifications: ask permission, get this device's Expo push token, and
// save it so the scheduler can reach this person.

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushResult = "registered" | "denied" | "unavailable";

export async function registerForPush(userId: string): Promise<PushResult> {
  // Simulators and the web can't receive push notifications.
  if (!Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return "unavailable";

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Check-ins",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return "denied";

  // Set by `npx eas-cli@latest init`. Without it, Expo can't issue a token.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return "unavailable";

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.from("push_tokens").upsert(
    { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
    { onConflict: "user_id,token" },
  );
  if (error) throw error;
  return "registered";
}
