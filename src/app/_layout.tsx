import {
  AtkinsonHyperlegibleNext_400Regular,
  AtkinsonHyperlegibleNext_500Medium,
  AtkinsonHyperlegibleNext_700Bold,
  AtkinsonHyperlegibleNext_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible-next";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";

import { LaunchWelcome } from "@/components/welcome";
import { registerForPush } from "@/lib/push";
import { SessionProvider, useSession } from "@/lib/session";
import { colors, fonts, scheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { loading, session, current } = useSession();
  const [fontsLoaded] = useFonts({
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_500Medium,
    AtkinsonHyperlegibleNext_700Bold,
    AtkinsonHyperlegibleNext_800ExtraBold,
  });
  const ready = fontsLoaded && !loading;

  // The launch screen stays up until the circle's welcome is ready, so the
  // welcome appears straight after it. Never more than a few seconds.
  const [welcomeDecided, setWelcomeDecided] = useState(false);
  const decideWelcome = useCallback(() => setWelcomeDecided(true), []);
  useEffect(() => {
    if (!ready) return;
    if (welcomeDecided) {
      SplashScreen.hideAsync();
      return;
    }
    const fallback = setTimeout(() => SplashScreen.hideAsync(), 2500);
    return () => clearTimeout(fallback);
  }, [ready, welcomeDecided]);

  // Register this device once the person is in a circle.
  const userId = session?.user.id;
  const active = current?.status === "active";
  useEffect(() => {
    if (userId && active) registerForPush(userId).catch(() => {});
  }, [userId, active]);

  // Tapping a notification opens the app's main screen for this person: the
  // check-in for the person who checks in, the circle's home for everyone
  // else. Also covers a tap that launched the app, once it's ready.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledId = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (handledId.current === id) return;
    handledId.current = id;
    router.replace("/");
    // Someone asking to join goes straight to where the organizer approves them.
    const kind = lastResponse.notification.request.content.data?.type;
    if (kind === "join_request") router.push("/members");
  }, [ready, lastResponse]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
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
        <Stack.Screen name="subscribe" options={{ title: "Subscribe" }} />
        <Stack.Screen name="welcome-edit" options={{ title: "Welcome screen" }} />
      </Stack>
      <LaunchWelcome onDecided={decideWelcome} />
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
