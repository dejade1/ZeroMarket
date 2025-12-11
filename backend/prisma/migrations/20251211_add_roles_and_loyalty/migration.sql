-- Crear nuevas tablas
CREATE TABLE "LoyaltyPointsHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "orderId" INTEGER,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyPointsHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ClientOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "total" REAL NOT NULL,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "pointsUsed" INTEGER NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Agregar nueva columna role a User (como TEXT)
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'CLIENT';

-- Migrar datos: isAdmin true -> ADMIN, isAdmin false -> CLIENT
UPDATE "User" SET "role" = 'ADMIN' WHERE "isAdmin" = 1;
UPDATE "User" SET "role" = 'CLIENT' WHERE "isAdmin" = 0;

-- Agregar columna loyaltyPoints
ALTER TABLE "User" ADD COLUMN "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- Crear índices
CREATE INDEX "LoyaltyPointsHistory_userId_createdAt_idx" ON "LoyaltyPointsHistory"("userId", "createdAt");
CREATE INDEX "ClientOrder_userId_createdAt_idx" ON "ClientOrder"("userId", "createdAt");
CREATE INDEX "ClientOrder_createdAt_idx" ON "ClientOrder"("createdAt");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_loyaltyPoints_idx" ON "User"("loyaltyPoints");

-- NOTA: La columna isAdmin se mantiene por compatibilidad
-- En el backend, usaremos "role" en lugar de "isAdmin"
