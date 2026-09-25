import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { GymApp } from "./index.ts";

const root = document.getElementById("root");
if (root === null) {
  document.body.textContent = "missing #root";
} else {
  createRoot(root).render(
    <StrictMode>
      <GymApp />
    </StrictMode>,
  );
}
