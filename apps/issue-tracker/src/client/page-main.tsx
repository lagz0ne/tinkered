import { bootPage } from "./page-boot.tsx";
import "./style.css";

if (document.documentElement.dataset.serverPage === "true") {
  const stop = new AbortController();
  window.addEventListener("pagehide", () => stop.abort(), { once: true });
  await bootPage({ baseUrl: window.location.origin }, stop.signal);
} else {
  await import("./main.tsx");
}
