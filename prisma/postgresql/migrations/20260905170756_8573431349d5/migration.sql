-- AlterTable
ALTER TABLE "_PagneticRecoveryHold" ALTER COLUMN "integrityTag" SET DEFAULT '',
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
