// Organizers sign in with a code emailed to them. No password.
//
// One exception: App Store and Google Play reviewers can't read our emails,
// so the review account (EXPO_PUBLIC_REVIEW_EMAIL) signs in with a password
// set in the Supabase dashboard. Everyone else only ever sees the code.

import { router } from "expo-router";
import { useState } from "react";

import { Button, ErrorText, Field, Screen, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const REVIEW_EMAIL = process.env.EXPO_PUBLIC_REVIEW_EMAIL?.trim().toLowerCase() || null;

export default function SignIn() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter an email address, like name@example.com.");
      return;
    }
    setError(null);
    if (REVIEW_EMAIL && address === REVIEW_EMAIL) {
      setSentTo(address);
      return;
    }
    setBusy(true);
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

  async function signInForReview() {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: sentTo, password });
    if (signInError) {
      setBusy(false);
      return setError("That password didn't work.");
    }
    await refresh();
    setBusy(false);
    router.replace("/");
  }

  if (!sentTo) {
    return (
      <Screen>
        <T tone="muted">
          Let&apos;s get started setting up your own DailyPulse. It only takes a few minutes, and you can set it up for
          yourself or for someone you care about. Enter your email and we&apos;ll send you a code to sign in. No
          password needed.
        </T>
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

  if (REVIEW_EMAIL && sentTo === REVIEW_EMAIL) {
    return (
      <Screen>
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={signInForReview}
        />
        <ErrorText message={error} />
        <Button label="Sign in" onPress={signInForReview} busy={busy} disabled={!password} />
        <Button label="Use a different email" variant="quiet" onPress={() => setSentTo(null)} disabled={busy} />
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
