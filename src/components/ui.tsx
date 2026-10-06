// Shared building blocks. Big touch targets (56 pt minimum) and large text.

import type { ReactNode } from "react";
import {
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
  onPress,
  variant = "primary",
  disabled,
  busy,
}: {
  label: string;
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

// A compact selectable chip, for hours and quick replies.
export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
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

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <T tone="error" style={styles.error}>
      {message}
    </T>
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
    borderColor: colors.line,
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
    borderColor: colors.line,
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
});
