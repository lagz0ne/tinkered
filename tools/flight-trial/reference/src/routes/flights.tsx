import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { FlightsPage } from "../frontend/Flights.tsx";
export const Route = createFileRoute("/flights")({
  component: () => (
    <ClientOnly fallback={<p>Loading flight search</p>}>
      <FlightsPage />
    </ClientOnly>
  ),
});
