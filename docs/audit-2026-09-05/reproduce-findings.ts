// Read-only audit probes. No production database or network access.
// Run: node --import tsx docs/audit-2026-09-05/reproduce-findings.ts
import { analyzeExperiment, type ExperimentAnalysisInput } from '../../app/services/experiment-analysis';
import { buildPublicPreviews } from '../../app/services/public-preview';
import { scoreProductCandidate } from '../../app/services/autopilot';
import { reconcileOrderAttribution } from '../../app/services/measurement.server';
import type { PrismaClient } from '@prisma/client';

const assignments = Array.from({ length: 1000 }, (_, i) => ({
  id: `a${i}`, arm: i < 500 ? 'ORIGINAL' as const : 'MATCHED' as const,
}));
const decisions = assignments.map((a, i) => ({ id: `d${i}`, assignmentId: a.id, sessionId: `s${i}` }));
const base: ExperimentAnalysisInput = {
  testType: 'AA', startedAt: new Date('2026-01-01'), endedAt: null,
  now: new Date('2026-01-23'), healthReadiness: 'COLLECTING',
  registration: { hypothesis: 'Audit synthetic fixture', revenueDefinition: 'NET',
    minimumMeaningfulLift: 0.05, alpha: 0.05, targetSampleSize: 1000,
    minimumDurationDays: 14, maximumDurationDays: 42, dataMaturityLagDays: 7 },
  assignments, decisions, orders: [],
};
function probe(name: string, input: ExperimentAnalysisInput) {
  const a = analyzeExperiment(input);
  console.log(JSON.stringify({ name, state: a.resultState, maturity: a.maturity,
    interval: a.interval, dataMaturityAt: a.dataMaturityAt,
    sessions: a.control.sessions + a.treatment.sessions, reasons: a.reasons }));
}
probe('zero_orders_and_collecting_health', base);
probe('past_maximum_duration_insufficient_sample', {
  ...base, now: new Date('2026-05-01'), assignments: assignments.slice(0, 10), decisions: decisions.slice(0, 10),
});
probe('open_enrollment_is_called_mature', { ...base, healthReadiness: 'READY' });
probe('one_arm_has_no_sessions', {
  ...base, healthReadiness: 'READY', assignments: assignments.map(a => ({ ...a, arm: 'ORIGINAL' })),
});
const preview = buildPublicPreviews({ title: 'Canvas Everyday Tote', description:
  'The tote has a blue cotton lining. The tote includes an internal zipper pocket. The bag measures forty centimetres across. The straps are stitched to the body.' });
console.log(JSON.stringify({ name: 'angle_variants_can_be_identical',
  angleCards: preview.cards.slice(2).length,
  uniqueAngleBodies: new Set(preview.cards.slice(2).map(c => JSON.stringify([c.headline,c.supportingLine,c.benefits]))).size }));
const score = scoreProductCandidate({productId:'fixture',title:'Fixture',status:'ACTIVE',
  sourceTextLength:500,sourceReadinessScore:100,recentEligibleSessions:2800,
  recentNetRevenueMinor:500000,recentOrders:84,acquisitionCoverage:0.5,
  availableVariants:1,totalVariants:1,conflictingExperiment:false });
console.log(JSON.stringify({name:'duration_ignores_stage_and_maturity_floors',duration:score.expectedDurationDays,band:score.durationBand}));
// Approximate two-proportion power, fixed AOV and independent sessions only.
// This is illustrative, not an RPS sample-size calculator.
for (const relative of [0.05,0.10,0.20]) {
  const p0=0.03,p1=p0*(1+relative),pbar=(p0+p1)/2;
  const perArm=Math.ceil((1.959964*Math.sqrt(2*pbar*(1-pbar))+0.841621*Math.sqrt(p0*(1-p0)+p1*(1-p1)))**2/(p1-p0)**2);
  console.log(JSON.stringify({name:'illustrative_power',baseline:p0,relativeLift:relative,totalSessions:2*perArm,
    collectionDaysAt1000EligibleDaily:Math.ceil(2*perArm/1000)}));
}

// An expired assignment is returned by the fake DB; observe whether the actual
// attribution function checks its dates before asking the DB to persist a join.
let expiredJoinRequested = false;
const mockDb = {
  decision: { findFirst: async () => ({ id: 'd-expired', merchantId: 'm',
    occurredAt: new Date('2025-01-01'),
    assignment: { id: 'a-expired', expiresAt: new Date('2025-01-08') },
    experiment: { id: 'e-expired', attributionWindowDays: 7 },
  }) },
  orderAttribution: { upsert: async ({create}: {create: unknown}) => {
    expiredJoinRequested = true; return create;
  } },
} as unknown as PrismaClient;
await reconcileOrderAttribution({db:mockDb,merchantId:'m',orderId:'o-new',decisionId:'d-expired'});
console.log(JSON.stringify({name:'expired_assignment_join',expiredJoinRequested}));
