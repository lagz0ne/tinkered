import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { BookingsPage } from "../frontend/Bookings.tsx";
export const Route = createFileRoute("/bookings")({
  loader: ({ context }) => context.bootstrap(),
  component: () => (
    <ClientOnly fallback={<p>Loading bookings</p>}>
      <BookingsPage />
    </ClientOnly>
  ),
});
