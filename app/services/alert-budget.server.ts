import {
  constants,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type AlertBudgetRecord = {
  version: 1;
  month: string;
  attempts: number;
  lastReservedAt: string;
};
const FILE = "monthly-alert-attempts.json";
function validateDirectory(directory: string) {
  if (!path.isAbsolute(directory)) throw new Error("ALERT_BUDGET_UNAVAILABLE");
  let current = directory;
  for (;;) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("ALERT_BUDGET_UNAVAILABLE");
    if (current === directory && (stat.mode & 0o077) !== 0)
      throw new Error("ALERT_BUDGET_UNAVAILABLE");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function validateRecord(value: unknown): AlertBudgetRecord {
  const record = value as AlertBudgetRecord;
  if (
    !record ||
    Object.keys(record).sort().join(",") !==
      "attempts,lastReservedAt,month,version" ||
    record.version !== 1 ||
    !/^\d{4}-\d{2}$/.test(record.month) ||
    !Number.isSafeInteger(record.attempts) ||
    record.attempts < 0 ||
    record.attempts > 100 ||
    !Number.isFinite(Date.parse(record.lastReservedAt)) ||
    new Date(record.lastReservedAt).toISOString() !== record.lastReservedAt ||
    record.lastReservedAt.slice(0, 7) !== record.month
  )
    throw new Error("ALERT_BUDGET_UNAVAILABLE");
  return record;
}
function writeRecord(directory: string, record: AlertBudgetRecord) {
  const temporary = path.join(directory, `.budget-${process.pid}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify(record));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path.join(directory, FILE));
    const dirFd = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* already renamed */
    }
  }
}
/** Explicit bootstrap only: callers must conservatively seed existing monthly attempts. Never resets an existing record. */
export function seedAlertBudget(directory: string, record: AlertBudgetRecord) {
  validateDirectory(directory);
  validateRecord(record);
  const lock = path.join(directory, ".lock");
  mkdirSync(lock, { mode: 0o700 });
  try {
    const fd = openSync(
      path.join(directory, FILE),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, JSON.stringify(record));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    rmdirSync(lock);
  }
}

/** Reserve before EVERY fetch; failures and retries consume the same global allowance. */
export function reserveAlertAttempt(environment: NodeJS.ProcessEnv, now: Date) {
  const directory =
    environment.ALERT_BUDGET_DIRECTORY ??
    (environment.NODE_ENV === "production"
      ? "/data/financial-guardrails"
      : undefined);
  if (!directory) return;
  const configured = environment.ALERT_MONTHLY_SEND_LIMIT ?? "100";
  if (!/^(?:[1-9]|[1-9]\d|100)$/.test(configured))
    throw new Error("ALERT_BUDGET_UNAVAILABLE");
  let locked = false;
  const lock = path.join(directory, ".lock");
  try {
    validateDirectory(directory);
    mkdirSync(lock, { mode: 0o700 });
    locked = true;
    const file = path.join(directory, FILE);
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 1024
    )
      throw new Error("ALERT_BUDGET_UNAVAILABLE");
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let record: AlertBudgetRecord;
    try {
      record = validateRecord(JSON.parse(readFileSync(fd, "utf8")));
    } finally {
      closeSync(fd);
    }
    const timestamp = now.toISOString();
    if (timestamp < record.lastReservedAt)
      throw new Error("ALERT_BUDGET_CLOCK_ROLLBACK");
    const month = timestamp.slice(0, 7);
    if (month > record.month)
      record = { version: 1, month, attempts: 0, lastReservedAt: timestamp };
    if (record.attempts >= Number(configured))
      throw new Error("ALERT_BUDGET_EXHAUSTED");
    writeRecord(directory, {
      ...record,
      attempts: record.attempts + 1,
      lastReservedAt: timestamp,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /^ALERT_BUDGET_(UNAVAILABLE|EXHAUSTED|CLOCK_ROLLBACK)$/.test(
        error.message,
      )
    )
      throw error;
    throw new Error("ALERT_BUDGET_UNAVAILABLE");
  } finally {
    if (locked) rmdirSync(lock);
  }
}
