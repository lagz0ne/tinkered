import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { App } from "../frontend/App";
export const Route = createFileRoute("/")({
  gcTime: 0,
  loader: ({ context }) => context.bootstrap(),
  component: () => (
    <ClientOnly fallback={<p>Loading account</p>}>
      <App />
    </ClientOnly>
  ),
});
