import { isError } from "@tinker/sync";
import { bootPage } from "./page-boot.tsx";
import "./style.css";

if (document.documentElement.dataset.serverPage === "true") {
  const stop = new AbortController();
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  window.addEventListener("pagehide", () => stop.abort(), { once: true });
  try {
    await bootPage({ baseUrl: window.location.origin }, stop.signal);
  } catch (error) {
    if (!isError(error, "SyncNotReady")) throw error;
    for (const style of styles) document.head.append(style);
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    await import("./main.tsx");
  }
} else {
  await import("./main.tsx");
}
