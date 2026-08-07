CREATE TYPE "public"."self_described_sex" AS ENUM ('female', 'male', 'non_binary', 'other', 'prefer_not_to_say');
ALTER TABLE "user_profiles" ADD COLUMN "self_described_sex" "self_described_sex";
ALTER TABLE "user_profiles" ADD COLUMN "height_cm" integer;
