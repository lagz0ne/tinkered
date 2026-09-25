import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { StockApp } from "./index.ts";

const root = document.getElementById("root");
if (root === null) {
  document.body.textContent = "missing #root";
} else {
  createRoot(root).render(
    <StrictMode>
      <StockApp />
    </StrictMode>,
  );
}
