import type { SandboxedPlugin } from "emdash/plugin";
import { commerceAdmin } from "./admin/index.js";

const plugin: SandboxedPlugin = {
  routes: {
    admin: {
      permission: "content:edit_any",
      methods: ["POST"],
      handler: commerceAdmin,
    },
  },
};
export default plugin;
