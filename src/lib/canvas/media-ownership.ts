/**
 * Canonical owner-layout policy for Super Canvas OSS object keys.
 *
 * Keep folder and segment rules here so media URL resolution and history
 * extraction cannot drift into separate ownership allowlists.
 */

const USER_MEDIA_FOLDERS = new Set([
  "videos",
  "quick-gen",
  "images",
  "products",
  "avatars",
  "model-avatars",
  "model-demos",
  "user-uploads",
  "veo-videos",
  "misc",
]);

function isPlainSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== "..";
}

function isValidOwnerToken(userId: unknown): userId is string {
  return typeof userId === "string" && isPlainSegment(userId);
}

export function isOwnedObjectKey(key: unknown, userId: unknown): boolean {
  if (typeof key !== "string" || !key || !isValidOwnerToken(userId)) return false;

  const segments = key.split("/");
  if (segments.length < 3 || !segments.every(isPlainSegment)) return false;

  if (
    segments[0] === "videos" &&
    (segments[1] === "slideshow" || segments[1] === "assembly")
  ) {
    return segments.length === 4 && segments[2] === userId;
  }

  return segments.length === 3 && USER_MEDIA_FOLDERS.has(segments[0]) && segments[1] === userId;
}
