# Booking-only rules

Staged with the default worker rules for the booking suite.
They pin the generic words to the room-booking app.

- The root view is BookingApp.
- Saved records are bookings.
- Only an omitted date takes the default.
- A cleared Date or Edit date field is invalid and reports BadDate.
- A real four-digit year below 100 is valid.
- Preserve creation order when dates and start times become tied,
  including after edits and undo.
- Opening another draft drops the first draft's unsaved text.
  The fields must now show the newly selected booking.
