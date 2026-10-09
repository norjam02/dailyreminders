// Sends each person to the right place: welcome, setup, waiting for approval,
// the parent's check-in screen, or the family's home.

import { Redirect, router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Button, Gap, Screen, T } from "@/components/ui";
import { useSession } from "@/lib/session";
import { space } from "@/lib/theme";

export default function Index() {
  const { session, current } = useSession();

  if (!session) return <Welcome />;
  if (!current) return <Redirect href={session.user.is_anonymous ? "/join" : "/setup"} />;
  if (current.status === "pending") return <Redirect href="/waiting" />;
  if (current.role === "parent") return <Redirect href="/checkin" />;
  return <Redirect href="/home" />;
}

function Welcome() {
  return (
    <Screen scroll={false} topInset>
      <View style={styles.top}>
        <T variant="display">DailyPulse</T>
        <Gap size="sm" />
        <T tone="muted">
          A small hello each day between someone and the people who look out for them. If a check-in doesn&apos;t come,
          their circle hears about it.
        </T>
      </View>
      <View style={styles.actions}>
        <Button label="Set up check-ins" onPress={() => router.push("/sign-in")} />
        <Button label="I have a join code" variant="secondary" onPress={() => router.push("/join")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1, justifyContent: "center" },
  actions: { gap: space.md },
});
