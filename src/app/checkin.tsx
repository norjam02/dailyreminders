// The check-in screen for the person who checks in: one big thing to do.
// Check in with a tap, a photo, or a selfie, add a friendly reply if they
// like, or put it off once with Later.

import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";

import { Button, Card, Chip, Chips, ErrorText, Gap, Icon, IconButton, icons, Screen, T, type IconName } from "@/components/ui";
import { streakDays } from "@/lib/streak";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radius, space } from "@/lib/theme";
import { clockTime, dayLabel } from "@/lib/time";
import type { Checkin, CheckinMode, CheckinPlan } from "@/lib/types";

const HOUR = 3_600_000;

function promptText(plan: CheckinPlan): string {
  if (plan.personal_note?.trim()) return plan.personal_note.trim();
  if (plan.mode === "selfie" || (plan.mode === "photo" && plan.photo_prompt === "a selfie")) return "Send a quick selfie.";
  if (plan.mode === "photo") return `Send a photo: ${plan.photo_prompt ?? "anything you like"}.`;
  return "Tap the button to say hello.";
}

export default function CheckinScreen() {
  const { session, current, isOrganizer, isActive } = useSession();
  const circleId = current?.circle.id;
  const organizerId = current?.circle.organizer_id;

  const [plan, setPlan] = useState<CheckinPlan | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [myName, setMyName] = useState<string | null>(null);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkin" | "later" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [doneDays, setDoneDays] = useState<Pick<Checkin, "status" | "scheduled_for">[]>([]);
  // Set when they check in on this screen, so the thank-you can celebrate.
  const [justDone, setJustDone] = useState(false);

  const load = useCallback(async () => {
    if (!circleId || !session) return;
    const from = new Date(Date.now() - 18 * HOUR).toISOString();
    const to = new Date(Date.now() + 36 * HOUR).toISOString();
    const [planResult, checkinResult, profileResult, streakResult] = await Promise.all([
      supabase.from("checkin_plans").select("*").eq("circle_id", circleId).maybeSingle(),
      supabase
        .from("checkins")
        .select("*")
        .eq("circle_id", circleId)
        .gte("scheduled_for", from)
        .lte("scheduled_for", to)
        .order("scheduled_for", { ascending: true }),
      supabase.from("profiles").select("id, display_name").in("id", [session.user.id, organizerId ?? session.user.id]),
      supabase
        .from("checkins")
        .select("status, scheduled_for")
        .eq("circle_id", circleId)
        .eq("status", "done")
        .gte("scheduled_for", new Date(Date.now() - 60 * 24 * HOUR).toISOString()),
    ]);
    setDoneDays((streakResult.data as Pick<Checkin, "status" | "scheduled_for">[] | null) ?? []);
    setPlan((planResult.data as CheckinPlan | null) ?? null);
    setCheckins((checkinResult.data as Checkin[] | null) ?? []);
    const profiles = (profileResult.data ?? []) as { id: string; display_name: string }[];
    setMyName(profiles.find((p) => p.id === session.user.id)?.display_name ?? null);
    setOrganizerName(profiles.find((p) => p.id === organizerId)?.display_name ?? null);
    setNow(Date.now());
  }, [circleId, organizerId, session]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  // Stay current: every minute, and whenever the app comes back to the front.
  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") load().catch(() => {});
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  const zone = plan?.timezone ?? "America/Chicago";
  const lastDone = [...checkins].reverse().find((c) => c.status === "done");
  const open = checkins
    .filter(
      (c) =>
        (c.status === "pending" && Date.parse(c.scheduled_for) <= now) ||
        // A missed check-in can still be answered late, for six hours.
        (c.status === "missed" && now - Date.parse(c.scheduled_for) < 6 * HOUR),
    )
    .filter((c) => !lastDone || Date.parse(c.scheduled_for) > Date.parse(lastDone.scheduled_for))
    .at(-1);
  const next = checkins.find((c) => c.status === "pending" && Date.parse(c.scheduled_for) > now);
  const wantsSelfie = plan?.mode === "selfie" || plan?.photo_prompt === "a selfie";
  const who = isOrganizer ? "Your circle" : (organizerName ?? "Your circle");

  async function respond(mode: CheckinMode, photoPath: string | null = null) {
    if (!open) return;
    const { error: rpcError } = await supabase.rpc("respond_checkin", {
      p_checkin: open.id,
      p_mode: mode,
      p_quick_reply: reply,
      p_photo_path: photoPath,
    });
    if (rpcError) throw rpcError;
    setReply(null);
    setJustDone(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility("You checked in. Thank you.");
    await load();
  }

  async function checkIn(mode: CheckinMode) {
    if (!open || !circleId) return;
    setBusy("checkin");
    setError(null);
    try {
      if (mode === "button") {
        await respond("button");
        return;
      }
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('The camera is off for DailyPulse. You can still check in: tap "Just check in" below.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.5,
        cameraType: wantsSelfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const contentType = asset.mimeType ?? "image/jpeg";
      const extension = contentType === "image/png" ? "png" : contentType === "image/heic" ? "heic" : "jpg";
      const path = `${circleId}/${open.id}-${Date.now()}.${extension}`;
      const bytes = await new File(asset.uri).bytes();
      const { error: uploadError } = await supabase.storage.from("checkin-photos").upload(path, bytes, { contentType });
      if (uploadError) throw uploadError;
      await respond(mode, path);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function later() {
    if (!open) return;
    setBusy("later");
    setError(null);
    const { error: rpcError } = await supabase.rpc("snooze_checkin", { p_checkin: open.id });
    setBusy(null);
    if (rpcError) return setError(errorMessage(rpcError));
    await load();
  }

  const nextLine = next
    ? `Your next check-in is ${dayLabel(next.scheduled_for, zone).toLowerCase()} at ${clockTime(next.scheduled_for, zone)}.`
    : null;

  const streak = streakDays(doneDays, zone, now);

  return (
    <Screen topInset onRefresh={() => load()} refreshing={false}>
      <View style={styles.header}>
        <T variant="display" style={styles.headerTitle}>
          {myName ? `Hi, ${myName}` : "Hi there"}
        </T>
        <IconButton name={icons.people} label="My Circle" onPress={() => router.push("/members")} />
        {isOrganizer ? (
          <IconButton name={icons.settings} label="Check-in settings" onPress={() => router.push("/plan")} />
        ) : null}
      </View>

      {isOrganizer && !isActive ? (
        <Card tone="attention">
          <T variant="heading">Your circle isn&apos;t active yet</T>
          <T>Subscribe to start your daily check-ins and invite the people who look out for you.</T>
          <Button label="See plans" onPress={() => router.push("/subscribe")} />
        </Card>
      ) : null}

      {open && plan ? (
        <>
          <T variant="title">Time to say hello</T>
          <T>{promptText(plan)}</T>

          {plan.quick_replies.length > 0 ? (
            <View style={styles.replies}>
              <T variant="small" tone="muted">
                Add a message, if you like
              </T>
              <Chips>
                {plan.quick_replies.map((r) => (
                  <Chip key={r} label={r} single selected={reply === r} onPress={() => setReply(reply === r ? null : r)} />
                ))}
              </Chips>
              {reply ? (
                <T variant="small" tone="muted">
                  &ldquo;{reply}&rdquo; will be sent when you check in.
                </T>
              ) : null}
            </View>
          ) : null}

          <BigButton
            icon={plan.mode === "button" ? icons.wave : icons.camera}
            label={plan.mode === "button" ? "Check in" : wantsSelfie ? "Take a selfie" : "Take a photo"}
            busy={busy === "checkin"}
            onPress={() => checkIn(plan.mode)}
          />
          <ErrorText message={error} />

          {plan.mode !== "button" ? (
            <Button
              label="Can't take a picture today? Just check in"
              variant="quiet"
              onPress={async () => {
                setBusy("checkin");
                setError(null);
                try {
                  await respond("button");
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(null);
                }
              }}
              disabled={!!busy}
            />
          ) : null}

          {open.status === "pending" && !open.snoozed_until ? (
            <Button label="Remind me in 30 minutes" variant="secondary" onPress={later} busy={busy === "later"} disabled={!!busy} />
          ) : open.snoozed_until && Date.parse(open.snoozed_until) > now ? (
            <T tone="muted" center>
              Reminders are paused until {clockTime(open.snoozed_until, zone)}.
            </T>
          ) : null}
        </>
      ) : lastDone && Date.now() - Date.parse(lastDone.scheduled_for) < 12 * HOUR ? (
        <>
          <Animated.View
            entering={justDone ? ZoomIn.springify().damping(14) : undefined}
            style={[styles.big, styles.done]}
            accessible
            accessibilityLabel="You checked in"
          >
            <Icon name={icons.done} size={96} color={colors.onPrimary} />
            <Text style={styles.doneLabel}>You checked in</Text>
          </Animated.View>
          <T>{who} will see it. Thank you.</T>
          {streak >= 2 ? (
            <View style={styles.streak} accessible accessibilityLabel={`${streak} days in a row`}>
              <Icon name={icons.streak} size={28} color={colors.warm} />
              <T variant="heading">{streak} days in a row</T>
            </View>
          ) : null}
          {nextLine ? <T tone="muted">{nextLine}</T> : null}
        </>
      ) : (
        <>
          <Gap />
          <T variant="title">Nothing to do right now</T>
          <T tone="muted">{nextLine ?? (isOrganizer ? "Choose your check-in times in Check-in settings." : `${who} hasn't set up check-in times yet.`)}</T>
        </>
      )}

      <Gap size="lg" />
      <T tone="muted" center>
        This isn&apos;t an emergency service. In an emergency, call 911.
      </T>
    </Screen>
  );
}

// The one thing to do. It breathes gently to draw the eye, unless the phone
// asks for reduced motion.
function BigButton({ label, icon, onPress, busy }: { label: string; icon: IconName; onPress: () => void; busy: boolean }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion || busy) {
      scale.value = withTiming(1);
      return;
    }
    scale.value = withRepeat(withSequence(withTiming(1.03, { duration: 1100 }), withTiming(1, { duration: 1100 })), -1);
  }, [reduceMotion, busy, scale]);
  const breathe = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={breathe}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onPress();
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy }}
        style={({ pressed }) => [styles.big, { backgroundColor: pressed ? colors.primaryPressed : colors.primary }]}
      >
        {busy ? null : <Icon name={icon} size={64} color={colors.onPrimary} />}
        <Text style={styles.bigLabel}>{busy ? "One moment…" : label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerTitle: { flex: 1 },
  streak: { flexDirection: "row", alignItems: "center", gap: space.sm },
  replies: { gap: space.xs },
  big: {
    minHeight: 220,
    borderRadius: radius.card * 2,
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    padding: space.lg,
    marginVertical: space.sm,
  },
  bigLabel: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 48, color: colors.onPrimary, textAlign: "center" },
  done: { backgroundColor: colors.done },
  doneLabel: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: colors.onPrimary },
});
