// Turns a circle on. Setting up is free; inviting people, check-ins, and
// alerts need a subscription (or a pilot code during the pilot).

import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Card, Choice, ErrorText, Field, Gap, Screen, Section, T } from "@/components/ui";
import { PLANS, startPurchase, type PlanId } from "@/lib/billing";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";

export default function Subscribe() {
  const { current, isOrganizer, isActive, refresh } = useSession();
  const circleId = current?.circle.id;
  const forMyself = current?.role === "parent";
  const name = current?.circle.name ?? "them";

  const [plan, setPlan] = useState<PlanId>("yearly");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"buy" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOrganizer || !circleId) {
    return (
      <Screen>
        <T>Only the person who set up this circle can subscribe.</T>
      </Screen>
    );
  }

  if (isActive) {
    return (
      <Screen>
        <Card tone="done">
          <T variant="heading">Your circle is on</T>
          <T>Invite the people you want in it.</T>
        </Card>
        <Button label="Invite someone" onPress={() => router.replace("/invite")} />
        <Button label="Done" variant="quiet" onPress={() => router.replace("/")} />
      </Screen>
    );
  }

  async function done() {
    await refresh();
    router.replace("/invite");
  }

  async function buy() {
    if (!circleId) return;
    setBusy("buy");
    setError(null);
    const result = await startPurchase(plan, circleId);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    await done();
  }

  async function applyCode() {
    if (!circleId || !code.trim()) return setError("Enter your pilot code.");
    setBusy("code");
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("redeem_access_code", { p_circle: circleId, p_code: code });
    setBusy(null);
    if (rpcError) return setError(errorMessage(rpcError));
    if (!data) return setError("That code didn't work. Check it and try again.");
    await done();
  }

  const benefits = forMyself
    ? [
        "A daily reminder on your phone to check in",
        "Invite family, friends, and caregivers",
        "They hear if you miss a check-in",
        "Your photos and replies reach them",
      ]
    : [
        `A daily reminder on ${name}'s phone to check in`,
        "Invite family, friends, and caregivers",
        "An alert if a check-in is missed",
        `Photos and replies from ${name}`,
      ];

  return (
    <Screen>
      <T variant="display">Start your circle</T>
      <T tone="muted">Setting up DailyPulse is free. A subscription turns your circle on.</T>
      <View style={styles.benefits}>
        {benefits.map((b) => (
          <T key={b}>✓  {b}</T>
        ))}
      </View>

      <Section title="Choose a plan" hint="One subscription covers your whole circle.">
        {PLANS.map((p) => (
          <Choice
            key={p.id}
            label={`${p.label}: ${p.price}`}
            description={p.description}
            selected={plan === p.id}
            onPress={() => setPlan(p.id)}
          />
        ))}
      </Section>

      <ErrorText message={error} />
      <Button label="Subscribe" onPress={buy} busy={busy === "buy"} disabled={!!busy} />
      <T tone="muted" variant="small">
        Renews automatically until you cancel. Cancel anytime.
      </T>

      <Gap />
      <Section title="Have a pilot code?">
        <Field label="Pilot code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
        <Button label="Use code" variant="secondary" onPress={applyCode} busy={busy === "code"} disabled={!!busy} />
      </Section>

      <Button label="Not now" variant="quiet" onPress={() => router.replace("/")} disabled={!!busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  benefits: { gap: space.xs },
});
