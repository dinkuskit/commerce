import { runScheduledTasks } from "emdash/middleware";
import { handleMaintenanceProof } from "./maintenance-proof.mjs";

export function onRequest(context, next) {
  return handleMaintenanceProof(context, next, {
    development: import.meta.env.DEV,
    runMaintenance: runScheduledTasks,
  });
}
