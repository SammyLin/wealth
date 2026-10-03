import { createTheme, defaultVariantColorsResolver, isLightColor, type CSSVariablesResolver, type MantineColorsTuple, type MantineTheme, type MantineThemeOverride, type VariantColorsResolver } from "@mantine/core"
import { t, type Lang } from "./i18n"

// v1's "paper and ink" identity, expressed as a Mantine theme.
// Extra tokens for feature code (all switch with the color scheme):
//   var(--wealth-paper)    page background      var(--wealth-paper-2)  sunken fills, hovers
//   var(--wealth-rule)     hairlines             var(--wealth-up/down)  gain / loss text
//   var(--wealth-font-num) Fraunces; prefer className="num" which also sets tabular digits
// Colors: c="gold" (primary), c="dimmed" (ink-3); kind colors come from state.kinds[].color.
// Semantic colors are theme tuples too, so alerts, notifications and confirm buttons share the palette:
//   color="up" (gain, success)   color="down" (loss, errors, destructive)   color="warn" (needs attention)

const SERIF = 'GenRyuMinTW, "Noto Serif TC", Georgia, serif'
const SANS = 'MiSansTC, "Noto Sans TC", system-ui, -apple-system, sans-serif'
const NUM = "Fraunces, Georgia, serif"

// gold-7 = #7d5803 (v1 --gold, light primary), gold-5 = #ca8a04 (v1 --gold-2, dark primary), gold-1 = v1 --gold-wash
const gold: MantineColorsTuple = ["#fbf5e4", "#f1e2bb", "#e8cf8e", "#ddb95c", "#d4a52f", "#ca8a04", "#a87203", "#7d5803", "#5f4302", "#422e01"]

// Warm grays replace Mantine's cool ones so default borders, dimmed text and hovers read as paper:
// gray-1 paper, gray-2 paper-2, gray-3 rule, gray-4 rule-2, gray-6 ink-3, gray-7 ink-2, gray-9 ink.
const gray: MantineColorsTuple = ["#fbf8f1", "#f5efe3", "#ede4d2", "#e3d8c4", "#cdbfa6", "#a89b85", "#6f6556", "#4a4237", "#332c23", "#1f1a14"]

// Shade 7 is what light mode paints (v1's --up / --down), shade 5 what dark mode paints (SHADE below).
const up: MantineColorsTuple = ["#eaf4ec", "#cfe6d4", "#a9d3b2", "#8fc99b", "#7cc48a", "#5aa96a", "#428f53", "#2d6a39", "#22512b", "#17381e"]
const down: MantineColorsTuple = ["#fbeceb", "#f4d3d0", "#eab0ab", "#e89a8c", "#e58474", "#e07a6c", "#c4483e", "#a3302a", "#7f2520", "#5c1a17"]
const warn: MantineColorsTuple = ["#fdf0e6", "#f9dcc4", "#f2bf93", "#eaa063", "#e0843a", "#e0843a", "#a8591a", "#8a4914", "#6b380f", "#4d280a"]

// Dark scheme: deep warm charcoal with parchment text (dark-0 text, dark-2 dimmed, dark-4 borders, dark-7 body).
const dark: MantineColorsTuple = ["#ece3d0", "#d6cbb5", "#a99d87", "#857a66", "#463e33", "#3a332a", "#2f2922", "#28231d", "#1d1914", "#14110e"]

// Mantine picks a filled control's text color once, from the light-scheme shade, so dark mode's gold-5
// (#ca8a04) got white text at 2.8:1. Filled theme colors read --wealth-contrast-<color> instead, which
// cssVariablesResolver sets per scheme from the shade actually painted (gold-5 in dark → ink, 5.9:1).
const SHADE = { light: 7, dark: 5 } as const
const variantColorResolver: VariantColorsResolver = (input) => {
  const r = defaultVariantColorsResolver(input)
  const name = input.color ?? input.theme.primaryColor
  if (input.variant === "filled" && input.theme.autoContrast && name in input.theme.colors) r.color = `var(--wealth-contrast-${name})`
  return r
}
const contrastVars = (theme: MantineTheme, scheme: keyof typeof SHADE) =>
  Object.fromEntries(
    Object.entries(theme.colors).map(([name, c]) => [`--wealth-contrast-${name}`, isLightColor(c[SHADE[scheme]], theme.luminanceThreshold) ? "var(--mantine-color-black)" : "var(--mantine-color-white)"]),
  )

// One theme per language (the default aria-labels below follow the UI language); themeFor caches them so a
// language switch swaps in a ready theme object instead of rebuilding it.
const themes = new Map<Lang, MantineThemeOverride>()
export const themeFor = (lang: Lang) => themes.get(lang) ?? themes.set(lang, makeTheme(lang)).get(lang)!

