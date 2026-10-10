import { Role, toRoleLevel } from "@emdash-cms/auth";
import type { SandboxedRouteContext } from "emdash/plugin";

// Same rule as hasPermission(user, "content:edit_any") (editor and above), without bundling
// EmDash's whole permission table; toRoleLevel still refuses any role EmDash does not define.
export function merchantStoreSettingsAuthorized(route: Pick<SandboxedRouteContext, "ui" | "user">): boolean {
  try {
    return route.ui?.surface === "admin-page" && route.user !== undefined
      && toRoleLevel(route.user.role) >= Role.EDITOR;
  } catch { return false; }
}
