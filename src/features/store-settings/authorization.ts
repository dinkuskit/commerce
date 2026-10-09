import { hasPermission, toRoleLevel } from "@emdash-cms/auth";
import type { SandboxedRouteContext } from "emdash/plugin";

export function merchantStoreSettingsAuthorized(route: Pick<SandboxedRouteContext, "ui" | "user">): boolean {
  try {
    return route.ui?.surface === "admin-page" && route.user !== undefined
      && hasPermission({ role: toRoleLevel(route.user.role) }, "content:edit_any");
  } catch { return false; }
}
