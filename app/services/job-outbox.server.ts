import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

type TransactionDb = Prisma.TransactionClient;
type QueueDb = PrismaClient | TransactionDb;

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 8;

function attemptLimit(value = DEFAULT_MAX_ATTEMPTS) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000)
    throw new Error("Invalid queue attempt limit.");
  return value;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  if (typeof value === "bigint") return value.toString(10);
  return value;
}

export function canonicalQueuePayload(payload: unknown) {
  return JSON.stringify(canonicalize(payload));
}

function payloadHash(payloadJson: string, schemaVersion: number) {
  return createHash("sha256")
    .update(`${schemaVersion}\n${payloadJson}`)
    .digest("hex");
}

function assertQueueInput(input: {
  merchantId: string;
  type: string;
  idempotencyKey: string;
  payloadSchemaVersion: number;
}) {
  if (!input.merchantId || input.merchantId.length > 160)
    throw new Error("Invalid queue merchant scope.");
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(input.type))
    throw new Error("Invalid queue type.");
  if (!input.idempotencyKey || input.idempotencyKey.length > 200)
    throw new Error("Invalid queue idempotency key.");
  if (
    !Number.isInteger(input.payloadSchemaVersion) ||
    input.payloadSchemaVersion < 1
  )
    throw new Error("Invalid queue payload schema version.");
}

export class QueueIdempotencyConflictError extends Error {
  code = "IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("The idempotency key was already used with different input.");
  }
}

export async function enqueueJob(args: {
  db: QueueDb;
  merchantId: string;
  type: string;
  idempotencyKey: string;
  payloadSchemaVersion?: number;
  payload: unknown;
  nextRunAt?: Date;
}) {
  const payloadSchemaVersion = args.payloadSchemaVersion ?? 1;
  assertQueueInput({ ...args, payloadSchemaVersion });
  const payloadJson = canonicalQueuePayload(args.payload);
  const inputHash = payloadHash(payloadJson, payloadSchemaVersion);
  const job = await args.db.job.upsert({
    where: {
      merchantId_idempotencyKey: {
        merchantId: args.merchantId,
        idempotencyKey: args.idempotencyKey,
      },
    },
    create: {
      merchantId: args.merchantId,
      type: args.type,
      idempotencyKey: args.idempotencyKey,
      inputHash,
      payloadSchemaVersion,
      payloadJson,
      nextRunAt: args.nextRunAt ?? new Date(),
    },
    update: {},
  });
  if (job.type !== args.type || job.inputHash !== inputHash)
    throw new QueueIdempotencyConflictError();
  return job;
}

export async function enqueueOutboxEvent(args: {
  db: QueueDb;
  merchantId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
  payloadSchemaVersion?: number;
  payload: unknown;
  nextRunAt?: Date;
}) {
  const payloadSchemaVersion = args.payloadSchemaVersion ?? 1;
  assertQueueInput({ ...args, payloadSchemaVersion });
  if (!args.aggregateType || !args.aggregateId)
    throw new Error("Outbox events require an aggregate scope.");
  const payloadJson = canonicalQueuePayload(args.payload);
  const inputHash = payloadHash(payloadJson, payloadSchemaVersion);
  const event = await args.db.outboxEvent.upsert({
    where: {
      merchantId_idempotencyKey: {
        merchantId: args.merchantId,
        idempotencyKey: args.idempotencyKey,
      },
    },
    create: {
      merchantId: args.merchantId,
      type: args.type,
      aggregateType: args.aggregateType,
      aggregateId: args.aggregateId,
      idempotencyKey: args.idempotencyKey,
      inputHash,
      payloadSchemaVersion,
      payloadJson,
      nextRunAt: args.nextRunAt ?? new Date(),
    },
    update: {},
  });
  if (
    event.type !== args.type ||
    event.aggregateType !== args.aggregateType ||
    event.aggregateId !== args.aggregateId ||
    event.inputHash !== inputHash
  )
    throw new QueueIdempotencyConflictError();
  return event;
}

