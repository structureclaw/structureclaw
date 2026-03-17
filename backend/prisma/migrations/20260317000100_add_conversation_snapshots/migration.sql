-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "modelSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "resultSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "latestResult" JSONB;
