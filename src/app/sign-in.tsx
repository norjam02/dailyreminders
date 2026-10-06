// Organizers sign in with a code emailed to them. No password.

import { router } from "expo-router";
import { useState } from "react";

import { Button, ErrorText, Field, Screen, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function SignIn() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter an email address, like name@example.com.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (sendError) return setError(errorMessage(sendError));
    setSentTo(address);
  }

  async function verify() {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email" });
    if (verifyError) {
      setBusy(false);
      return setError("That code didn't work. Check the latest email, or send a new code.");
    }
    await refresh();
    setBusy(false);
    router.replace("/");
  }

  if (!sentTo) {
    return (
      <Screen>
        <T tone="muted">You&apos;re the person who sets up and pays for check-ins. We&apos;ll email you a code to sign in.</T>
        <Field
          label="Your email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={sendCode}
        />
        <ErrorText message={error} />
        <Button label="Email me a code" onPress={sendCode} busy={busy} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T tone="muted">We sent a code to {sentTo}. It can take a minute to arrive.</T>
      <Field
        label="Code from the email"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={10}
        returnKeyType="done"
        onSubmitEditing={verify}
      />
      <ErrorText message={error} />
      <Button label="Sign in" onPress={verify} busy={busy} disabled={code.trim().length < 6} />
      <Button label="Send a new code" variant="quiet" onPress={sendCode} disabled={busy} />
      <Button label="Use a different email" variant="quiet" onPress={() => setSentTo(null)} disabled={busy} />
    </Screen>
  );
}
