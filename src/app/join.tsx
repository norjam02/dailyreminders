// Anyone joins a circle with a code. People without an account are signed in
// anonymously, with no email or password. The invite message carries a link
// (dailypulse://join?code=ABC123) that opens this screen with the code filled in.

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { Button, ErrorText, Field, Screen, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function Join() {
  const { session, refresh } = useSession();
  const params = useLocalSearchParams<{ code?: string }>();
  const fromLink = cleanCode(params.code ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState(fromLink.length === 6 ? fromLink : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!name.trim()) return setError("Add your name so your circle knows it's you.");
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
      <T tone="muted">
        {code.length === 6 && code === fromLink
          ? "Your join code is filled in. Add your name and tap Join."
          : "Someone sent you a code to join their DailyPulse circle. Enter it here."}
      </T>
      <Field
        label="Your name"
        hint="What your circle calls you, like Pat or Grandma."
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={60}
      />
      <Field
        label="Join code"
        hint="6 letters and numbers, from your invite message."
        value={code}
        onChangeText={(v) => setCode(cleanCode(v))}
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

function cleanCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
