-- AlterTable
ALTER TABLE "Product" ADD COLUMN "slot" INTEGER;
ALTER TABLE "Product" ADD COLUMN "slotDistance" INTEGER;

-- CreateIndex
CREATE INDEX "Product_slot_idx" ON "Product"("slot");
