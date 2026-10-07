import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { FlightsPage } from "../frontend/Flights";
export const Route = createFileRoute("/flights")({
  loader: ({ context }) => context.bootstrap(),
  component: () => (
    <ClientOnly fallback={<p>Loading flight search</p>}>
      <FlightsPage />
    </ClientOnly>
  ),
});
