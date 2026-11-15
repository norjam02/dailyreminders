// Turns a circle on. Setting up is free; inviting people, check-ins, and
// alerts need a subscription (or a pilot code during the pilot).

import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Card, Choice, ErrorText, Field, Gap, Icon, icons, Screen, Section, T } from "@/components/ui";
import {
  DEFAULT_PRICES,
  loadPrices,
  openManageSubscription,
  PURCHASES_AVAILABLE,
  restorePurchases,
  SIZES,
  startPurchase,
  STORE_NAME,
  syncWithServer,
  yearlySavings,
  type Billing,
  type PurchaseResult,
  type Size,
} from "@/lib/billing";
import { PRIVACY_URL, TERMS_URL } from "@/lib/links";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radius, shadow, space } from "@/lib/theme";

export default function Subscribe() {
  const { session, current, isOrganizer, isActive, memberLimit, refresh } = useSession();
  const params = useLocalSearchParams<{ upgrade?: string }>();
  const userId = session?.user.id;
  const circleId = current?.circle.id;
  const forMyself = current?.role === "parent";
  const name = current?.circle.name ?? "them";

  // Upgrading: the circle is active with room for 4, and they want room for 10.
  const [upgrading, setUpgrading] = useState(params.upgrade === "1");
  const [size, setSize] = useState<Size>(params.upgrade === "1" ? "plus" : "standard");
  const [billing, setBilling] = useState<Billing>("yearly");
  const [code, setCode] = useState("");
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [busy, setBusy] = useState<"buy" | "code" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  // The pilot code sits behind a small link once subscriptions are open.
  const [codeOpen, setCodeOpen] = useState(!PURCHASES_AVAILABLE);
  // Paid, waiting for the server to catch up.
  const [waiting, setWaiting] = useState<string | null>(null);
  const startLimit = useRef(memberLimit);

  useEffect(() => {
    if (userId) loadPrices(userId).then(setPrices).catch(() => {});
  }, [userId]);

  // While waiting, check every few seconds for up to two minutes.
  useEffect(() => {
    if (!waiting) return;
    AccessibilityInfo.announceForAccessibility(waiting);
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      await syncWithServer().catch(() => false);
      await refresh().catch(() => {});
      if (tries >= 24) clearInterval(timer);
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  // Once the purchase lands, move on to inviting people.
  useEffect(() => {
    if (!waiting) return;
    if (isActive && (!upgrading || memberLimit > startLimit.current)) {
      setWaiting(null);
      router.replace("/invite");
    }
  }, [waiting, isActive, upgrading, memberLimit]);

  if (!isOrganizer || !circleId) {
    return (
      <Screen>
        <T>Only the person who set up this circle can subscribe.</T>
      </Screen>
    );
  }

  if (isActive && !(upgrading && memberLimit < 10) && !waiting) {
    return (
      <Screen>
        <Card tone="done">
          <T variant="heading">Your circle is active</T>
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
        {userId && PURCHASES_AVAILABLE ? (
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
    if (result.pending) return setWaiting(result.message);
    if (!result.cancelled) setError(result.message);
    await refresh();
  }

  async function buy() {
    if (!userId) return;
    startLimit.current = memberLimit;
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
    if (!circleId || !code.trim()) return setCodeError("Enter your pilot code.");
    setBusy("code");
    setCodeError(null);
    const { data, error: rpcError } = await supabase.rpc("redeem_access_code", { p_circle: circleId, p_code: code });
    setBusy(null);
    if (rpcError) return setCodeError(errorMessage(rpcError));
    if (!data) return setCodeError("That code didn't work. Check it and try again.");
    await done();
  }

  if (waiting) {
    return (
      <Screen>
        <Card tone="done">
          <T variant="heading">Thank you!</T>
          <T>{waiting}</T>
        </Card>
        <T tone="muted">This page will move on by itself. You can also come back to it later.</T>
        <Button label="Done for now" variant="quiet" onPress={() => router.replace("/")} />
      </Screen>
    );
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

  const savings = yearlySavings(prices, size);
  const chosen = prices.find((p) => p.size === size && p.billing === billing);
  const trial = upgrading ? null : (chosen?.trial ?? null);

  const pilotCode = (
    <Section title="Have a pilot code?">
      <Field label="Pilot code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
      <ErrorText message={codeError} />
      <Button label="Use code" variant="secondary" onPress={applyCode} busy={busy === "code"} disabled={!!busy} />
    </Section>
  );

  return (
    <Screen>
      {upgrading ? (
        <>
          <T variant="display">Make room for more</T>
          <T tone="muted">Your plan has room for {memberLimit} people. The larger plan has room for up to 10.</T>
        </>
      ) : (
        <>
          <T variant="display">Start your circle</T>
          <T tone="muted">Setting up DailyPulse is free. A subscription makes your circle active.</T>
          <FeedPreview name={forMyself ? "You" : name} />
          <View style={styles.benefits}>
            {benefits.map((b) => (
              <View key={b} style={styles.benefit} accessible accessibilityLabel={b}>
                <Icon name={icons.done} size={22} color={colors.done} />
                <T style={styles.benefitText}>{b}</T>
              </View>
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
        <View style={styles.plans} accessibilityRole="radiogroup">
          {(["yearly", "monthly"] as const).map((b) => {
            const p = prices.find((x) => x.size === size && x.billing === b);
            if (!p) return null;
            return (
              <PlanCard
                key={b}
                title={b === "yearly" ? "Yearly" : "Monthly"}
                price={p.price}
                description={p.description}
                badge={b === "yearly" && savings ? `Save ${savings}%` : null}
                selected={billing === b}
                onPress={() => setBilling(b)}
              />
            );
          })}
        </View>
      </Section>

      {PURCHASES_AVAILABLE ? (
        <>
          <ErrorText message={error} />
          <Button
            label={upgrading ? "Upgrade" : trial ? `Try it free for ${trial}` : "Subscribe"}
            onPress={buy}
            busy={busy === "buy"}
            disabled={!!busy}
          />
          <T tone="muted" variant="small">
            {trial && chosen
              ? `Free for ${trial}, then ${chosen.price}. Cancel before the trial ends and you won't be charged. `
              : ""}
            You pay through your {STORE_NAME} account. Your plan renews by itself until you cancel. To stop the next
            charge, cancel at least 1 day before it renews, in your {STORE_NAME} settings.
          </T>
          {TERMS_URL || PRIVACY_URL ? (
            <View style={styles.links}>
              {TERMS_URL ? (
                <Button label="Terms of Use" variant="quiet" onPress={() => WebBrowser.openBrowserAsync(TERMS_URL!)} />
              ) : null}
              {PRIVACY_URL ? (
                <Button label="Privacy Policy" variant="quiet" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL!)} />
              ) : null}
            </View>
          ) : null}
          {upgrading ? null : (
            <Button
              label="Already subscribed? Restore it"
              variant="quiet"
              onPress={restore}
              busy={busy === "restore"}
              disabled={!!busy}
            />
          )}
        </>
      ) : (
        <Card>
          <T>Subscriptions open soon. If you&apos;re in the pilot, use your pilot code below.</T>
        </Card>
      )}

      {/* Pilot families need the code here too, including when their circle is full. */}
      {!upgrading || !PURCHASES_AVAILABLE ? (
        codeOpen ? (
          <>
            <Gap />
            {pilotCode}
          </>
        ) : (
          <Button label="Have a pilot code?" variant="quiet" onPress={() => setCodeOpen(true)} disabled={!!busy} />
        )
      ) : null}

      <Button label="Not now" variant="quiet" onPress={() => router.replace("/")} disabled={!!busy} />
    </Screen>
  );
}

// A glimpse of what the circle sees each day. An example, not real data.
function FeedPreview({ name }: { name: string }) {
  return (
    <View style={styles.preview} accessible accessibilityLabel={`For example: ${name} checked in at 9:58 AM and said "Love you!"`}>
      <T variant="small" tone="muted">
        Each day, your circle sees
      </T>
      <View style={styles.previewRow}>
        <Icon name={icons.done} size={40} color={colors.done} />
        <View style={styles.previewText}>
          <T variant="heading">{name === "You" ? "You checked in" : `${name} checked in`}</T>
          <T variant="small" tone="muted">
            9:58 AM today
          </T>
        </View>
      </View>
      <T variant="heading">&ldquo;Love you!&rdquo;</T>
    </View>
  );
}

// One plan, as a card the person taps to pick.
function PlanCard({
  title,
  price,
  description,
  badge,
  selected,
  onPress,
}: {
  title: string;
  price: string;
  description: string;
  badge: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[title, price, description, badge].filter(Boolean).join(", ")}
      style={[styles.plan, selected && styles.planSelected]}
    >
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{badge}</Text>
        </View>
      ) : (
        <View style={styles.badgeSpace} />
      )}
      <T variant="heading">{title}</T>
      <Text style={styles.planPrice}>{price}</Text>
      <T variant="small" tone="muted">
        {description}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  benefits: { gap: space.sm },
  benefit: { flexDirection: "row", alignItems: "center", gap: space.sm },
  benefitText: { flex: 1 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  preview: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md + 4,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow,
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  previewText: { flex: 1 },
  plans: { flexDirection: "row", gap: space.sm },
  plan: {
    flex: 1,
    padding: space.md,
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
  },
  planSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  planPrice: { fontFamily: fonts.heavy, fontSize: 22, lineHeight: 28, color: colors.ink },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.warm,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
  },
  // The badge's text sits on the warm accent, so it's always dark ink for contrast.
  badgeLabel: { fontFamily: fonts.bold, fontSize: 14, color: "#1A0F0B" },
  badgeSpace: { height: 25 },
});
