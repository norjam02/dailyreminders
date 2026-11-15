// Home for the organizer and the rest of the circle. The top of the screen
// answers one question, "Is everything OK today?", in a big status card. Below
// it: the streak, and recent check-ins with their photos and replies.

import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button, Card, Icon, IconButton, icons, Screen, T, type IconName } from "@/components/ui";
import { useSession } from "@/lib/session";
import { sameDay, streakDays } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";
import { clockTime, dayLabel } from "@/lib/time";
import type { Checkin, CheckinPlan, Member } from "@/lib/types";

const DAY = 86_400_000;
// Recent check-ins shown in the list; the streak looks further back.
const LIST_DAYS = 14;
const STREAK_DAYS = 60;

export default function Home() {
  const { current, isOrganizer, isActive } = useSession();
  const circleId = current?.circle.id;

  const [plan, setPlan] = useState<CheckinPlan | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!circleId) return;
    const [planResult, memberResult, checkinResult] = await Promise.all([
      supabase.from("checkin_plans").select("*").eq("circle_id", circleId).maybeSingle(),
      supabase
        .from("circle_members")
        .select("circle_id, user_id, role, status, profile:profiles(display_name)")
        .eq("circle_id", circleId)
        .neq("status", "removed"),
      supabase
        .from("checkins")
        .select("*")
        .eq("circle_id", circleId)
        .gte("scheduled_for", new Date(Date.now() - STREAK_DAYS * DAY).toISOString())
        .lte("scheduled_for", new Date(Date.now() + 2 * DAY).toISOString())
        .order("scheduled_for", { ascending: false }),
    ]);
    const rows = (checkinResult.data as Checkin[] | null) ?? [];
    setPlan((planResult.data as CheckinPlan | null) ?? null);
    setMembers((memberResult.data as unknown as Member[] | null) ?? []);
    setCheckins(rows);

    const recent = rows.filter((c) => Date.parse(c.scheduled_for) > Date.now() - LIST_DAYS * DAY);
    const paths = recent.map((c) => c.photo_path).filter((p): p is string => !!p);
    if (paths.length) {
      const { data } = await supabase.storage.from("checkin-photos").createSignedUrls(paths, 3600);
      const urls: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
      }
      setPhotos(urls);
    }
    setLoaded(true);
  }, [circleId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  if (!current) return null;

  // The person who checks in: anyone, from a parent to a friend to the
  // subscriber themselves. Always called by their own name.
  const person = members.find((m) => m.role === "parent" && m.status === "active");
  const name = person?.profile?.display_name ?? current.circle.name;
  const waiting = members.filter((m) => m.status === "pending");
  const zone = plan?.timezone ?? "America/Chicago";
  const now = Date.now();
  const upcoming = [...checkins].reverse().find((c) => c.status === "pending" && Date.parse(c.scheduled_for) > now);
  const past = checkins.filter((c) => Date.parse(c.scheduled_for) <= now);
  const today = past.find((c) => sameDay(c.scheduled_for, zone, now)) ?? null;
  const history = past.filter((c) => c !== today && Date.parse(c.scheduled_for) > now - LIST_DAYS * DAY);
  const streak = streakDays(checkins, zone, now);
  const ready = loaded && !!plan && !!person;

  return (
    <Screen
      topInset
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load().catch(() => {});
        setRefreshing(false);
      }}
    >
      <View style={styles.header}>
        <T variant="display" style={styles.headerTitle}>
          {current.circle.name}
        </T>
        <IconButton name={icons.people} label="My Circle" onPress={() => router.push("/members")} />
        {isOrganizer ? (
          <IconButton name={icons.settings} label="Check-in settings" onPress={() => router.push("/plan")} />
        ) : null}
      </View>

      {isOrganizer && !isActive ? (
        <Card tone="attention">
          <T variant="heading">Your circle isn&apos;t active yet</T>
          <T>Subscribe to invite people and start daily check-ins.</T>
          <Button label="See plans" onPress={() => router.push("/subscribe")} />
        </Card>
      ) : null}

      {isOrganizer && waiting.length > 0 ? (
        <Card tone="attention">
          <T variant="heading">
            {waiting.length === 1
              ? `${waiting[0].profile?.display_name ?? "Someone"} is waiting to join`
              : `${waiting.length} people are waiting to join`}
          </T>
          <Button label="Review" onPress={() => router.push("/members")} />
        </Card>
      ) : null}

      {loaded && isOrganizer && !plan ? (
        <Card>
          <T variant="heading">Set up check-ins</T>
          <T tone="muted">Choose how and when {name} checks in.</T>
          <Button label="Set up check-ins" onPress={() => router.push("/plan")} />
        </Card>
      ) : null}

      {loaded && plan && !person ? (
        <Card>
          <T variant="heading">{current.circle.name} hasn&apos;t joined yet</T>
          <T tone="muted">
            {isOrganizer
              ? "Check-ins start as soon as they join with their code."
              : "Check-ins start once they join."}
          </T>
          {isOrganizer ? <Button label="Invite them" onPress={() => router.push("/invite")} /> : null}
        </Card>
      ) : null}

      {ready ? (
        <Animated.View entering={FadeInDown.duration(350)}>
          <StatusHero
            today={today}
            upcoming={upcoming ?? null}
            name={name}
            zone={zone}
            photoUrl={today?.photo_path ? photos[today.photo_path] : undefined}
          />
        </Animated.View>
      ) : null}

      {ready && streak >= 2 ? (
        <Animated.View entering={FadeInDown.duration(350).delay(80)}>
          <View style={styles.streak} accessible accessibilityLabel={`${name} has checked in ${streak} days in a row`}>
            <Icon name={icons.streak} size={30} color={colors.warm} />
            <View style={styles.streakText}>
              <T variant="heading">{streak} days in a row</T>
              <T variant="small" tone="muted">
                {name}&apos;s check-in streak
              </T>
            </View>
          </View>
        </Animated.View>
      ) : null}

      {history.length > 0 ? (
        <T variant="heading" style={styles.recent}>
          Recent
        </T>
      ) : null}

      {history.map((c) => (
        <CheckinCard
          key={c.id}
          checkin={c}
          name={name}
          zone={zone}
          photoUrl={c.photo_path ? photos[c.photo_path] : undefined}
        />
      ))}

      {ready && past.length === 0 ? <T tone="muted">Check-ins will show here as they happen.</T> : null}
    </Screen>
  );
}

