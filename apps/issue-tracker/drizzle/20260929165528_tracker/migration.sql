CREATE TABLE "activity" (
	"id" text PRIMARY KEY,
	"issue_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY,
	"issue_id" text NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint DEFAULT 0 NOT NULL
);
