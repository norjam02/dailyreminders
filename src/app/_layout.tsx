import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { registerForPush } from "@/lib/push";
import { SessionProvider, useSession } from "@/lib/session";
import { colors, fonts } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { loading, session, current } = useSession();
  const [fontsLoaded] = useFonts({ AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold });
  const ready = fontsLoaded && !loading;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Register this device once the person is in a circle.
  const userId = session?.user.id;
  const active = current?.status === "active";
  useEffect(() => {
    if (userId && active) registerForPush(userId).catch(() => {});
  }, [userId, active]);

  // Tapping a notification opens the app's main screen for this person.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(() => router.replace("/"));
    return () => subscription.remove();
  }, []);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: fonts.bold, color: colors.ink },
          headerBackTitle: "Back",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="checkin" options={{ headerShown: false }} />
        <Stack.Screen name="waiting" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
        <Stack.Screen name="join" options={{ title: "Join with a code" }} />
        <Stack.Screen name="setup" options={{ title: "Set up a circle" }} />
        <Stack.Screen name="plan" options={{ title: "Check-in settings" }} />
        <Stack.Screen name="invite" options={{ title: "Invite someone" }} />
        <Stack.Screen name="members" options={{ title: "My Circle" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Navigator />
    </SessionProvider>
  );
}
