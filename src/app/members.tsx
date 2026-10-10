// Everyone in the circle. The organizer approves new people and can remove
// anyone else. Others can leave.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { Button, Card, ErrorText, Screen, T } from "@/components/ui";
import { openManageSubscription, PURCHASES_AVAILABLE } from "@/lib/billing";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import type { Member } from "@/lib/types";

export default function Members() {
  const { session, current, isOrganizer, memberLimit, refresh, signOut } = useSession();
  const circleId = current?.circle.id;
  const organizerId = current?.circle.organizer_id;

  const [members, setMembers] = useState<Member[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const viewerIsParent = current?.role === "parent";
  const personName = current?.circle.name ?? "them";

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
    const pending = member.status === "pending";
    const name = member.profile?.display_name ?? "this person";
    Alert.alert(
      self ? "Leave this circle?" : pending ? `Decline ${name}'s request?` : `Remove ${name}?`,
      self
        ? "You'll stop getting check-ins and alerts."
        : pending
          ? `${name} won't join the circle.`
          : `${name} will stop getting check-ins and alerts.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: self ? "Leave" : pending ? "Decline" : "Remove",
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

  function deleteAccount() {
    Alert.alert(
      "Delete your account?",
      isOrganizer
        ? "This deletes your account and the circle you set up, with its check-ins and photos, for everyone in it. It can't be undone. If you pay for a subscription, cancel it in your phone's App Store or Google Play settings too."
        : "This deletes your account and removes you from the circle. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        ...(isOrganizer && PURCHASES_AVAILABLE && session
          ? [{ text: "Cancel my subscription first", onPress: () => openManageSubscription(session.user.id) }]
          : []),
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            setError(null);
            const { error: fnError } = await supabase.functions.invoke("delete-account", { body: {} });
            setDeleting(false);
            if (fnError) return setError("Couldn't delete your account. Check your connection and try again.");
            await signOut();
          },
        },
      ],
    );
  }

  const waiting = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  return (
    <Screen>
      {isOrganizer ? <Button label="Invite someone" onPress={() => router.push("/invite")} /> : null}
      <ErrorText message={error} />

      {isOrganizer && waiting.length > 0 ? (
        <View style={styles.group}>
          <T variant="title">Waiting to join</T>
          {waiting.map((m) => (
            <Card key={m.user_id} tone="attention">
              <T variant="heading">{m.profile?.display_name ?? "Someone"}</T>
              <T tone="muted">{m.role === "parent" ? "Will check in each day" : "Will see check-ins and hear about missed ones"}</T>
              <Button
                label="Approve"
                a11yLabel={`Approve ${m.profile?.display_name ?? "this person"}`}
                onPress={() => approve(m)}
                busy={busyId === m.user_id}
              />
              <Button
                label="Decline"
                a11yLabel={`Decline ${m.profile?.display_name ?? "this person"}`}
                variant="quiet"
                onPress={() => remove(m)}
                disabled={busyId === m.user_id}
              />
            </Card>
          ))}
        </View>
      ) : null}

      <View style={styles.group}>
        <T variant="title">In the circle</T>
        {memberLimit > 0 ? (
          <T tone="muted">
            {active.length + waiting.length} of {memberLimit} people
          </T>
        ) : null}
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
                {m.role === "parent" ? "Checks in each day" : viewerIsParent ? "Looks out for you" : `Looks out for ${personName}`}
                {isOrg ? ", set up this circle" : ""}
              </T>
              {canRemove ? (
                <Button
                  label={isMe ? "Leave the circle" : "Remove"}
                  a11yLabel={isMe ? "Leave the circle" : `Remove ${m.profile?.display_name ?? "this person"}`}
                  variant="quiet"
                  onPress={() => remove(m)}
                  disabled={busyId === m.user_id}
                />
              ) : null}
            </Card>
          );
        })}
      </View>

      <Button label="Delete my account" variant="quiet" onPress={deleteAccount} busy={deleting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
});
