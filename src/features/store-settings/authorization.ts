import type { SandboxedRouteContext } from "emdash/plugin";

// EmDash itself checks content:edit_any on the admin route before this runs; this is the same
// rule as a backstop. EmDash's roles are 10, 20, 30, 40 (Editor) and 50 (Admin), so Editor and
// above is exactly 40 or 50, and any other value is refused (tests compare it with EmDash's own).
export function merchantStoreSettingsAuthorized(route: Pick<SandboxedRouteContext, "ui" | "user">): boolean {
  const role = route.user?.role as unknown;
  return route.ui?.surface === "admin-page" && (role === 40 || role === 50);
}
