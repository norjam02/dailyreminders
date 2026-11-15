// Shared building blocks. Big touch targets (56 pt minimum) and large text.

import { useEffect, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Alert,
  Platform,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { useSession } from "@/lib/session";
import { colors, fonts, radius, space, type } from "@/lib/theme";

export function Screen({
  children,
  scroll = true,
  topInset = false,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  // Screens without a header need the top safe area too.
  topInset?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={topInset ? ["top", "bottom", "left", "right"] : ["bottom", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type Tone = "ink" | "muted" | "done" | "attention" | "error" | "onPrimary";

const toneColor: Record<Tone, string> = {
  ink: colors.ink,
  muted: colors.muted,
  done: colors.done,
  attention: colors.attention,
  error: colors.error,
  onPrimary: colors.onPrimary,
};

export function T({
  children,
  variant = "body",
  tone = "ink",
  center,
  style,
}: {
  children: ReactNode;
  variant?: keyof typeof type;
  tone?: Tone;
  center?: boolean;
  style?: TextStyle;
}) {
  return (
    <Text
      style={[type[variant], { color: toneColor[tone] }, center && styles.center, style]}
      accessibilityRole={variant === "display" || variant === "title" ? "header" : undefined}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  a11yLabel,
  onPress,
  variant = "primary",
  disabled,
  busy,
}: {
  label: string;
  // What a screen reader says, when it should say more than the label.
  a11yLabel?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  busy?: boolean;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      // Keeps the button's name while the spinner replaces its label.
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        variant === "secondary" && [styles.secondary, pressed && { backgroundColor: colors.primarySoft }],
        variant === "quiet" && styles.quiet,
        inactive && styles.inactive,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            { color: variant === "primary" ? colors.onPrimary : colors.primary },
            variant === "quiet" && styles.quietLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <T variant="heading">{label}</T>
      {hint ? <T variant="small" tone="muted">{hint}</T> : null}
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

// One option in a list. Shows a filled marker when selected.
export function Choice({
  label,
  description,
  selected,
  onPress,
  disabled,
  multiple,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  multiple?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={[styles.choice, selected && styles.choiceSelected, disabled && styles.inactive]}
    >
      <View style={[styles.marker, multiple && styles.markerSquare, selected && styles.markerSelected]} />
      <View style={styles.choiceText}>
        <T variant="heading">{label}</T>
        {description ? <T variant="small" tone="muted">{description}</T> : null}
      </View>
    </Pressable>
  );
}

// A compact selectable chip, for hours and quick replies. `single` marks a
// pick-one group, so screen readers say "radio button", not "checkbox".
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  single,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  single?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={single ? "radio" : "checkbox"}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={[styles.chip, selected && styles.chipSelected, disabled && !selected && styles.inactive]}
    >
      <Text style={[styles.chipLabel, selected && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <T variant="title">{title}</T>
      {hint ? <T tone="muted">{hint}</T> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function Card({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "done" | "attention" }) {
  return (
    <View
      style={[
        styles.card,
        tone === "done" && { backgroundColor: colors.doneSoft, borderColor: colors.doneSoft },
        tone === "attention" && { backgroundColor: colors.attentionSoft, borderColor: colors.attentionSoft },
      ]}
    >
      {children}
    </View>
  );
}

// Errors are announced to screen readers as soon as they appear: on Android
// by the live region, on iPhone by an announcement (not both, or Android
// reads it twice).
export function ErrorText({ message }: { message: string | null }) {
  useEffect(() => {
    if (message && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <T tone="error" style={styles.error}>
        {message}
      </T>
    </View>
  );
}

// A system icon: SF Symbols on iPhone, Material Symbols on Android. Icons are
// decoration; the words next to them (or the button's label) say what they mean.
export type IconName = Extract<SymbolViewProps["name"], { ios?: unknown }>;

export function Icon({ name, size = 24, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      type="hierarchical"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export const icons = {
  settings: { ios: "gearshape.fill", android: "settings" },
  people: { ios: "person.2.fill", android: "group" },
  done: { ios: "checkmark.circle.fill", android: "check_circle" },
  missed: { ios: "exclamationmark.circle.fill", android: "error" },
  waiting: { ios: "clock.fill", android: "schedule" },
  upcoming: { ios: "sun.max.fill", android: "wb_sunny" },
  streak: { ios: "flame.fill", android: "local_fire_department" },
  camera: { ios: "camera.fill", android: "photo_camera" },
  wave: { ios: "hand.wave.fill", android: "waving_hand" },
  photo: { ios: "photo.fill", android: "image" },
} satisfies Record<string, IconName>;

// A round icon button for screen headers. 48 pt, with a spoken label.
export function IconButton({ name, label, onPress }: { name: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.primarySoft }]}
    >
      <Icon name={name} size={24} color={colors.primary} />
    </Pressable>
  );
}

// Sign out, after a confirmation. People who joined with a code have no email,
// so signing out means asking for a new code; the warning says so.
export function SignOutButton({ disabled }: { disabled?: boolean }) {
  const { session, signOut } = useSession();
  const anonymous = !!session?.user.is_anonymous;
  return (
    <Button
      label="Sign out"
      variant="quiet"
      disabled={disabled}
      onPress={() =>
        Alert.alert(
          "Sign out?",
          anonymous
            ? "You joined with a code, so you'll need a new code from your circle to get back in."
            : "You can sign back in any time with a code sent to your email.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => void signOut() },
          ],
        )
      }
    />
  );
}

export function Gap({ size = "md" }: { size?: keyof typeof space }) {
  return <View style={{ height: space[size] }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  fill: { flex: 1 },
  center: { textAlign: "center" },
  button: {
    minHeight: 56,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  quiet: { minHeight: 48 },
  quietLabel: { textDecorationLine: "underline" },
  inactive: { opacity: 0.45 },
  buttonLabel: { fontFamily: fonts.bold, fontSize: 19 },
  field: { gap: space.xs },
  input: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    minHeight: 56,
    marginTop: space.xs,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    minHeight: 64,
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    borderWidth: 2,
    borderColor: colors.border,
  },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { flex: 1, gap: 2 },
  marker: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.muted },
  markerSquare: { borderRadius: 6 },
  markerSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.primary },
  chipLabel: { fontFamily: fonts.bold, fontSize: 17, color: colors.primary },
  section: { gap: space.sm, marginTop: space.md },
  sectionBody: { gap: space.sm, marginTop: space.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    gap: space.sm,
  },
  error: { marginTop: space.xs },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
});
