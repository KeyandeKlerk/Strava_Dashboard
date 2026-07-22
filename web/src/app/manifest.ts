import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Strava Training Dashboard",
    short_name: "Training",
    description: "Personal training/fatigue dashboard synced from Strava",
    start_url: "/today",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#fc4c02",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Today",
        url: "/today",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Fatigue",
        url: "/fatigue",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Plan History",
        url: "/plan-history",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Gym",
        url: "/gym",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
