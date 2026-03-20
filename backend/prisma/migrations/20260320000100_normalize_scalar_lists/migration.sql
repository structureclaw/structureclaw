-- CreateTable
CREATE TABLE "user_expertise" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_expertise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_tags" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_tags" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_attachments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_expertise_userId_value_key" ON "user_expertise"("userId", "value");

-- CreateIndex
CREATE INDEX "user_expertise_userId_position_idx" ON "user_expertise"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "skill_tags_skillId_value_key" ON "skill_tags"("skillId", "value");

-- CreateIndex
CREATE INDEX "skill_tags_value_idx" ON "skill_tags"("value");

-- CreateIndex
CREATE UNIQUE INDEX "post_tags_postId_value_key" ON "post_tags"("postId", "value");

-- CreateIndex
CREATE INDEX "post_tags_value_idx" ON "post_tags"("value");

-- CreateIndex
CREATE INDEX "post_attachments_postId_position_idx" ON "post_attachments"("postId", "position");

-- Data migration: users.expertise -> user_expertise
INSERT INTO "user_expertise" ("id", "userId", "value", "position")
SELECT
  md5("users"."id" || ':' || arr.idx::text || ':' || arr.value),
  "users"."id",
  arr.value,
  arr.idx - 1
FROM "users"
CROSS JOIN LATERAL unnest(COALESCE("users"."expertise", ARRAY[]::TEXT[])) WITH ORDINALITY AS arr(value, idx);

-- Data migration: skills.tags -> skill_tags
INSERT INTO "skill_tags" ("id", "skillId", "value")
SELECT
  md5("skills"."id" || ':' || arr.value),
  "skills"."id",
  arr.value
FROM "skills"
CROSS JOIN LATERAL unnest(COALESCE("skills"."tags", ARRAY[]::TEXT[])) AS arr(value);

-- Data migration: posts.tags -> post_tags
INSERT INTO "post_tags" ("id", "postId", "value")
SELECT
  md5("posts"."id" || ':' || arr.value),
  "posts"."id",
  arr.value
FROM "posts"
CROSS JOIN LATERAL unnest(COALESCE("posts"."tags", ARRAY[]::TEXT[])) AS arr(value);

-- Data migration: posts.attachments -> post_attachments
INSERT INTO "post_attachments" ("id", "postId", "url", "position")
SELECT
  md5("posts"."id" || ':' || arr.idx::text || ':' || arr.value),
  "posts"."id",
  arr.value,
  arr.idx - 1
FROM "posts"
CROSS JOIN LATERAL unnest(COALESCE("posts"."attachments", ARRAY[]::TEXT[])) WITH ORDINALITY AS arr(value, idx);

-- Drop old scalar-list columns
ALTER TABLE "users" DROP COLUMN "expertise";
ALTER TABLE "skills" DROP COLUMN "tags";
ALTER TABLE "posts" DROP COLUMN "tags";
ALTER TABLE "posts" DROP COLUMN "attachments";

-- AddForeignKey
ALTER TABLE "user_expertise" ADD CONSTRAINT "user_expertise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_tags" ADD CONSTRAINT "skill_tags_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_attachments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
