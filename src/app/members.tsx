// Everyone in the circle. The organizer approves new people and can remove
// anyone else. Others can leave.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { Button, Card, ErrorText, Screen, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { roleLabel, type Member } from "@/lib/types";

export default function Members() {
  const { session, current, isOrganizer, refresh } = useSession();
  const circleId = current?.circle.id;
  const organizerId = current?.circle.organizer_id;

  const [members, setMembers] = useState<Member[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!circleId) return;
    const { data, error: loadError } = await supabase
      .from("circle_members")
      .select("circle_id, user_id, role, status, profile:profiles(display_name)")
      .eq("circle_id", circleId)
      .neq("status", "removed")
      .order("joined_at", { ascending: true });
    if (loadError) return setError(errorMessage(loadError));
    setMembers((data as unknown as Member[] | null) ?? []);
  }, [circleId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  async function approve(member: Member) {
    setBusyId(member.user_id);
    setError(null);
    const { error: rpcError } = await supabase.rpc("approve_member", { p_circle: circleId, p_user: member.user_id });
    setBusyId(null);
    if (rpcError) return setError(errorMessage(rpcError));
    await load();
  }

  function remove(member: Member) {
    const self = member.user_id === session?.user.id;
    const name = member.profile?.display_name ?? "this person";
    Alert.alert(
      self ? "Leave this circle?" : `Remove ${name}?`,
      self ? "You'll stop getting check-ins and alerts." : `${name} will stop getting check-ins and alerts.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: self ? "Leave" : "Remove",
          style: "destructive",
          onPress: async () => {
            setBusyId(member.user_id);
            setError(null);
            const { error: rpcError } = await supabase.rpc("remove_member", {
              p_circle: circleId,
              p_user: member.user_id,
            });
            setBusyId(null);
            if (rpcError) return setError(errorMessage(rpcError));
            if (self) {
              await refresh();
              router.replace("/");
            } else {
              await load();
            }
          },
        },
      ],
    );
  }

  const waiting = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  return (
    <Screen>
      <ErrorText message={error} />

      {isOrganizer && waiting.length > 0 ? (
        <View style={styles.group}>
          <T variant="title">Waiting to join</T>
          {waiting.map((m) => (
            <Card key={m.user_id} tone="attention">
              <T variant="heading">{m.profile?.display_name ?? "Someone"}</T>
              <T tone="muted">Joined as {roleLabel[m.role].toLowerCase()}</T>
              <Button label="Approve" onPress={() => approve(m)} busy={busyId === m.user_id} />
              <Button label="Decline" variant="quiet" onPress={() => remove(m)} disabled={busyId === m.user_id} />
            </Card>
          ))}
        </View>
      ) : null}

      <View style={styles.group}>
        <T variant="title">In the circle</T>
        {active.map((m) => {
          const isMe = m.user_id === session?.user.id;
          const isOrg = m.user_id === organizerId;
          const canRemove = isOrganizer ? !isMe : isMe;
          return (
            <Card key={m.user_id}>
              <T variant="heading">
                {m.profile?.display_name ?? "Someone"}
                {isMe ? " (you)" : ""}
              </T>
              <T tone="muted">
                {roleLabel[m.role]}
                {isOrg ? ", set up this circle" : ""}
              </T>
              {canRemove ? (
                <Button
                  label={isMe ? "Leave the circle" : "Remove"}
                  variant="quiet"
                  onPress={() => remove(m)}
                  disabled={busyId === m.user_id}
                />
              ) : null}
            </Card>
          );
        })}
      </View>

      {isOrganizer ? <Button label="Invite someone" onPress={() => router.push("/invite")} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
});
