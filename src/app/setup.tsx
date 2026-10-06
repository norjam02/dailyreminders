// The organizer creates the circle and says how they're related to the parent.

import { router } from "expo-router";
import { useState } from "react";

import { Button, Choice, ErrorText, Field, Screen, Section, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function Setup() {
  const { refresh, signOut } = useSession();
  const [parentName, setParentName] = useState("");
  const [yourName, setYourName] = useState("");
  const [role, setRole] = useState<"child" | "caregiver">("child");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!parentName.trim() || !yourName.trim()) {
      setError("Add both names to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_circle", {
      p_name: parentName.trim(),
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
      <T tone="muted">A circle is one parent and the people who look after them. You&apos;ll manage it.</T>
      <Field
        label="Who are the check-ins for?"
        hint="What the family calls them, like Mom or Grandpa Joe."
        value={parentName}
        onChangeText={setParentName}
        autoCapitalize="words"
        maxLength={60}
      />
      <Field
        label="Your name"
        hint="How you'll appear to them and the family."
        value={yourName}
        onChangeText={setYourName}
        autoCapitalize="words"
        autoComplete="name"
        maxLength={60}
      />
      <Section title="You are their">
        <Choice label="Child" selected={role === "child"} onPress={() => setRole("child")} />
        <Choice
          label="Caregiver"
          description="A paid caregiver, a friend, or anyone looking after someone who isn't their own parent."
          selected={role === "caregiver"}
          onPress={() => setRole("caregiver")}
        />
      </Section>
      <ErrorText message={error} />
      <Button label="Create the circle" onPress={create} busy={busy} />
      <Button label="Sign out" variant="quiet" onPress={signOut} disabled={busy} />
    </Screen>
  );
}
