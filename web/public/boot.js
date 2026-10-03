// Runs before first paint. A file rather than an inline script, so the server's CSP can be script-src 'self'.
// Same as Mantine's <ColorSchemeScript defaultColorScheme="auto" />: set the scheme early so dark mode doesn't
// flash; also applies the saved UI language to <html lang>.
try {
  var s = localStorage.getItem("mantine-color-scheme-value")
  if (s !== "light" && s !== "dark") s = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  document.documentElement.setAttribute("data-mantine-color-scheme", s)
  var l = localStorage.getItem("lang") || (navigator.language.indexOf("zh") === 0 ? "zh" : "en")
  document.documentElement.lang = l === "en" ? "en" : "zh-Hant"
} catch {}
// Web fonts, non-blocking (a stylesheet added from a script doesn't hold up rendering): text paints in the
// fallback first, then swaps. Self-hosting them? Point these at your copies (README "Fonts"). The server sets
// data-fonts="system" (WEALTH_FONTS=system) for installs that must not call out to the font hosts.
if (document.documentElement.getAttribute("data-fonts") !== "system") [
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,400&display=swap",
  "https://font.emtech.cc/css/GenRyuMinTW/600",
  "https://font.emtech.cc/css/MiSansTC/400",
  "https://font.emtech.cc/css/MiSansTC/500",
].forEach(function (href) {
  var link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
})
