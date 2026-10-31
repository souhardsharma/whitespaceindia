import type { MetadataRoute } from "next";

// What a phone or desktop shows when the site is saved to a home screen.
// Icons come from scripts/make_icons.mjs; 60% of the square keeps the mark
// inside Android's mask, so the same files serve "any" and "maskable".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Whitespace India",
    short_name: "Whitespace",
    description:
      "India's unattended problems, found in public data: free tools that read the country's public records together.",
    start_url: "/",
    display: "browser",
    background_color: "#fcf9f4",
    theme_color: "#fcf9f4",
    lang: "en-IN",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
