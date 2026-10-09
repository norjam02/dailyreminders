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

// This phone's token, once registered, so sign-out can remove it.
let registeredToken: string | null = null;

export async function registerForPush(_userId: string): Promise<PushResult> {
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
  // Moves the token to this account if someone else used this phone before.
  const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: Platform.OS });
  if (error) throw error;
  registeredToken = token;
  return "registered";
}

// On sign-out: stop sending this account's notifications to this phone.
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await supabase.from("push_tokens").delete().eq("token", token);
}
