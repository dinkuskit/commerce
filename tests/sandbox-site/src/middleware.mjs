import { runScheduledTasks, withEmDashRuntime } from "emdash/middleware";
import { handleCourierProof } from "./courier-proof.mjs";
import { handleMaintenanceProof } from "./maintenance-proof.mjs";

export function onRequest(context, next) {
  return handleCourierProof(context, () => handleMaintenanceProof(context, next, {
    development: import.meta.env.DEV,
    runMaintenance: runScheduledTasks,
  }), { development: import.meta.env.DEV, withRuntime: withEmDashRuntime });
}
