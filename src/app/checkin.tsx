// The parent's screen: one big thing to do. Check in with a tap, a photo, or a
// selfie, add a friendly reply if they like, or put it off once with Later.

import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Card, Chip, Chips, ErrorText, Gap, Screen, T } from "@/components/ui";
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
  const { session, current, isOrganizer, isActive, signOut } = useSession();
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

  const load = useCallback(async () => {
    if (!circleId || !session) return;
    const from = new Date(Date.now() - 18 * HOUR).toISOString();
    const to = new Date(Date.now() + 36 * HOUR).toISOString();
    const [planResult, checkinResult, profileResult] = await Promise.all([
      supabase.from("checkin_plans").select("*").eq("circle_id", circleId).maybeSingle(),
      supabase
        .from("checkins")
        .select("*")
        .eq("circle_id", circleId)
        .gte("scheduled_for", from)
        .lte("scheduled_for", to)
        .order("scheduled_for", { ascending: true }),
      supabase.from("profiles").select("id, display_name").in("id", [session.user.id, organizerId ?? session.user.id]),
    ]);
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
  const who = isOrganizer ? "Your family" : (organizerName ?? "Your family");

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
        setError("The camera is turned off for this app. Turn it on in Settings, or just check in below.");
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

  return (
    <Screen topInset onRefresh={() => load()} refreshing={false}>
      <T variant="display">
        {myName ? `Hi, ${myName}` : "Hi there"}
      </T>

      {isOrganizer && !isActive ? (
        <Card tone="attention">
          <T variant="heading">Your circle isn&apos;t on yet</T>
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
                  <Chip key={r} label={r} selected={reply === r} onPress={() => setReply(reply === r ? null : r)} />
                ))}
              </Chips>
            </View>
          ) : null}

          <BigButton
            label={plan.mode === "button" ? "Check in" : wantsSelfie ? "Take a selfie" : "Take a photo"}
            busy={busy === "checkin"}
            onPress={() => checkIn(plan.mode)}
          />

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

          <ErrorText message={error} />
        </>
      ) : lastDone && Date.now() - Date.parse(lastDone.scheduled_for) < 12 * HOUR ? (
        <>
          <View style={[styles.big, styles.done]} accessible accessibilityLabel="You checked in">
            <Text style={styles.bigLabel}>✓</Text>
            <Text style={styles.doneLabel}>You checked in</Text>
          </View>
          <T>{who} will see it. Thank you.</T>
          {nextLine ? <T tone="muted">{nextLine}</T> : null}
        </>
      ) : (
        <>
          <Gap />
          <T variant="title">Nothing to do right now</T>
          <T tone="muted">{nextLine ?? (isOrganizer ? "Choose your check-in times in Check-in settings." : `${who} hasn't set up check-in times yet.`)}</T>
        </>
      )}

      {isOrganizer ? (
        <>
          <Gap size="lg" />
          <Button label="Check-in settings" variant="secondary" onPress={() => router.push("/plan")} />
          <Button label="Invite someone" variant="secondary" onPress={() => router.push("/invite")} />
          <Button label="My Circle" variant="secondary" onPress={() => router.push("/members")} />
          <Button label="Sign out" variant="quiet" onPress={signOut} />
        </>
      ) : null}

      <Gap size="lg" />
      <T tone="muted" center>
        This isn&apos;t an emergency service. In an emergency, call 911.
      </T>
    </Screen>
  );
}

function BigButton({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.big, { backgroundColor: pressed ? colors.primaryPressed : colors.primary }]}
    >
      <Text style={styles.bigLabel}>{busy ? "One moment…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  replies: { gap: space.xs },
  big: {
    minHeight: 220,
    borderRadius: radius.card * 2,
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    marginVertical: space.sm,
  },
  bigLabel: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 48, color: colors.onPrimary, textAlign: "center" },
  done: { backgroundColor: colors.done },
  doneLabel: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: colors.onPrimary },
});
