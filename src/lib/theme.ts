// Design tokens. Large, high-contrast, and warm: many people using this app
// are older, and a missed check-in should prompt a call, not alarm anyone.
//
// Light and dark palettes follow the phone's setting. Styles are built once
// when the app starts, so a change to the phone's setting shows the next time
// the app opens. Every text color keeps at least 4.5:1 against the
// backgrounds it sits on, and outlines at least 3:1.

import { Appearance } from "react-native";

type Palette = {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  border: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  done: string;
  doneSoft: string;
  attention: string;
  attentionSoft: string;
  error: string;
  warm: string;
  warmSoft: string;
};

const light: Palette = {
  // A warm paper white rather than the old cool gray.
  background: "#F7F3EE",
  surface: "#FFFFFF",
  ink: "#1F2A32",
  muted: "#56616A",
  line: "#E6DED4",
  // Outlines of inputs and options. 3:1 or better against white and background.
  border: "#76808A",
  primary: "#1F5E7A",
  primaryPressed: "#174A61",
  primarySoft: "#DDEBF0",
  onPrimary: "#FFFFFF",
  done: "#2F6B49",
  doneSoft: "#E1F0E5",
  attention: "#985600",
  attentionSoft: "#FCEEDA",
  error: "#9B2C2C",
  // The warm accent: streaks, celebrations, the heart. Decorative only, never text.
  warm: "#E2583A",
  warmSoft: "#FCE5DE",
};

const dark: Palette = {
  background: "#0F161B",
  surface: "#19232A",
  ink: "#EEF2F4",
  muted: "#A9B5BD",
  line: "#2A3740",
  border: "#7E8F9A",
  // In dark mode the brand teal is lighter, with dark text on it.
  primary: "#74C4DC",
  primaryPressed: "#5CB0C9",
  primarySoft: "#1D3442",
  onPrimary: "#0B1A21",
  done: "#86CFA1",
  doneSoft: "#1A3124",
  attention: "#F2B862",
  attentionSoft: "#3A2B13",
  error: "#F29191",
  warm: "#F27B5D",
  warmSoft: "#3B2019",
};

export const scheme: "light" | "dark" = Appearance.getColorScheme() === "dark" ? "dark" : "light";

export const colors: Readonly<Palette> = scheme === "dark" ? dark : light;

// Atkinson Hyperlegible Next: the same legibility, with heavier weights for
// big headlines.
export const fonts = {
  regular: "AtkinsonHyperlegibleNext_400Regular",
  medium: "AtkinsonHyperlegibleNext_500Medium",
  bold: "AtkinsonHyperlegibleNext_700Bold",
  heavy: "AtkinsonHyperlegibleNext_800ExtraBold",
} as const;

export const type = {
  display: { fontFamily: fonts.heavy, fontSize: 36, lineHeight: 42, letterSpacing: -0.5 },
  title: { fontFamily: fonts.heavy, fontSize: 27, lineHeight: 33, letterSpacing: -0.3 },
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
  control: 16,
  card: 22,
  pill: 999,
} as const;

// A soft lift under cards in light mode. Dark mode uses the surface color alone.
export const shadow =
  scheme === "dark"
    ? {}
    : {
        shadowColor: "#5A4632",
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      };
