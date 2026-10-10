import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext } from "emdash/plugin";
import type { MediaReference } from "../features/catalog/kernel/index.js";
import { navigation } from "../shared/admin-blocks.js";
import { button, header, note, object } from "./common.js";

const LIBRARY_PAGE = 12;
// Images reference the EmDash Media Library by id. Block Kit 1.2.0 renders no
// media_picker on plugin admin pages, so Commerce lists the library itself
// through media:read; the admin preview uses the host's media item URL.
export type Target = { t: "image" | "gallery" | "placeholder"; id: string };
export function target(value: unknown): Target {
  const v = object(value);
  const id = typeof v.id === "string" && v.id.length <= 1024 ? v.id : "";
  if ((v.t !== "image" && v.t !== "gallery" && v.t !== "placeholder") || (v.t !== "placeholder" && !id)) throw new Error("Invalid image target");
  return { t: v.t, id };
}
export async function preview(ctx: PluginContext, reference: MediaReference | null, alt: string): Promise<Block> {
  const item = reference && ctx.media ? await ctx.media.get(reference.mediaId).catch(() => null) : null;
  return item ? { type: "image", url: item.url, alt: item.alt || alt }
    : note(reference ? "Image " + reference.mediaId + " is unavailable." : "No image");
}
export async function library(ctx: PluginContext, t: Target, cursor?: string): Promise<BlockResponse> {
  if (!ctx.media) throw new Error("Media Library unavailable. Commerce needs media:read.");
  const page = await ctx.media.list({ limit: LIBRARY_PAGE, mimeType: "image/", ...(cursor ? { cursor } : {}) });
  const blocks: Block[] = [
    header(t.t === "placeholder" ? "Choose a placeholder image" : t.t === "gallery" ? "Add to gallery" : "Choose an image"),
    navigation(), note("Media Library images."),
    { type: "actions", elements: [button("Cancel", t.t === "placeholder" ? "settings" : "open", t.id)] },
  ];
  for (const item of page.items) {
    blocks.push({ type: "image", url: item.url, alt: item.alt || item.filename },
      { type: "actions", elements: [button("Use " + item.filename, "media.use", { ...t, m: item.id })] });
  }
  if (!page.items.length) blocks.push({ type: "empty", title: "No images yet", description: "Upload images on the Media page." });
  if (page.hasMore && page.cursor) {
    blocks.push({ type: "actions", elements: [button("Next", "media.pick", { ...t, c: page.cursor })] });
  }
  return { blocks };
}
