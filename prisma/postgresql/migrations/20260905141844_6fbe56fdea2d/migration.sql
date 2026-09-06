-- CreateTable
CREATE TABLE "PrivacyArtifactChunk" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "payloadCiphertext" TEXT NOT NULL,
    "ciphertextHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyArtifactChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyArtifactChunk_expiresAt_id_idx" ON "PrivacyArtifactChunk"("expiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyArtifactChunk_requestId_kind_ordinal_key" ON "PrivacyArtifactChunk"("requestId", "kind", "ordinal");

-- AddForeignKey
ALTER TABLE "PrivacyArtifactChunk" ADD CONSTRAINT "PrivacyArtifactChunk_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