function claimable(now: Date) {
  return {
    OR: [
      { status: { in: ["PENDING", "RETRY"] }, nextRunAt: { lte: now } },
      { status: "RUNNING", leaseUntil: { lte: now } },
    ],
  };
}

export async function claimJobs(args: {
  db: PrismaClient;
  workerId: string;
  now?: Date;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  merchantId?: string;
  types?: string[];
}) {
  const now = args.now ?? new Date();
  const maxAttempts = attemptLimit(args.maxAttempts);
  const limit = Math.min(100, Math.max(1, args.limit ?? 25));
  const leaseMs = Math.min(
    5 * 60_000,
    Math.max(1_000, args.leaseMs ?? DEFAULT_LEASE_MS),
  );
  return args.db.$transaction(async (tx) => {
    const candidates = await tx.job.findMany({
      where: {
        ...claimable(now),
        merchantId: args.merchantId,
        type: args.types ? { in: args.types } : undefined,
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    const claimed = [];
    for (const candidate of candidates) {
      if (candidate.attempts >= maxAttempts) {
        await tx.job.updateMany({
          where: {
            id: candidate.id,
            attempts: { gte: maxAttempts },
            ...claimable(now),
          },
          data: {
            status: "DEAD_LETTER",
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: "ATTEMPTS_EXHAUSTED",
          },
        });
        continue;
      }
      const leaseToken = `${args.workerId}:${randomUUID()}`;
      const result = await tx.job.updateMany({
        where: {
          id: candidate.id,
          attempts: { lt: maxAttempts },
          ...claimable(now),
        },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          leaseToken,
          leaseUntil: new Date(now.getTime() + leaseMs),
          lastErrorCode: null,
        },
      });
      if (result.count === 1) {
        claimed.push(
          await tx.job.findUniqueOrThrow({ where: { id: candidate.id } }),
        );
      }
    }
    return claimed;
  });
}

export async function completeJob(args: {
  db: PrismaClient;
  merchantId: string;
  jobId: string;
  leaseToken: string;
  resultRef?: string | null;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const updated = await args.db.job.updateMany({
    where: {
      id: args.jobId,
      merchantId: args.merchantId,
      status: "RUNNING",
      leaseToken: args.leaseToken,
      leaseUntil: { gt: now },
    },
    data: {
      status: "COMPLETED",
      leaseToken: null,
      leaseUntil: null,
      resultRef: args.resultRef ?? null,
      lastErrorCode: null,
    },
  });
  if (updated.count !== 1) throw new Error("STALE_JOB_LEASE");
}

export async function failJob(args: {
  db: PrismaClient;
  merchantId: string;
  jobId: string;
  leaseToken: string;
  errorCode: string;
  now?: Date;
  maxAttempts?: number;
}) {
  const now = args.now ?? new Date();
  const maxAttempts = attemptLimit(args.maxAttempts);
  return args.db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        id: args.jobId,
        merchantId: args.merchantId,
        status: "RUNNING",
        leaseToken: args.leaseToken,
        leaseUntil: { gt: now },
      },
    });
    if (!job) throw new Error("STALE_JOB_LEASE");
    const terminal = job.attempts >= maxAttempts;
    const updated = await tx.job.updateMany({
      where: {
        id: job.id,
        merchantId: args.merchantId,
        status: "RUNNING",
        leaseToken: args.leaseToken,
        leaseUntil: { gt: now },
      },
      data: {
        status: terminal ? "DEAD_LETTER" : "RETRY",
        nextRunAt: terminal
          ? job.nextRunAt
          : new Date(
              now.getTime() + Math.min(60 * 60_000, 1_000 * 2 ** job.attempts),
            ),
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: args.errorCode.slice(0, 120),
      },
    });
    if (updated.count !== 1) throw new Error("STALE_JOB_LEASE");
    return tx.job.findUniqueOrThrow({ where: { id: job.id } });
  });
}

