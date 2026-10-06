// After joining, people wait here until the organizer approves them.

import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Gap, Screen, T } from "@/components/ui";
import { useSession } from "@/lib/session";
import { space } from "@/lib/theme";

export default function Waiting() {
  const { current, refresh, signOut } = useSession();
  const [checking, setChecking] = useState(false);

  // Check every 15 seconds while this screen is open.
  useEffect(() => {
    const timer = setInterval(() => refresh().catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!current || current.status !== "pending") return <Redirect href="/" />;

  return (
    <Screen scroll={false} topInset>
      <View style={styles.middle}>
        <T variant="display">Almost there</T>
        <Gap size="sm" />
        <T tone="muted">
          You&apos;ve asked to join {current.circle.name}&apos;s circle. You&apos;ll be in as soon as the person who set it
          up approves you. This screen updates on its own.
        </T>
      </View>
      <View style={styles.actions}>
        <Button
          label="Check now"
          variant="secondary"
          busy={checking}
          onPress={async () => {
            setChecking(true);
            await refresh().catch(() => {});
            setChecking(false);
          }}
        />
        <Button label="Sign out" variant="quiet" onPress={signOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: { flex: 1, justifyContent: "center" },
  actions: { gap: space.sm },
});
