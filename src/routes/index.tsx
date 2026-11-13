import { createFileRoute } from "@tanstack/react-router";
import App from "@/legacy/App";
import legacyCss from "@/legacy/legacy.css?url";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "School Hub Enterprise" },
      { name: "description", content: "Secure workspace for school academics, administration and finance." },
      { property: "og:title", content: "School Hub Enterprise" },
      { property: "og:description", content: "Secure workspace for school academics, administration and finance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "stylesheet", href: legacyCss }],
  }),
  component: App,
});
