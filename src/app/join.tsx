// Anyone joins a circle with a code. People without an account are signed in
// anonymously, with no email or password.

import { router } from "expo-router";
import { useState } from "react";

import { Button, ErrorText, Field, Screen, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function Join() {
  const { session, refresh } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!name.trim()) return setError("Add your name so the family knows it's you.");
    if (code.trim().length !== 6) return setError("Join codes are six letters and numbers.");
    setBusy(true);
    setError(null);

    if (!session) {
      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        setBusy(false);
        return setError(errorMessage(signInError));
      }
    }

    const { data: circleId, error: rpcError } = await supabase.rpc("redeem_invite", {
      p_code: code.trim(),
      p_display_name: name.trim(),
    });
    if (rpcError) {
      setBusy(false);
      return setError(errorMessage(rpcError));
    }
    if (!circleId) {
      setBusy(false);
      return setError("That code isn't valid. It may have been used or expired. Ask for a new one.");
    }
    await refresh();
    setBusy(false);
    router.replace("/");
  }

  return (
    <Screen>
      <T tone="muted">Someone in the family sent you a code. Enter it here to join their circle.</T>
      <Field
        label="Your name"
        hint="What the family calls you, like Mom or Pat."
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={60}
      />
      <Field
        label="Join code"
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        returnKeyType="done"
        onSubmitEditing={join}
      />
      <ErrorText message={error} />
      <Button label="Join" onPress={join} busy={busy} />
    </Screen>
  );
}