// The big card at the top: today's check-in, or the next one.
function StatusHero({
  today,
  upcoming,
  name,
  zone,
  photoUrl,
}: {
  today: Checkin | null;
  upcoming: Checkin | null;
  name: string;
  zone: string;
  photoUrl?: string;
}) {
  let tone: "done" | "attention" | "plain" = "plain";
  let icon: IconName = icons.upcoming;
  let title: string;
  let line: string | null = null;

  if (today?.status === "done") {
    tone = "done";
    icon = icons.done;
    title = `${name} checked in`;
    line = `${clockTime(today.responded_at ?? today.scheduled_for, zone)} today`;
  } else if (today?.status === "missed") {
    tone = "attention";
    icon = icons.missed;
    title = `No check-in from ${name} yet`;
    line = `Expected at ${clockTime(today.scheduled_for, zone)}. A call might be good.`;
  } else if (today) {
    icon = icons.waiting;
    title = `Waiting for ${name}`;
    line = today.snoozed_until
      ? `They asked to be reminded at ${clockTime(today.snoozed_until, zone)}.`
      : `Due at ${clockTime(today.scheduled_for, zone)}.`;
  } else if (upcoming) {
    title = "Next check-in";
    line = `${dayLabel(upcoming.scheduled_for, zone)} at ${clockTime(upcoming.scheduled_for, zone)}`;
  } else {
    title = "No check-ins scheduled";
  }

  const accent = tone === "done" ? colors.done : tone === "attention" ? colors.attention : colors.primary;
  const background = tone === "done" ? colors.doneSoft : tone === "attention" ? colors.attentionSoft : colors.primarySoft;

  return (
    <View
      style={[styles.hero, { backgroundColor: background, borderColor: accent }]}
      accessible
      accessibilityLabel={[title, line, today?.quick_reply].filter(Boolean).join(". ")}
    >
      <View style={styles.heroTop}>
        <Icon name={icon} size={56} color={accent} />
        <View style={styles.heroText}>
          <T variant="title">{title}</T>
          {line ? <T tone="muted">{line}</T> : null}
        </View>
      </View>
      {today?.quick_reply ? <T variant="heading">&ldquo;{today.quick_reply}&rdquo;</T> : null}
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.heroPhoto} contentFit="cover" transition={250} />
      ) : null}
    </View>
  );
}

function CheckinCard({
  checkin,
  name,
  zone,
  photoUrl,
}: {
  checkin: Checkin;
  name: string;
  zone: string;
  photoUrl?: string;
}) {
  const when = `${dayLabel(checkin.scheduled_for, zone)}, ${clockTime(checkin.scheduled_for, zone)}`;

  if (checkin.status === "done") {
    const how =
      checkin.response_mode === "button" ? "Checked in" : checkin.response_mode === "selfie" ? "Sent a selfie" : "Sent a photo";
    return (
      <Card>
        <View style={styles.cardRow}>
          <Icon name={checkin.response_mode === "button" ? icons.done : icons.photo} color={colors.done} />
          <View style={styles.cardText}>
            <T variant="small" tone="muted">
              {when}
            </T>
            <T variant="heading">
              {how} at {clockTime(checkin.responded_at ?? checkin.scheduled_for, zone)}
            </T>
          </View>
        </View>
        {checkin.quick_reply ? <T>&ldquo;{checkin.quick_reply}&rdquo;</T> : null}
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            contentFit="cover"
            transition={250}
            accessibilityLabel={`Photo from ${name}`}
          />
        ) : null}
      </Card>
    );
  }

  if (checkin.status === "missed") {
    return (
      <Card>
        <View style={styles.cardRow}>
          <Icon name={icons.missed} color={colors.attention} />
          <View style={styles.cardText}>
            <T variant="small" tone="muted">
              {when}
            </T>
            <T variant="heading">No check-in from {name}</T>
          </View>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.cardRow}>
        <Icon name={icons.waiting} color={colors.muted} />
        <View style={styles.cardText}>
          <T variant="small" tone="muted">
            {when}
          </T>
          <T variant="heading">Waiting for {name}</T>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerTitle: { flex: 1 },
  hero: {
    borderRadius: radius.card + 6,
    borderWidth: 2,
    padding: space.lg,
    gap: space.md,
  },
  heroTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  heroText: { flex: 1, gap: 2 },
  heroPhoto: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.control },
  streak: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  streakText: { flex: 1 },
  recent: { marginTop: space.sm },
  cardRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  cardText: { flex: 1 },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.control },
});
