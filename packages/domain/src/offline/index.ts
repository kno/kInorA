/**
 * Offline domain subpath barrel (09b-v1-workout-offline-history).
 *
 * Pure, framework-free functions shared by the web (idb) and mobile
 * (AsyncStorage) offline mutation queues, plus the session-history
 * aggregation used by the queue-independent history read slice.
 */

export { collapseQueue } from "./collapse-queue.js";

export {
  computeAverageRpe,
  computeSessionVolume,
  computeVolumeTrend,
} from "./session-aggregation.js";
