// The organizer creates the circle. Anyone can: the parent themselves, their
// child, a caregiver, or other family. The organizer is the subscriber.

import { router } from "expo-router";
import { useState } from "react";

import { Button, Choice, ErrorText, Field, Screen, Section, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { MemberRole } from "@/lib/types";

const ROLES: { role: MemberRole; label: string; description?: string }[] = [
  { role: "parent", label: "Myself", description: "You'll get the daily check-ins, and your family hears if one is missed." },
  { role: "child", label: "My parent" },
  {
    role: "caregiver",
    label: "Someone I care for",
    description: "As a paid caregiver, a friend, or anyone looking after someone who isn't their own parent.",
  },
  { role: "family", label: "Another family member", description: "A grandparent, aunt, uncle, or anyone else in the family." },
];

export default function Setup() {
  const { refresh, signOut } = useSession();
  const [role, setRole] = useState<MemberRole | null>(null);
  const [parentName, setParentName] = useState("");
  const [yourName, setYourName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forMyself = role === "parent";

  async function create() {
    if (!role) {
      setError("Choose who the check-ins are for.");
      return;
    }
    if (!yourName.trim() || (!forMyself && !parentName.trim())) {
      setError(forMyself ? "Add your name to continue." : "Add both names to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_circle", {
      p_name: forMyself ? yourName.trim() : parentName.trim(),
      p_display_name: yourName.trim(),
      p_role: role,
    });
    if (rpcError) {
      setBusy(false);
      return setError(errorMessage(rpcError));
    }
    await refresh();
    setBusy(false);
    router.replace("/plan");
  }

  return (
    <Screen>
      <T tone="muted">
        A circle is one person who checks in each day and the people who look after them. You&apos;ll manage it.
      </T>
      <Section title="Who are the check-ins for?">
        {ROLES.map((r) => (
          <Choice
            key={r.role}
            label={r.label}
            description={r.description}
            selected={role === r.role}
            onPress={() => setRole(r.role)}
          />
        ))}
      </Section>
      {role && !forMyself ? (
        <Field
          label="Their name"
          hint="What the family calls them, like Mom or Grandpa Joe."
          value={parentName}
          onChangeText={setParentName}
          autoCapitalize="words"
          maxLength={60}
        />
      ) : null}
      {role ? (
        <Field
          label="Your name"
          hint={forMyself ? "How you'll appear to your family." : "How you'll appear to them and the family."}
          value={yourName}
          onChangeText={setYourName}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={60}
        />
      ) : null}
      <ErrorText message={error} />
      <Button label="Create the circle" onPress={create} busy={busy} disabled={!role} />
      <Button label="Sign out" variant="quiet" onPress={signOut} disabled={busy} />
    </Screen>
  );
}
