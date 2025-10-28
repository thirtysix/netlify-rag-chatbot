CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"rag_id" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384),
	"chunk_index" integer NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"topic" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_rag_id_rags_id_fk" FOREIGN KEY ("rag_id") REFERENCES "public"."rags"("id") ON DELETE no action ON UPDATE no action;