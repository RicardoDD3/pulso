ALTER TABLE "accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
ALTER TABLE "two_factors" ADD COLUMN "verified" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "two_factors" ADD COLUMN "locked_until" timestamp with time zone;