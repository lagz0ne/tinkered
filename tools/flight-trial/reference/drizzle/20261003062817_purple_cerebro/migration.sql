ALTER TABLE "flight_booking" ADD COLUMN "payment_id" text;--> statement-breakpoint
ALTER TABLE "flight_booking" ADD CONSTRAINT "flight_booking_payment_id_key" UNIQUE("payment_id");