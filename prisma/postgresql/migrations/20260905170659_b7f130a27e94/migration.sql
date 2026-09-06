-- AddForeignKey
ALTER TABLE "RecoveryReleaseAudit" ADD CONSTRAINT "RecoveryReleaseAudit_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "RecoveryReplayEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