const makeTheme = (lang: Lang) => {
  // date fields read like the rest of the UI's dates (fmtDate): "2026.10.03" / "Oct 3, 2026"
  const valueFormat = lang === "en" ? "MMM D, YYYY" : "YYYY.MM.DD"
  const closeButtonProps = { "aria-label": t("關閉") }
  const ariaLabels = {
    previousMonth: t("上個月"),
    nextMonth: t("下個月"),
    previousYear: t("上一年"),
    nextYear: t("下一年"),
    previousDecade: t("上個十年"),
    nextDecade: t("下個十年"),
    monthLevelControl: t("選擇月份"),
    yearLevelControl: t("選擇年份"),
  }
  return createTheme({
    primaryColor: "gold",
    primaryShade: SHADE,
    autoContrast: true,
    variantColorResolver,
    colors: { gold, gray, dark, up, down, warn },
    white: "#fbf8f1",
    black: "#1f1a14",
    fontFamily: SANS,
    headings: { fontFamily: SERIF, fontWeight: "600" },
    defaultRadius: "md",
    cursorType: "pointer",
    shadows: {
      xs: "0 1px 2px rgba(60,40,10,.05)",
      sm: "0 1px 2px rgba(60,40,10,.05), 0 6px 16px rgba(60,40,10,.05)",
      md: "0 1px 2px rgba(60,40,10,.05), 0 12px 32px rgba(60,40,10,.07)",
      lg: "0 2px 4px rgba(60,40,10,.06), 0 18px 44px rgba(60,40,10,.10)",
      xl: "0 4px 8px rgba(60,40,10,.08), 0 28px 64px rgba(60,40,10,.14)",
    },
    other: { fontNum: NUM },
    components: {
      Card: { defaultProps: { withBorder: true, padding: "lg", radius: "md", shadow: "sm" } },
      Button: { defaultProps: { radius: "xl" } },
      ActionIcon: { defaultProps: { variant: "subtle", color: "gray", radius: "xl" } },
      Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
      // Mantine gives the close button no accessible name; every toast (Undo ones included) has one
      Notification: { defaultProps: { closeButtonProps } },
      // a color, so the checked "All" chip gets the per-scheme contrast text too (Chip's CSS default is white)
      Chip: { defaultProps: { color: "gold" } },
      Badge: { defaultProps: { tt: "none" } }, // Mantine's default is uppercase ("6 ROWS")
      NumberInput: { defaultProps: { thousandSeparator: "," } },
      Alert: { defaultProps: { variant: "light" } },
      DateInput: { defaultProps: { ariaLabels, valueFormat } },
      DatePickerInput: { defaultProps: { ariaLabels, valueFormat } },
      Modal: {
        defaultProps: { centered: true, radius: "md", closeButtonProps, overlayProps: { backgroundOpacity: 0.35, blur: 3 } },
        styles: { title: { fontFamily: SERIF, fontWeight: 600, fontSize: "var(--mantine-font-size-lg)" } },
      },
      Drawer: {
        defaultProps: { position: "right", closeButtonProps, overlayProps: { backgroundOpacity: 0.35, blur: 3 } },
        styles: { title: { fontFamily: SERIF, fontWeight: 600, fontSize: "var(--mantine-font-size-lg)" } },
      },
      EmptyState: { styles: { title: { fontFamily: SERIF, fontWeight: 600 } } },
      AppShell: {
        styles: {
          header: {
            background: "color-mix(in srgb, var(--wealth-paper) 88%, transparent)",
            backdropFilter: "saturate(1.2) blur(10px)",
            borderColor: "var(--wealth-rule)",
          },
          main: { background: "var(--wealth-paper)" },
        },
      },
    },
  })
}

// Passed to MantineProvider: Mantine paints body and Paper/Card with --mantine-color-body, so that is the
// card color; the page itself uses --wealth-paper (see index.css and AppShell styles above).
export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: { "--wealth-font-num": NUM },
  light: {
    ...contrastVars(theme, "light"),
    "--mantine-color-body": "#fbf8f1",
    "--mantine-color-text": "#1f1a14",
    // placeholders carry meaning here ("沿用上一筆" = carry the last balance): ink-3, 5.4:1 on an input, not gray-5's 2.6:1
    "--mantine-color-placeholder": "#6f6556",
    "--wealth-paper": "#f5efe3",
    "--wealth-paper-2": "#ede4d2",
    "--wealth-rule": "#e3d8c4",
    "--wealth-up": "#2d6a39",
    "--wealth-down": "#a3302a",
  },
  dark: {
    ...contrastVars(theme, "dark"),
    "--mantine-color-body": "#28231d",
    "--mantine-color-text": "#ece3d0",
    "--mantine-color-placeholder": "#a99d87", // dark-2: 5.4:1 on the dark input
    // hover lightens instead of darkening: ink on gold-6 was 4.2:1, on gold-4 it's 7.3:1
    "--mantine-color-gold-filled-hover": gold[4],
    "--mantine-primary-color-filled-hover": gold[4],
    "--wealth-paper": "#1d1914",
    "--wealth-paper-2": "#2f2922",
    "--wealth-rule": "#3a332a",
    "--wealth-up": "#7cc48a",
    "--wealth-down": "#e58474",
  },
})