export async function claimOutboxEvents(args: {
  db: PrismaClient;
  workerId: string;
  now?: Date;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  merchantId?: string;
  types?: string[];
}) {
  const now = args.now ?? new Date();
  const maxAttempts = attemptLimit(args.maxAttempts);
  const limit = Math.min(100, Math.max(1, args.limit ?? 25));
  const leaseMs = Math.min(
    5 * 60_000,
    Math.max(1_000, args.leaseMs ?? DEFAULT_LEASE_MS),
  );
  return args.db.$transaction(async (tx) => {
    const candidates = await tx.outboxEvent.findMany({
      where: {
        ...claimable(now),
        merchantId: args.merchantId,
        type: args.types ? { in: args.types } : undefined,
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    const claimed = [];
    for (const candidate of candidates) {
      if (candidate.attempts >= maxAttempts) {
        await tx.outboxEvent.updateMany({
          where: {
            id: candidate.id,
            attempts: { gte: maxAttempts },
            ...claimable(now),
          },
          data: {
            status: "DEAD_LETTER",
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: "ATTEMPTS_EXHAUSTED",
          },
        });
        continue;
      }
      const leaseToken = `${args.workerId}:${randomUUID()}`;
      const result = await tx.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          attempts: { lt: maxAttempts },
          ...claimable(now),
        },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          leaseToken,
          leaseUntil: new Date(now.getTime() + leaseMs),
          lastErrorCode: null,
        },
      });
      if (result.count === 1) {
        claimed.push(
          await tx.outboxEvent.findUniqueOrThrow({
            where: { id: candidate.id },
          }),
        );
      }
    }
    return claimed;
  });
}

export async function markOutboxDelivered(args: {
  db: PrismaClient;
  merchantId: string;
  eventId: string;
  leaseToken: string;
  deliveredAt?: Date;
}) {
  const deliveredAt = args.deliveredAt ?? new Date();
  const updated = await args.db.outboxEvent.updateMany({
    where: {
      id: args.eventId,
      merchantId: args.merchantId,
      status: "RUNNING",
      leaseToken: args.leaseToken,
      leaseUntil: { gt: deliveredAt },
    },
    data: {
      status: "DELIVERED",
      deliveredAt,
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: null,
    },
  });
  if (updated.count !== 1) throw new Error("STALE_OUTBOX_LEASE");
}

export async function failOutboxEvent(args: {
  db: PrismaClient;
  merchantId: string;
  eventId: string;
  leaseToken: string;
  errorCode: string;
  now?: Date;
  maxAttempts?: number;
}) {
  const now = args.now ?? new Date();
  const maxAttempts = attemptLimit(args.maxAttempts);
  const where = {
    id: args.eventId,
    merchantId: args.merchantId,
    status: "RUNNING",
    leaseToken: args.leaseToken,
    leaseUntil: { gt: now },
  };
  return args.db.$transaction(async (tx) => {
    const event = await tx.outboxEvent.findFirst({ where });
    if (!event) throw new Error("STALE_OUTBOX_LEASE");
    const terminal = event.attempts >= maxAttempts;
    const updated = await tx.outboxEvent.updateMany({
      where,
      data: {
        status: terminal ? "DEAD_LETTER" : "RETRY",
        nextRunAt: terminal
          ? event.nextRunAt
          : new Date(
              now.getTime() +
                Math.min(60 * 60_000, 1_000 * 2 ** event.attempts),
            ),
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: args.errorCode.slice(0, 120),
      },
    });
    if (updated.count !== 1) throw new Error("STALE_OUTBOX_LEASE");
    return tx.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
  });
}

export async function skipOutboxEvent(args: {
  db: PrismaClient;
  merchantId: string;
  eventId: string;
  leaseToken: string;
  reason: string;
  now?: Date;
}) {
  const updated = await args.db.outboxEvent.updateMany({
    where: {
      id: args.eventId,
      merchantId: args.merchantId,
      status: "RUNNING",
      leaseToken: args.leaseToken,
      leaseUntil: { gt: args.now ?? new Date() },
    },
    data: {
      status: "SKIPPED",
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: args.reason.slice(0, 120),
    },
  });
  if (updated.count !== 1) throw new Error("STALE_OUTBOX_LEASE");
}
