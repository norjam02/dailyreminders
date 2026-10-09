// Turns a circle on. Setting up is free; inviting people, check-ins, and
// alerts need a subscription (or a pilot code during the pilot).

import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Card, Choice, ErrorText, Field, Gap, Screen, Section, T } from "@/components/ui";
import {
  DEFAULT_PRICES,
  loadPrices,
  openManageSubscription,
  restorePurchases,
  SIZES,
  startPurchase,
  STORE_NAME,
  type Billing,
  type PurchaseResult,
  type Size,
} from "@/lib/billing";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";

export default function Subscribe() {
  const { session, current, isOrganizer, isActive, memberLimit, refresh } = useSession();
  const params = useLocalSearchParams<{ upgrade?: string }>();
  const userId = session?.user.id;
  const circleId = current?.circle.id;
  const forMyself = current?.role === "parent";
  const name = current?.circle.name ?? "them";

  // Upgrading: the circle is on with room for 4, and they want room for 10.
  const [upgrading, setUpgrading] = useState(params.upgrade === "1");
  const [size, setSize] = useState<Size>(params.upgrade === "1" ? "plus" : "standard");
  const [billing, setBilling] = useState<Billing>("yearly");
  const [code, setCode] = useState("");
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [busy, setBusy] = useState<"buy" | "code" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId) loadPrices(userId).then(setPrices);
  }, [userId]);

  if (!isOrganizer || !circleId) {
    return (
      <Screen>
        <T>Only the person who set up this circle can subscribe.</T>
      </Screen>
    );
  }

  if (isActive && !(upgrading && memberLimit < 10)) {
    return (
      <Screen>
        <Card tone="done">
          <T variant="heading">Your circle is on</T>
          <T>Room for up to {memberLimit} people.</T>
        </Card>
        <Button label="Invite someone" onPress={() => router.replace("/invite")} />
        {memberLimit < 10 ? (
          <Button
            label="Make room for up to 10"
            variant="secondary"
            onPress={() => {
              setSize("plus");
              setUpgrading(true);
            }}
          />
        ) : null}
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
    const result = await startPurchase(size, billing, userId);
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
      {upgrading ? (
        <>
          <T variant="display">Make room for more</T>
          <T tone="muted">Your plan has room for {memberLimit} people. Plus has room for up to 10.</T>
        </>
      ) : (
        <>
          <T variant="display">Start your circle</T>
          <T tone="muted">Setting up DailyPulse is free. A subscription turns your circle on.</T>
          <View style={styles.benefits}>
            {benefits.map((b) => (
              <T key={b}>✓  {b}</T>
            ))}
          </View>

          <Section title="How many people?" hint="Count everyone, including the person who checks in and you.">
            {SIZES.map((z) => (
              <Choice
                key={z.id}
                label={z.label}
                description={z.id === "standard" ? "Most circles." : "For larger circles of family, caregivers, or support staff."}
                selected={size === z.id}
                onPress={() => setSize(z.id)}
              />
            ))}
          </Section>
        </>
      )}

      <Section title="Choose a plan" hint="One subscription covers your whole circle.">
        {prices
          .filter((p) => p.size === size)
          .map((p) => (
            <Choice
              key={p.billing}
              label={`${p.billing === "yearly" ? "Yearly" : "Monthly"}: ${p.price}`}
              description={p.description}
              selected={billing === p.billing}
              onPress={() => setBilling(p.billing)}
            />
          ))}
      </Section>

      <ErrorText message={error} />
      <Button label={upgrading ? "Upgrade" : "Subscribe"} onPress={buy} busy={busy === "buy"} disabled={!!busy} />
      <T tone="muted" variant="small">
        Paid through your {STORE_NAME} account. Renews automatically at the same price until you cancel, at least 24
        hours before the end of the period. Cancel anytime in your {STORE_NAME} settings.
      </T>

      {upgrading ? null : (
        <>
          <Button label="Restore a purchase" variant="quiet" onPress={restore} busy={busy === "restore"} disabled={!!busy} />
          <Gap />
          <Section title="Have a pilot code?">
            <Field label="Pilot code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
            <Button label="Use code" variant="secondary" onPress={applyCode} busy={busy === "code"} disabled={!!busy} />
          </Section>
        </>
      )}

      <Button label="Not now" variant="quiet" onPress={() => router.replace("/")} disabled={!!busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  benefits: { gap: space.xs },
});
