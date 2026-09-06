CREATE TABLE "PrivacyArtifactChunk" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "payloadCiphertext" TEXT NOT NULL,
  "ciphertextHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "PrivacyArtifactChunk_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrivacyArtifactChunk_requestId_kind_ordinal_key" ON "PrivacyArtifactChunk"("requestId", "kind", "ordinal");
CREATE INDEX "PrivacyArtifactChunk_expiresAt_id_idx" ON "PrivacyArtifactChunk"("expiresAt", "id");
