import { stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";

const RESERVE = 256n * 1024n * 1024n;

type Allocation = { device: bigint; availableBytes: bigint; requiredBytes: bigint };

/** Sum demands when source, scratch and cache share a filesystem. */
export function verifyBackupHeadroom(allocations: Allocation[]) {
  const volumes = new Map<bigint, { available: bigint; required: bigint }>();
  for (const item of allocations) {
    if (item.availableBytes < 0n || item.requiredBytes < 0n)
      throw new Error("BACKUP_STORAGE_MEASUREMENT_INVALID");
    const prior = volumes.get(item.device);
    volumes.set(item.device, {
      available: prior && prior.available < item.availableBytes ? prior.available : item.availableBytes,
      required: (prior?.required ?? RESERVE) + item.requiredBytes,
    });
  }
  for (const value of volumes.values()) {
    if (value.available < value.required) throw new Error("BACKUP_STORAGE_HEADROOM_INSUFFICIENT");
  }
  return { checkedFilesystems: volumes.size };
}

/** Conservative preflight, not a reservation or a guarantee against concurrent growth. */
export async function assertBackupHeadroom(sourcePath: string, directory: string) {
  const source = await stat(sourcePath, { bigint: true });
  let walBytes = 0n;
  try { walBytes = (await stat(`${sourcePath}-wal`, { bigint: true })).size; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Count WAL even when pages overlap; allow another full logical-size increment.
  const estimate = 2n * (source.size + walBytes + 4096n);
  const demands = [
    { path: sourcePath, requiredBytes: estimate }, // ongoing database/WAL growth
    { path: tmpdir(), requiredBytes: 6n * estimate }, // snapshot/encryption/readback/restore copies
    { path: directory, requiredBytes: estimate }, // new local encrypted cache pair
  ];
  const allocations = await Promise.all(demands.map(async ({ path, requiredBytes }) => {
    const [entry, space] = await Promise.all([stat(path, { bigint: true }), statfs(path, { bigint: true })]);
    return { device: entry.dev, availableBytes: space.bavail * space.bsize, requiredBytes };
  }));
  return verifyBackupHeadroom(allocations);
}
