import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { refreshFlightBookings } from "../transport/bookings.functions";
import { BookingsPage } from "../frontend/Bookings";
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
