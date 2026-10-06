// The organizer makes a one-time join code and shares it.

import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Share, StyleSheet, Text } from "react-native";

import { Button, Card, Choice, ErrorText, Screen, Section, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";
import type { MemberRole } from "@/lib/types";

export default function Invite() {
  const { current, isOrganizer } = useSession();
  const circleId = current?.circle.id;
  const parentName = current?.circle.name ?? "your parent";

  const [hasParent, setHasParent] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!circleId) return;
      supabase
        .from("circle_members")
        .select("user_id")
        .eq("circle_id", circleId)
        .eq("role", "parent")
        .neq("status", "removed")
        .then(({ data }) => {
          const present = (data ?? []).length > 0;
          setHasParent(present);
          setRole((r) => r ?? (present ? "family" : "parent"));
        });
    }, [circleId]),
  );

  if (!isOrganizer || !circleId) {
    return (
      <Screen>
        <T>Only the person who set up this circle can invite people.</T>
      </Screen>
    );
  }

  const isParent = current?.role === "parent";
  const options: { role: MemberRole; label: string; description: string }[] = [
    ...(hasParent
      ? []
      : [{ role: "parent" as const, label: parentName, description: "The person who checks in each day." }]),
    { role: "child", label: isParent ? "Your child" : "Their child", description: `Hears about check-ins and missed ones.` },
    {
      role: "caregiver",
      label: "A caregiver",
      description: isParent ? "Someone who helps look after you." : "Someone who helps look after them.",
    },
    { role: "family", label: "Other family or a friend", description: "Hears when a check-in is missed." },
  ];

  async function makeCode() {
    if (!role || !circleId) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    const { data, error: rpcError } = await supabase.rpc("create_invite", { p_circle: circleId, p_role: role });
    setBusy(false);
    if (rpcError) return setError(errorMessage(rpcError));
    setCode(data as string);
  }

  const message = code
    ? `Join ${parentName}'s Daily Check-In circle. Install the app, tap "I have a join code", and enter ${code}. The code works once and expires in a day.`
    : "";

  if (code) {
    return (
      <Screen>
        <T tone="muted">Send this code to the person joining. It works once and expires in a day.</T>
        <Card>
          <Text style={styles.code} accessibilityLabel={`Code ${code.split("").join(" ")}`}>
            {code}
          </Text>
        </Card>
        <Button label="Share the code" onPress={() => Share.share({ message })} />
        <Button
          label={copied ? "Copied" : "Copy the message"}
          variant="secondary"
          onPress={async () => {
            await Clipboard.setStringAsync(message);
            setCopied(true);
          }}
        />
        <T tone="muted">You&apos;ll approve them once they join. Find them under People.</T>
        <Button label="Make another code" variant="quiet" onPress={() => setCode(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Section title="Who are you inviting?">
        {options.map((o) => (
          <Choice
            key={o.role}
            label={o.label}
            description={o.description}
            selected={role === o.role}
            onPress={() => setRole(o.role)}
          />
        ))}
      </Section>
      <ErrorText message={error} />
      <Button label="Make a join code" onPress={makeCode} busy={busy} disabled={!role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {
    fontFamily: fonts.bold,
    fontSize: 44,
    lineHeight: 56,
    letterSpacing: 6,
    color: colors.ink,
    textAlign: "center",
  },
});
