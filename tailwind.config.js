/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        // The Core brand palette — sampled from the official assets in
        // `brand guidelines/72ppi/`. The logo is a rounded black plate with
        // white "c-re" wordmark and four colored corner dots: pink, teal,
        // white, blue. Those four (plus black) are the full palette.
        core: {
          bg:       "#FFFFFF",
          ink:      "#0A0A0A",   // near-black (matches the logo plate)
          muted:    "#6B6B6B",
          line:     "#E8E8E8",
          surface:  "#FAFAFA",
          // Brand accents
          pink:     "#EC2D7A",   // top-left dot — primary accent / links
          pinkDark: "#C21760",
          teal:     "#17AB8C",   // top-right dot — positive values
          blue:     "#1D52F2",   // bottom-right dot — secondary / charts
          // Semantic (used for growth signals on tables/charts)
          positive: "#17AB8C",   // teal from the brand
          negative: "#DC2626",   // keep red for YoY decline — finance norm
          // Legacy aliases so existing templates keep working.
          accent:     "#EC2D7A",
          accentDark: "#C21760"
        }
      },
      fontFamily: {
        // Matches thecore.in's live CSS (Mona Sans body + UI, Arvo serif).
        sans:    ["Mona Sans", "Inter", "system-ui", "sans-serif"],
        display: ["Mona Sans", "Inter", "system-ui", "sans-serif"],
        serif:   ["Arvo", "Georgia", "serif"]
      },
      letterSpacing: {
        tightest: "-0.03em",
        tighter:  "-0.022em"
      },
      boxShadow: {
        card: "0 1px 2px rgba(17,17,17,0.04), 0 1px 4px rgba(17,17,17,0.04)"
      }
    }
  },
  plugins: []
};
