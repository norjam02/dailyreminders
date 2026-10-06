// Design tokens. Large, high-contrast, and calm: many parents using this app
// are older, and a missed check-in should prompt a call, not alarm anyone.

export const colors = {
  background: "#EEF3F6",
  surface: "#FFFFFF",
  ink: "#1D2B36",
  muted: "#55646F",
  line: "#D3DDE3",
  primary: "#1F5E7A",
  primaryPressed: "#174A61",
  primarySoft: "#DCEAF1",
  onPrimary: "#FFFFFF",
  done: "#3E7C59",
  doneSoft: "#E3F0E8",
  attention: "#9A5800",
  attentionSoft: "#FBEFD9",
  error: "#9B2C2C",
} as const;

export const fonts = {
  regular: "AtkinsonHyperlegible_400Regular",
  bold: "AtkinsonHyperlegible_700Bold",
} as const;

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40 },
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32 },
  heading: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 18, lineHeight: 26 },
  small: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 36,
} as const;

export const radius = {
  control: 14,
  card: 18,
  pill: 999,
} as const;
