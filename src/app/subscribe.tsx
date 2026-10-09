// Turns a circle on. Setting up is free; inviting people, check-ins, and
// alerts need a subscription (or a pilot code during the pilot).

import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Card, Choice, ErrorText, Field, Gap, Screen, Section, T } from "@/components/ui";
import {
  DEFAULT_PLANS,
  loadPlans,
  openManageSubscription,
  restorePurchases,
  startPurchase,
  STORE_NAME,
  type PlanId,
  type PurchaseResult,
} from "@/lib/billing";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";

export default function Subscribe() {
  const { session, current, isOrganizer, isActive, refresh } = useSession();
  const userId = session?.user.id;
  const circleId = current?.circle.id;
  const forMyself = current?.role === "parent";
  const name = current?.circle.name ?? "them";

  const [plan, setPlan] = useState<PlanId>("yearly");
  const [code, setCode] = useState("");
  const [plans, setPlans] = useState(DEFAULT_PLANS);
  const [busy, setBusy] = useState<"buy" | "code" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId) loadPlans(userId).then(setPlans);
  }, [userId]);

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
        {userId ? (
          <Button label="Manage subscription" variant="secondary" onPress={() => openManageSubscription(userId)} />
        ) : null}
        <Button label="Done" variant="quiet" onPress={() => router.replace("/")} />
      </Screen>
    );
  }

  async function done() {
    await refresh();
    router.replace("/invite");
  }

  async function handle(result: PurchaseResult) {
    if (result.ok) return done();
    if (!result.cancelled) setError(result.message);
    await refresh();
  }

  async function buy() {
    if (!userId) return;
    setBusy("buy");
    setError(null);
    const result = await startPurchase(plan, userId);
    setBusy(null);
    await handle(result);
  }

  async function restore() {
    if (!userId) return;
    setBusy("restore");
    setError(null);
    const result = await restorePurchases(userId);
    setBusy(null);
    await handle(result);
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
        "Invite caregivers, support workers, family, and friends",
        "They hear if you miss a check-in",
        "Your photos and replies reach them",
      ]
    : [
        `A daily reminder on ${name}'s phone to check in`,
        "Invite caregivers, support workers, family, and friends",
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
        {plans.map((p) => (
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
        Paid through your {STORE_NAME} account. Renews automatically at the same price until you cancel, at least 24
        hours before the end of the period. Cancel anytime in your {STORE_NAME} settings.
      </T>
      <Button label="Restore a purchase" variant="quiet" onPress={restore} busy={busy === "restore"} disabled={!!busy} />

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
