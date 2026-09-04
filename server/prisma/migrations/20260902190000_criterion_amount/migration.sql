ALTER TABLE "Criterion" ADD COLUMN "amount" INTEGER;
UPDATE "Criterion" SET "amount" = "maxAmount" WHERE "type" = 'FIXED';
