ALTER TABLE "AutopilotPlan"
ADD COLUMN "orchestrationProtocolVersion" TEXT NOT NULL DEFAULT 'autopilot-plan-v1';

CREATE INDEX "AutopilotPlan_orchestrationProtocolVersion_idx"
ON "AutopilotPlan"("orchestrationProtocolVersion");
