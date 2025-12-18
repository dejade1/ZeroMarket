/*
  Warnings:

  - You are about to alter the column `slotDistance` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" REAL NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "initialStock" INTEGER,
    "unit" TEXT NOT NULL,
    "image" TEXT,
    "rating" REAL NOT NULL DEFAULT 0,
    "category" TEXT,
    "sales" INTEGER NOT NULL DEFAULT 0,
    "dailySales" INTEGER NOT NULL DEFAULT 0,
    "slot" INTEGER,
    "slotDistance" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("category", "createdAt", "dailySales", "description", "id", "image", "initialStock", "price", "rating", "sales", "slot", "slotDistance", "stock", "title", "unit", "updatedAt") SELECT "category", "createdAt", "dailySales", "description", "id", "image", "initialStock", "price", "rating", "sales", "slot", "slotDistance", "stock", "title", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_title_idx" ON "Product"("title");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE INDEX "Product_stock_idx" ON "Product"("stock");
CREATE INDEX "Product_sales_idx" ON "Product"("sales");
CREATE INDEX "Product_slot_idx" ON "Product"("slot");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
