// Home for the organizer and the rest of the family: how today's check-ins
// went, recent days with photos and replies, and what's coming next.

import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Card, Gap, Screen, T } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { clockTime, dayLabel } from "@/lib/time";
import type { Checkin, CheckinPlan, Member } from "@/lib/types";

const DAY = 86_400_000;

export default function Home() {
  const { current, isOrganizer, isActive, signOut } = useSession();
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
        .gte("scheduled_for", new Date(Date.now() - 14 * DAY).toISOString())
        .lte("scheduled_for", new Date(Date.now() + 2 * DAY).toISOString())
        .order("scheduled_for", { ascending: false }),
    ]);
    const rows = (checkinResult.data as Checkin[] | null) ?? [];
    setPlan((planResult.data as CheckinPlan | null) ?? null);
    setMembers((memberResult.data as unknown as Member[] | null) ?? []);
    setCheckins(rows);

    const paths = rows.map((c) => c.photo_path).filter((p): p is string => !!p);
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

  const parent = members.find((m) => m.role === "parent" && m.status === "active");
  const parentName = parent?.profile?.display_name ?? current.circle.name;
  const waiting = members.filter((m) => m.status === "pending");
  const zone = plan?.timezone ?? "America/Chicago";
  const now = Date.now();
  const upcoming = [...checkins].reverse().find((c) => c.status === "pending" && Date.parse(c.scheduled_for) > now);
  const history = checkins.filter((c) => Date.parse(c.scheduled_for) <= now);

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
      <T variant="display">{current.circle.name}</T>

      {isOrganizer && !isActive ? (
        <Card tone="attention">
          <T variant="heading">Your circle isn&apos;t on yet</T>
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
          <T tone="muted">Choose how and when {parentName} checks in.</T>
          <Button label="Set up check-ins" onPress={() => router.push("/plan")} />
        </Card>
      ) : null}

      {loaded && plan && !parent ? (
        <Card>
          <T variant="heading">{current.circle.name} hasn&apos;t joined yet</T>
          <T tone="muted">Check-ins start once they join with a code and you approve them.</T>
          {isOrganizer ? <Button label="Invite them" onPress={() => router.push("/invite")} /> : null}
        </Card>
      ) : null}

      {upcoming ? (
        <T tone="muted">
          Next check-in: {dayLabel(upcoming.scheduled_for, zone).toLowerCase()} at{" "}
          {clockTime(upcoming.scheduled_for, zone)}
        </T>
      ) : null}

      {history.map((c) => (
        <CheckinCard
          key={c.id}
          checkin={c}
          parentName={parentName}
          zone={zone}
          photoUrl={c.photo_path ? photos[c.photo_path] : undefined}
        />
      ))}

      {loaded && plan && parent && history.length === 0 ? (
        <T tone="muted">Check-ins will show here as they happen.</T>
      ) : null}

      <Gap />
      {isOrganizer ? (
        <View style={styles.actions}>
          <Button label="Invite someone" variant="secondary" onPress={() => router.push("/invite")} />
          <Button label="Check-in settings" variant="secondary" onPress={() => router.push("/plan")} />
          <Button label="My Circle" variant="secondary" onPress={() => router.push("/members")} />
        </View>
      ) : (
        <Button label="My Circle" variant="secondary" onPress={() => router.push("/members")} />
      )}
      <Button label="Sign out" variant="quiet" onPress={signOut} />
    </Screen>
  );
}

function CheckinCard({
  checkin,
  parentName,
  zone,
  photoUrl,
}: {
  checkin: Checkin;
  parentName: string;
  zone: string;
  photoUrl?: string;
}) {
  const when = `${dayLabel(checkin.scheduled_for, zone)}, ${clockTime(checkin.scheduled_for, zone)}`;

  if (checkin.status === "done") {
    const how =
      checkin.response_mode === "button" ? "Checked in" : checkin.response_mode === "selfie" ? "Sent a selfie" : "Sent a photo";
    return (
      <Card tone="done">
        <T variant="small" tone="muted">
          {when}
        </T>
        <T variant="heading" tone="done">
          {how} at {clockTime(checkin.responded_at ?? checkin.scheduled_for, zone)}
        </T>
        {checkin.quick_reply ? <T>“{checkin.quick_reply}”</T> : null}
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            contentFit="cover"
            accessibilityLabel={`Photo from ${parentName}`}
          />
        ) : null}
      </Card>
    );
  }

  if (checkin.status === "missed") {
    return (
      <Card tone="attention">
        <T variant="small" tone="muted">
          {when}
        </T>
        <T variant="heading" tone="attention">
          No check-in from {parentName}
        </T>
        <T tone="muted">A call might be good.</T>
      </Card>
    );
  }

  return (
    <Card>
      <T variant="small" tone="muted">
        {when}
      </T>
      <T variant="heading">Waiting for {parentName}</T>
      {checkin.snoozed_until ? <T tone="muted">They tapped Later.</T> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.sm },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.control },
});
