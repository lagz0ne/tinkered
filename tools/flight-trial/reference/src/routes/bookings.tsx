import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { refreshFlightBookings } from "../transport/bookings.functions.ts";
import { BookingsPage } from "../frontend/Bookings.tsx";
export const Route = createFileRoute("/bookings")({
  loader: async ({ context }) => {
    await refreshFlightBookings();
    return context.bootstrap();
  },
  component: () => (
    <ClientOnly fallback={<p>Loading bookings</p>}>
      <BookingsPage />
    </ClientOnly>
  ),
});
