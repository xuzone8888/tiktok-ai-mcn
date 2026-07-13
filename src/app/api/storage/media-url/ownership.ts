/**
 * 超级画布 · OSS 对象 key 归属判定(P0 · S6 安全闸,#28「不泄露跨用户对象」)
 *
 * 媒体解析端点只允许 authenticated user 解析**自己拥有**的对象。OSS 对象键(见 src/lib/oss.ts
 * generateMediaPath 与幻灯片成片路径)遵循固定布局,owner 段位置随布局而定:
 *   - 布局 A:{folder}/{userId}/{file}          —— images/videos/quick-gen/products/... 上传与生成
 *   - 布局 B:videos/slideshow/{userId}/{file}   —— 幻灯片成片(generate-slideshow)
 * 归属 = owner 段与请求者 user.id **精确**相等(大小写敏感、无编码/大小写归一)。
 *
 * fail-closed 硬约束:任何**不匹配已知布局**、owner 段缺失/为他人 UUID、含空段/`.`/`..` 混淆段、
 * 段数不符(额外/缺失段)的 key 一律拒。**没有明确公共资产契约**——绝不以「对象本来公开」为由放行。
 * 若 P1 需共享/公共资产入画布,须在此新增显式白名单契约,而非放宽 owner 校验。
 *
 * 纯逻辑、零依赖 —— 可离线单测。charset 由端点上游 describeMediaKeyRejection 已保证,本模块再自证段合法性。
 */

/** 布局 A 支持的 folder(与 oss.ts StorageFolder 对齐);owner 恒在第 2 段。 */
const USER_MEDIA_FOLDERS = new Set([
  "videos",
  "quick-gen",
  "images",
  "products",
  "avatars",
  "model-avatars",
  "model-demos",
  "user-uploads",
  "misc",
]);

/** 段合法性:非空、非 `.`/`..` 混淆段(防路径穿越/规避 owner 定位)。 */
function isPlainSegment(segment: string): boolean {
  return typeof segment === "string" && segment.length > 0 && segment !== "." && segment !== "..";
}

/** owner token(user.id):必须是非空 plain 段;精确比较,不做大小写/编码归一。 */
function isValidOwnerToken(userId: unknown): userId is string {
  return typeof userId === "string" && isPlainSegment(userId);
}

/**
 * key 是否为 userId 拥有的对象。匹配已知布局且 owner 段 === userId 才为真;其余一律 false(fail-closed)。
 */
export function isOwnedObjectKey(key: unknown, userId: unknown): boolean {
  if (typeof key !== "string" || key.length === 0) return false;
  if (!isValidOwnerToken(userId)) return false;

  const segments = key.split("/");
  if (segments.length < 3) return false; // 至少 folder/owner/file
  if (!segments.every(isPlainSegment)) return false; // 无空段 / `.` / `..` 混淆段

  // 布局 B:videos/slideshow/{userId}/{file} —— 恰 4 段,owner 在第 3 段。
  if (segments[0] === "videos" && segments[1] === "slideshow") {
    return segments.length === 4 && segments[2] === userId;
  }

  // 布局 A:{folder}/{userId}/{file} —— 恰 3 段,folder 在白名单,owner 在第 2 段。
  if (segments.length === 3 && USER_MEDIA_FOLDERS.has(segments[0])) {
    return segments[1] === userId;
  }

  return false; // 未知布局 fail-closed
}
