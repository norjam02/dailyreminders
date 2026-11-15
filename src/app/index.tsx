// Sends each person to the right place: welcome, setup, waiting for approval,
// the check-in screen for the person who checks in, or the circle's home.

import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { Button, Icon, icons, Screen, T, type IconName } from "@/components/ui";
import { useSession } from "@/lib/session";
import { colors, radius, space } from "@/lib/theme";

export default function Index() {
  const { session, current } = useSession();

  if (!session) return <Welcome />;
  if (!current) return <Redirect href={session.user.is_anonymous ? "/join" : "/setup"} />;
  if (current.status === "pending") return <Redirect href="/waiting" />;
  if (current.role === "parent") return <Redirect href="/checkin" />;
  return <Redirect href="/home" />;
}

// Three cards that say what DailyPulse does, then the two ways in.
const CARDS: { icon: IconName; tint: "warm" | "primary" | "done"; title: string; body: string }[] = [
  {
    icon: icons.wave,
    tint: "warm",
    title: "A daily hello",
    body: "One tap, a photo, or a quick reply. A check-in takes a few seconds.",
  },
  {
    icon: icons.bell,
    tint: "primary",
    title: "A quiet day never goes unnoticed",
    body: "If a check-in doesn't come, the people who care get a gentle heads-up.",
  },
  {
    icon: icons.people,
    tint: "done",
    title: "Everyone in the loop",
    body: "Family, friends, caregivers. Up to 10 people share one circle.",
  },
];

function Welcome() {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const cardWidth = width - space.lg * 2;

  return (
    <Screen scroll={false} topInset>
      <View style={styles.brand}>
        <Icon name={icons.heart} size={30} color={colors.warm} />
        <T variant="title">DailyPulse</T>
      </View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / cardWidth))}
      >
        {CARDS.map((card) => (
          <View key={card.title} style={[styles.card, { width: cardWidth }]} accessible accessibilityLabel={`${card.title}. ${card.body}`}>
            <View style={[styles.art, { backgroundColor: softTint[card.tint] }]}>
              <Icon name={card.icon} size={88} color={tint[card.tint]} />
            </View>
            <T variant="display" center>
              {card.title}
            </T>
            <T tone="muted" center>
              {card.body}
            </T>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {CARDS.map((card, i) => (
          <View key={card.title} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button label="Set up check-ins" onPress={() => router.push("/sign-in")} />
        <Button label="I have a join code" variant="secondary" onPress={() => router.push("/join")} />
      </View>
    </Screen>
  );
}

const tint = { warm: colors.warm, primary: colors.primary, done: colors.done };
const softTint = { warm: colors.warmSoft, primary: colors.primarySoft, done: colors.doneSoft };

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  pager: { flexGrow: 1, flexShrink: 1 },
  card: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.sm },
  art: { width: 180, height: 180, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  dots: { flexDirection: "row", justifyContent: "center", gap: space.sm, marginVertical: space.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.border, opacity: 0.4 },
  dotOn: { width: 24, backgroundColor: colors.primary, opacity: 1 },
  actions: { gap: space.md },
});
