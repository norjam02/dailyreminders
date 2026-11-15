// The circle's own welcome: a photo and a short message the organizer sets,
// shown full screen for a moment each time DailyPulse opens. The phone's own
// launch screen can't change after the app is built, so this is the screen
// right after it.

import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, icons } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radius, space } from "@/lib/theme";

export const WELCOME_BUCKET = "welcome-photos";
export const WELCOME_LENGTH = 120;

// How long the welcome stays up, unless it's tapped away sooner.
const SHOW_MS = 3200;
// How long to wait for the photo before showing the welcome without it.
const PHOTO_WAIT_MS = 1500;

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

// The welcome itself. Used full screen at launch and, smaller, as the
// preview while the organizer edits it.
export function WelcomeCard({
  photoUri,
  message,
  viewerName,
  fromName,
  compact,
}: {
  photoUri?: string | null;
  message?: string | null;
  viewerName?: string | null;
  fromName?: string | null;
  compact?: boolean;
}) {
  const hello = viewerName ? `${greeting()}, ${viewerName}` : greeting();
  const hasPhoto = !!photoUri;
  return (
    <View
      style={[styles.card, compact ? styles.compact : styles.full, !hasPhoto && styles.plain]}
      accessible
      accessibilityLabel={[hello, message, fromName ? `From ${fromName}` : null].filter(Boolean).join(". ")}
    >
      {hasPhoto ? (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      ) : (
        <View style={styles.heart}>
          <Icon name={icons.heart} size={compact ? 56 : 96} color={colors.warm} />
        </View>
      )}
      <View style={[styles.words, hasPhoto && styles.scrim]}>
        <Text style={[styles.hello, hasPhoto && styles.onPhoto, compact && styles.helloCompact]}>{hello}</Text>
        {message ? (
          <Text style={[styles.message, hasPhoto && styles.onPhoto, compact && styles.messageCompact]}>{message}</Text>
        ) : null}
        {fromName ? <Text style={[styles.from, hasPhoto && styles.onPhoto]}>From {fromName}</Text> : null}
      </View>
    </View>
  );
}

// Shown once each time the app opens, for people active in a circle whose
// organizer has set a welcome. Tap anywhere to close it early. onDecided runs
// once the welcome is ready to show, or once it's clear there's none, so the
// launch screen can stay up until then.
let shownThisLaunch = false;

export function LaunchWelcome({ onDecided }: { onDecided: () => void }) {
  const { session, current } = useSession();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState<{
    photoUri: string | null;
    message: string | null;
    viewerName: string | null;
    fromName: string | null;
  } | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const circle = current?.circle;
  const active = current?.status === "active";
  const message = circle?.welcome_message ?? null;
  const photoPath = circle?.welcome_photo_path ?? null;
  const userId = session?.user.id;

  useEffect(() => {
    if (shownThisLaunch || !active || !circle || !userId || (!message && !photoPath)) {
      onDecided();
      return;
    }
    shownThisLaunch = true;
    let cancelled = false;
    (async () => {
      const [profiles, signed] = await Promise.all([
        supabase.from("profiles").select("id, display_name").in("id", [userId, circle.organizer_id]),
        photoPath
          ? supabase.storage.from(WELCOME_BUCKET).createSignedUrl(photoPath, 600)
          : Promise.resolve({ data: null }),
      ]);
      const rows = (profiles.data as { id: string; display_name: string }[] | null) ?? [];
      const photoUri = signed.data?.signedUrl ?? null;
      // Fetch the photo first so it appears with the words, not after them.
      if (photoUri) {
        await Promise.race([Image.prefetch(photoUri), new Promise((r) => setTimeout(r, PHOTO_WAIT_MS))]).catch(() => {});
      }
      if (cancelled) return onDecided();
      setContent({
        photoUri,
        message,
        viewerName: rows.find((p) => p.id === userId)?.display_name ?? null,
        // No "From you" on the organizer's own phone.
        fromName: circle.organizer_id === userId ? null : (rows.find((p) => p.id === circle.organizer_id)?.display_name ?? null),
      });
      setVisible(true);
      onDecided();
      timer.current = setTimeout(() => setVisible(false), SHOW_MS);
    })().catch(onDecided);
    return () => {
      cancelled = true;
    };
  }, [active, circle, userId, message, photoPath, onDecided]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (visible && content) {
      AccessibilityInfo.announceForAccessibility(
        [greeting(), content.message].filter(Boolean).join(". "),
      );
    }
  }, [visible, content]);

  if (!visible || !content) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(250)}
      exiting={reduceMotion ? undefined : FadeOut.duration(350)}
      style={[StyleSheet.absoluteFill, styles.overlay]}
    >
      <Pressable
        style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        onPress={() => setVisible(false)}
        accessibilityRole="button"
        accessibilityHint="Closes the welcome"
      >
        <WelcomeCard {...content} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.background, zIndex: 10 },
  fill: { flex: 1 },
  card: { overflow: "hidden", justifyContent: "flex-end" },
  full: { flex: 1 },
  compact: { height: 340, borderRadius: radius.card },
  plain: { backgroundColor: colors.warmSoft, justifyContent: "center" },
  heart: { alignItems: "center", marginBottom: space.lg },
  words: { padding: space.lg, gap: space.sm },
  scrim: { backgroundColor: "rgba(0, 0, 0, 0.45)" },
  hello: { fontFamily: fonts.heavy, fontSize: 36, lineHeight: 42, color: colors.ink, letterSpacing: -0.5 },
  helloCompact: { fontSize: 26, lineHeight: 32 },
  message: { fontFamily: fonts.medium, fontSize: 24, lineHeight: 32, color: colors.ink },
  messageCompact: { fontSize: 19, lineHeight: 26 },
  from: { fontFamily: fonts.bold, fontSize: 17, color: colors.muted },
  onPhoto: { color: "#FFFFFF" },
});
