-- Water charges payable on Stellar and the building treasury ("caja") that
-- receives them. Additive only: two new tables and one enum, no backfill.
-- The explicit transaction keeps the script atomic: Prisma 7 may otherwise
-- split it and autocommit each statement.
BEGIN;

-- CreateEnum
CREATE TYPE "water_charge_status" AS ENUM ('pending', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "building_treasuries" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetIssuer" TEXT NOT NULL,
    "signers" JSONB NOT NULL,
    "threshold" INTEGER NOT NULL,
    "setupTxHash" TEXT NOT NULL,
    "lastCursor" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_treasuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_charges" (
    "id" UUID NOT NULL,
    "apartmentMonthlyConsumptionId" UUID NOT NULL,
    "apartmentId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "treasuryId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "amountBs" DECIMAL(10,2) NOT NULL,
    "exchangeRate" DECIMAL(10,4) NOT NULL,
    "amountUsdc" DECIMAL(18,7) NOT NULL,
    "memo" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "status" "water_charge_status" NOT NULL DEFAULT 'pending',
    "txHash" TEXT,
    "payerAddress" TEXT,
    "paidAmountUsdc" DECIMAL(18,7),
    "ledger" INTEGER,
    "paidAt" TIMESTAMP(3),
    "faucetDrips" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "water_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "building_treasuries_buildingId_key" ON "building_treasuries"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "building_treasuries_publicKey_key" ON "building_treasuries"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "water_charges_apartmentMonthlyConsumptionId_key" ON "water_charges"("apartmentMonthlyConsumptionId");

-- CreateIndex
CREATE UNIQUE INDEX "water_charges_memo_key" ON "water_charges"("memo");

-- CreateIndex
CREATE UNIQUE INDEX "water_charges_publicCode_key" ON "water_charges"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "water_charges_txHash_key" ON "water_charges"("txHash");

-- CreateIndex
CREATE INDEX "water_charges_buildingId_month_idx" ON "water_charges"("buildingId", "month");

-- CreateIndex
CREATE INDEX "water_charges_apartmentId_idx" ON "water_charges"("apartmentId");

-- CreateIndex
CREATE INDEX "water_charges_treasuryId_status_idx" ON "water_charges"("treasuryId", "status");

-- AddForeignKey
ALTER TABLE "building_treasuries" ADD CONSTRAINT "building_treasuries_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_charges" ADD CONSTRAINT "water_charges_apartmentMonthlyConsumptionId_fkey" FOREIGN KEY ("apartmentMonthlyConsumptionId") REFERENCES "apartment_monthly_consumption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_charges" ADD CONSTRAINT "water_charges_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_charges" ADD CONSTRAINT "water_charges_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_charges" ADD CONSTRAINT "water_charges_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "building_treasuries"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
