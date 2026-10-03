CREATE TABLE "flight_booking" (
	"id" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"offer" jsonb NOT NULL,
	"order_id" text NOT NULL,
	"price" text NOT NULL,
	"expires" text NOT NULL,
	"state" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flight_booking" ADD CONSTRAINT "flight_booking_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id");