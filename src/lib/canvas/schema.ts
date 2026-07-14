/**
 * Super Canvas document contract (P0 / D2).
 *
 * `canvases.doc` persists only domain topology: nodes, edges and groups. Database
 * columns `schema_version` and `deps` remain the sole persisted sources for
 * version/dependency metadata. API/export code may combine those columns with
 * `doc` through CanvasDocumentEnvelopeSchema, but must never write the envelope
 * back into the JSONB doc column.
 *
 * React Flow view state (selected/dragging/measured/width/etc.) is deliberately
 * absent. The shell owns the RF adapter and may not persist its view objects.
 */
import { nanoid } from "nanoid";
import { z } from "zod";

export const CANVAS_SCHEMA_VERSION = 1 as const;

/** Canonical persisted canvas identity (shared by API, Runtime and durable pending-create). */
export const CANVAS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CANVAS_NODE_TYPES = [
  "text",
  "image",
  "video",
  "product",
  "script",
  "compose",
] as const;

/** Runtime alias consumed by the shell registry. */
export const NODE_TYPES = CANVAS_NODE_TYPES;
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];

export const CANVAS_ASSET_TABLES = ["ai_models", "canvas_assets"] as const;
export type CanvasAssetTable = (typeof CANVAS_ASSET_TABLES)[number];

export function describeMediaKeyRejection(value: unknown): string | null {
  if (typeof value !== "string") return "media key 必须是字符串";
  const key = value.trim();
  if (!key) return "media key 不能为空";
  if (key !== value) return "media key 不能含首尾空白";
  if (key.length > 1024) return "media key 过长(>1024)";
  if (/^data:/i.test(key)) return "禁止 dataURL 入库,只存 OSS object key";
  if (/^\/\//.test(key)) return "禁止协议相对 URL,只存 OSS object key";
  if (/:\/\//.test(key)) return "禁止完整/签名 URL 入库,只存 OSS object key";
  if (/[?#]/.test(key)) return "疑似签名 URL(含 query/fragment),只存 OSS object key";
  if (key.startsWith("/")) return "object key 必须是相对键";
  if (!/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(key)) return "非法 object key 字符";
  return null;
}

export function isOssObjectKey(value: unknown): value is string {
  return describeMediaKeyRejection(value) === null;
}

const OssObjectKeySchema = z.string().refine(isOssObjectKey, {
  message: "非法 OSS object key(禁 dataURL/签名 URL,只存对象键)",
});

export const CanvasIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!-~]+$/, "id 只能是可打印 ASCII,不含空白/控制字符");

const FiniteNumberSchema = z
  .number()
  .refine((value) => Number.isFinite(value), "必须是有限数值");

export const CanvasPositionSchema = z.strictObject({
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
});
export type CanvasPosition = z.infer<typeof CanvasPositionSchema>;

export const CanvasRefsSchema = z
  .strictObject({
    blueprintId: CanvasIdSchema.nullable().default(null),
    assetId: CanvasIdSchema.nullable().default(null),
    assetTable: z.enum(CANVAS_ASSET_TABLES).nullable().default(null),
    generationId: CanvasIdSchema.nullable().default(null),
    taskId: CanvasIdSchema.nullable().default(null),
    batchId: CanvasIdSchema.nullable().default(null),
  })
  .superRefine((refs, ctx) => {
    if ((refs.assetId === null) !== (refs.assetTable === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["assetTable"],
        message: "assetId 与 assetTable 必须同时为空或同时有值",
      });
    }
  });
export type CanvasRefs = z.infer<typeof CanvasRefsSchema>;

export function createCanvasRefs(): CanvasRefs {
  return {
    blueprintId: null,
    assetId: null,
    assetTable: null,
    generationId: null,
    taskId: null,
    batchId: null,
  };
}

export const CanvasMediaSchema = z.strictObject({
  ossKey: OssObjectKeySchema,
  posterKey: OssObjectKeySchema.optional(),
});
export type CanvasMedia = z.infer<typeof CanvasMediaSchema>;

export const CanvasNodeDataSchema = z
  .strictObject({
    title: z.string().max(2000).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    refs: CanvasRefsSchema.default(createCanvasRefs),
    media: CanvasMediaSchema.optional(),
  })
  .default(() => ({ refs: createCanvasRefs() }));
export type CanvasNodeData = z.infer<typeof CanvasNodeDataSchema>;

export const CanvasNodeSchema = z.strictObject({
  id: CanvasIdSchema,
  type: z.enum(CANVAS_NODE_TYPES),
  variant: z.string().min(1).max(64).optional(),
  position: CanvasPositionSchema,
  group_id: CanvasIdSchema.nullable().default(null),
  data: CanvasNodeDataSchema,
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const CanvasEdgeSchema = z.strictObject({
  id: CanvasIdSchema,
  source: CanvasIdSchema,
  target: CanvasIdSchema,
  sourceHandle: z.string().max(128).nullable().default(null),
  targetHandle: z.string().max(128).nullable().default(null),
});
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

export const CanvasGroupSchema = z.strictObject({
  id: CanvasIdSchema,
  label: z.string().max(200).default(""),
  node_ids: z.array(CanvasIdSchema).default(() => []),
});
export type CanvasGroup = z.infer<typeof CanvasGroupSchema>;

const CanvasDocShapeSchema = z.strictObject({
  nodes: z.array(CanvasNodeSchema).default(() => []),
  edges: z.array(CanvasEdgeSchema).default(() => []),
  groups: z.array(CanvasGroupSchema).default(() => []),
});

/** Structural plus referential write contract. */
export const CanvasDocSchema = CanvasDocShapeSchema.superRefine((doc, ctx) => {
  const nodeIds = new Set<string>();
  doc.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "id"],
        message: `节点 id 重复:${node.id}`,
      });
    }
    nodeIds.add(node.id);
  });

  const edgeIds = new Set<string>();
  doc.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["edges", index, "id"],
        message: `连线 id 重复:${edge.id}`,
      });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      ctx.addIssue({
        code: "custom",
        path: ["edges", index, "source"],
        message: `源节点不存在:${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      ctx.addIssue({
        code: "custom",
        path: ["edges", index, "target"],
        message: `目标节点不存在:${edge.target}`,
      });
    }
  });

  const groupIds = new Set<string>();
  doc.groups.forEach((group, index) => {
    if (groupIds.has(group.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["groups", index, "id"],
        message: `成组 id 重复:${group.id}`,
      });
    }
    groupIds.add(group.id);
  });

  const membership = new Map<string, string>();
  doc.groups.forEach((group, groupIndex) => {
    const local = new Set<string>();
    group.node_ids.forEach((nodeId, memberIndex) => {
      if (local.has(nodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", groupIndex, "node_ids", memberIndex],
          message: `成组成员重复:${nodeId}`,
        });
      }
      local.add(nodeId);
      if (!nodeIds.has(nodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", groupIndex, "node_ids", memberIndex],
          message: `成员节点不存在:${nodeId}`,
        });
      }
      const previous = membership.get(nodeId);
      if (previous && previous !== group.id) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", groupIndex, "node_ids", memberIndex],
          message: `节点 ${nodeId} 同时属于 ${previous} 与 ${group.id}`,
        });
      } else {
        membership.set(nodeId, group.id);
      }
    });
  });

  doc.nodes.forEach((node, index) => {
    if (node.group_id && !groupIds.has(node.group_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "group_id"],
        message: `成组不存在:${node.group_id}`,
      });
    }
    const listedGroup = membership.get(node.id) ?? null;
    if (node.group_id !== listedGroup) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "group_id"],
        message: `group_id 与 group.node_ids 不一致(${String(node.group_id)} != ${String(
          listedGroup
        )})`,
      });
    }
  });
});
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;

const CanvasDependencyRefSchema = z.strictObject({
  id: CanvasIdSchema,
  table: z.enum(CANVAS_ASSET_TABLES),
});

export const CanvasDepsSchema = z
  .strictObject({
    models: z.array(z.string().min(1)).default(() => []),
    voices: z.array(z.string().min(1)).default(() => []),
    characters: z.array(CanvasDependencyRefSchema).default(() => []),
    assets: z.array(CanvasDependencyRefSchema).default(() => []),
    recipes: z.array(z.string().min(1)).default(() => []),
  })
  .default(() => createEmptyCanvasDeps());
export type CanvasDeps = z.infer<typeof CanvasDepsSchema>;

export function createEmptyCanvasDeps(): CanvasDeps {
  return { models: [], voices: [], characters: [], assets: [], recipes: [] };
}

/** API/export shape assembled from the three authoritative database columns. */
export const CanvasDocumentEnvelopeSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  doc: CanvasDocSchema,
  deps: CanvasDepsSchema,
});
export type CanvasDocumentEnvelope = z.infer<typeof CanvasDocumentEnvelopeSchema>;

/** D3 owns the PATCH wire protocol; D2 only fixes the mandatory CAS primitive. */
export const CanvasRevisionSchema = z.number().int().nonnegative();
export type CanvasRevision = z.infer<typeof CanvasRevisionSchema>;

export function createCanvasId(prefix = "id"): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "id";
  return `${safePrefix}_${nanoid(12)}`;
}

export function createEmptyCanvasDoc(): CanvasDoc {
  return { nodes: [], edges: [], groups: [] };
}

export interface CreateCanvasNodeInput {
  id?: string;
  type?: CanvasNodeType;
  variant?: string;
  position?: Partial<CanvasPosition>;
  groupId?: string | null;
  data?: Partial<Omit<CanvasNodeData, "refs">> & { refs?: Partial<CanvasRefs> };
}

export function createCanvasNode(input: CreateCanvasNodeInput = {}): CanvasNode {
  const inputData = input.data ?? {};
  // 只在 optional 字段**有值**时写键——Zod `.optional()` 会保留显式 `undefined` 作为 own key,
  // 会污染 JSON round-trip(键被 JSON 静默删)并被 D4 strictJsonClone 正确拒绝。refs 各字段是
  // `.default(null)`,即便 spread 进 undefined 也会被 default 归一为 null,故无 own undefined。
  const data: Record<string, unknown> = {
    refs: { ...createCanvasRefs(), ...(inputData.refs ?? {}) },
  };
  if (inputData.title !== undefined) data.title = inputData.title;
  if (inputData.params !== undefined) data.params = inputData.params;
  if (inputData.media !== undefined) data.media = inputData.media;

  const raw: Record<string, unknown> = {
    id: input.id ?? createCanvasId("node"),
    type: input.type ?? "text",
    position: { x: input.position?.x ?? 0, y: input.position?.y ?? 0 },
    group_id: input.groupId ?? null,
    data,
  };
  if (input.variant !== undefined) raw.variant = input.variant;
  return CanvasNodeSchema.parse(raw);
}

export interface CreateCanvasEdgeInput {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function createCanvasEdge(input: CreateCanvasEdgeInput): CanvasEdge {
  return CanvasEdgeSchema.parse({
    id: input.id ?? createCanvasId("edge"),
    source: input.source,
    target: input.target,
    sourceHandle: input.sourceHandle ?? null,
    targetHandle: input.targetHandle ?? null,
  });
}

export interface CreateCanvasGroupInput {
  id?: string;
  label?: string;
  nodeIds?: string[];
}

export function createCanvasGroup(input: CreateCanvasGroupInput = {}): CanvasGroup {
  return CanvasGroupSchema.parse({
    id: input.id ?? createCanvasId("group"),
    label: input.label ?? "",
    node_ids: [...(input.nodeIds ?? [])],
  });
}

export function createCanvasDocumentEnvelope(
  doc: CanvasDoc = createEmptyCanvasDoc(),
  deps: CanvasDeps = createEmptyCanvasDeps(),
  schemaVersion = CANVAS_SCHEMA_VERSION
): CanvasDocumentEnvelope {
  return CanvasDocumentEnvelopeSchema.parse({ schemaVersion, doc, deps });
}

export interface CanvasSafetyIssue {
  path: string;
  message: string;
}

const SIGNED_QUERY_KEY =
  /(?:^|[?&])(?:ossaccesskeyid|signature|expires|x-oss-[a-z0-9-]+|x-amz-[a-z0-9-]+)=/i;
const EMBEDDED_DATA_URL = /data:[^,\s]{0,256},/i;

function isSignedStorageQueryName(value: string): boolean {
  const key = value.toLowerCase();
  return (
    key === "ossaccesskeyid" ||
    key === "signature" ||
    key === "expires" ||
    key.startsWith("x-oss-") ||
    key.startsWith("x-amz-")
  );
}

function containsSignedStorageQuery(value: string): boolean {
  if (SIGNED_QUERY_KEY.test(value)) return true;
  try {
    const parsed = new URL(value, "https://canvas.invalid");
    return Array.from(parsed.searchParams.keys()).some(isSignedStorageQueryName);
  } catch {
    return false;
  }
}

function unsafeStringReason(value: string): string | null {
  const trimmed = value.trim();
  if (/^data:/i.test(trimmed) || EMBEDDED_DATA_URL.test(trimmed)) return "禁止 dataURL 入库";
  if (containsSignedStorageQuery(trimmed)) return "禁止 OSS/对象存储签名 URL 入库";
  return null;
}

/** Recursively checks node data, including free-form params, without rejecting normal URLs/prompts. */
export function inspectUnsafeCanvasValue(value: unknown, rootPath = "data"): CanvasSafetyIssue[] {
  const issues: CanvasSafetyIssue[] = [];
  const ancestors = new WeakSet<object>();
  let visited = 0;

  const visit = (current: unknown, path: string, depth: number): void => {
    visited += 1;
    if (visited > 10_000) {
      if (!issues.some((issue) => issue.message.includes("10000"))) {
        issues.push({ path, message: "数据层级过大(超过 10000 个值)" });
      }
      return;
    }
    if (depth > 64) {
      issues.push({ path, message: "数据嵌套过深(>64)" });
      return;
    }
    if (typeof current === "string") {
      const message = unsafeStringReason(current);
      if (message) issues.push({ path, message });
      return;
    }
    if (!current || typeof current !== "object") return;

    if (ancestors.has(current)) {
      issues.push({ path, message: "数据含循环引用" });
      return;
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          try {
            visit(current[index], `${path}[${index}]`, depth + 1);
          } catch (error) {
            issues.push({ path: `${path}[${index}]`, message: `读取失败:${errorMessage(error)}` });
          }
        }
      } else {
        let keys: string[];
        try {
          keys = Object.keys(current);
        } catch (error) {
          issues.push({ path, message: `读取对象键失败:${errorMessage(error)}` });
          return;
        }
        for (const key of keys) {
          try {
            visit((current as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
          } catch (error) {
            issues.push({ path: `${path}.${key}`, message: `读取失败:${errorMessage(error)}` });
          }
        }
      }
    } finally {
      ancestors.delete(current);
    }
  };

  visit(value, rootPath, 0);
  return issues;
}

export interface ValidateResult<T> {
  ok: boolean;
  data: T | null;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

export function validateCanvasDoc(rawDoc: unknown): ValidateResult<CanvasDoc> {
  let parsed: ReturnType<typeof CanvasDocSchema.safeParse>;
  try {
    parsed = CanvasDocSchema.safeParse(rawDoc);
  } catch (error) {
    return { ok: false, data: null, errors: [`(root): 校验读取失败:${errorMessage(error)}`] };
  }
  if (!parsed.success) return { ok: false, data: null, errors: zodIssues(parsed.error) };

  const errors = parsed.data.nodes.flatMap((node, index) =>
    inspectUnsafeCanvasValue(node.data, `nodes.${index}.data`).map(
      (issue) => `${issue.path}: ${issue.message}`
    )
  );
  return errors.length
    ? { ok: false, data: null, errors }
    : { ok: true, data: parsed.data, errors: [] };
}

export function validateCanvasDocumentEnvelope(
  rawEnvelope: unknown
): ValidateResult<CanvasDocumentEnvelope> {
  let parsed: ReturnType<typeof CanvasDocumentEnvelopeSchema.safeParse>;
  try {
    parsed = CanvasDocumentEnvelopeSchema.safeParse(rawEnvelope);
  } catch (error) {
    return { ok: false, data: null, errors: [`(root): 校验读取失败:${errorMessage(error)}`] };
  }
  if (!parsed.success) return { ok: false, data: null, errors: zodIssues(parsed.error) };
  const docResult = validateCanvasDoc(parsed.data.doc);
  return docResult.ok
    ? { ok: true, data: parsed.data, errors: [] }
    : { ok: false, data: null, errors: docResult.errors.map((error) => `doc.${error}`) };
}

export interface CanvasMigration {
  from: number;
  to: number;
  migrate: (doc: unknown) => unknown;
}

export const CANVAS_MIGRATIONS: CanvasMigration[] = [];

export interface MigrateResult {
  doc: unknown;
  from: number;
  /** Actual version reached, never the requested version unless every step succeeded. */
  to: number;
  target: number;
  complete: boolean;
  notes: string[];
}

function cloneUnknown(value: unknown): unknown {
  try {
    if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  } catch {
    // Fall through to JSON clone.
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function migrateDoc(
  rawDoc: unknown,
  fromVersion: number = CANVAS_SCHEMA_VERSION,
  toVersion: number = CANVAS_SCHEMA_VERSION,
  migrations: CanvasMigration[] = CANVAS_MIGRATIONS
): MigrateResult {
  const target = Number.isInteger(toVersion) && toVersion > 0 ? toVersion : CANVAS_SCHEMA_VERSION;
  const notes: string[] = [];
  if (!Number.isInteger(fromVersion) || fromVersion <= 0) {
    notes.push(`schema_version 缺失/非法(${String(fromVersion)}),无法证明迁移完成`);
    return {
      doc: cloneUnknown(rawDoc),
      from: target,
      to: target,
      target,
      complete: false,
      notes,
    };
  }

  const from = fromVersion;
  let current = from;
  let doc = cloneUnknown(rawDoc);

  if (from > target) {
    notes.push(`文档版本 v${from} 高于运行时 v${target},禁止伪降级`);
    return { doc, from, to: from, target, complete: false, notes };
  }
  if (from === target) return { doc, from, to: from, target, complete: true, notes };

  while (current < target) {
    const step = migrations.find(
      (candidate) => candidate.from === current && candidate.to === current + 1
    );
    if (!step) {
      notes.push(`缺 v${current}→v${current + 1} 迁移,停止在 v${current}`);
      return { doc, from, to: current, target, complete: false, notes };
    }
    try {
      doc = step.migrate(cloneUnknown(doc));
    } catch (error) {
      notes.push(`v${current}→v${current + 1} 迁移失败(${errorMessage(error)}),停止在 v${current}`);
      return { doc, from, to: current, target, complete: false, notes };
    }
    current += 1;
  }

  return { doc, from, to: current, target, complete: true, notes };
}

export interface BrokenCanvasNode {
  id: string;
  position: CanvasPosition | null;
  group_id: string | null;
  rawType: unknown;
  issues: string[];
  raw: unknown;
}

export interface BrokenCanvasEdge {
  id: string;
  issues: string[];
  raw: unknown;
}

export interface LoadCanvasResult {
  nodes: CanvasNode[];
  brokenNodes: BrokenCanvasNode[];
  edges: CanvasEdge[];
  brokenEdges: BrokenCanvasEdge[];
  groups: CanvasGroup[];
  schemaVersion: number;
  migratedFrom: number;
  targetSchemaVersion: number;
  migrationComplete: boolean;
  /** Shell must block autosave until broken entities/migration issues are resolved explicitly. */
  recoveryRequired: boolean;
  issues: string[];
}

type SafeParseResult<T> = { success: true; data: T } | { success: false; issues: string[] };

function safeSchemaParse<T>(schema: z.ZodType<T>, value: unknown): SafeParseResult<T> {
  try {
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { success: true, data: parsed.data }
      : { success: false, issues: zodIssues(parsed.error) };
  } catch (error) {
    return { success: false, issues: [`读取/校验失败:${errorMessage(error)}`] };
  }
}

function safeRead(value: unknown, key: string): unknown {
  try {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

function safeStringProperty(value: unknown, key: string): string | null {
  const candidate = safeRead(value, key);
  return typeof candidate === "string" ? candidate : null;
}

function bestEffortPosition(raw: unknown): CanvasPosition | null {
  const position = safeRead(raw, "position");
  const x = safeRead(position, "x");
  const y = safeRead(position, "y");
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y }
    : null;
}

function safeArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  try {
    return Array.from(value);
  } catch {
    return [];
  }
}

function allocateSafeId(candidate: string | null, prefix: string, used: Set<string>): string {
  if (candidate && CanvasIdSchema.safeParse(candidate).success && !used.has(candidate)) return candidate;
  let id = createCanvasId(prefix);
  while (used.has(id)) id = createCanvasId(prefix);
  return id;
}

function emptyLoadResult(fromVersion: number, issue: string): LoadCanvasResult {
  const version = Number.isInteger(fromVersion) && fromVersion > 0 ? fromVersion : CANVAS_SCHEMA_VERSION;
  return {
    nodes: [],
    brokenNodes: [],
    edges: [],
    brokenEdges: [],
    groups: [],
    schemaVersion: version,
    migratedFrom: version,
    targetSchemaVersion: CANVAS_SCHEMA_VERSION,
    migrationComplete: false,
    recoveryRequired: true,
    issues: [issue],
  };
}

function loadCanvasDocInternal(rawDoc: unknown, fromVersion: number): LoadCanvasResult {
  const migrated = migrateDoc(rawDoc, fromVersion, CANVAS_SCHEMA_VERSION);
  const issues = [...migrated.notes];
  const root = migrated.doc && typeof migrated.doc === "object" ? migrated.doc : {};
  if (root !== migrated.doc) issues.push("doc 根不是对象,按空画布打开");

  const nodesValue = safeRead(root, "nodes");
  const edgesValue = safeRead(root, "edges");
  const groupsValue = safeRead(root, "groups");
  if (!Array.isArray(nodesValue)) issues.push("doc.nodes 不是数组,按空处理");
  if (!Array.isArray(edgesValue)) issues.push("doc.edges 不是数组,按空处理");
  if (!Array.isArray(groupsValue)) issues.push("doc.groups 不是数组,按空处理");

  const rawNodes = safeArray(nodesValue);
  const rawEdges = safeArray(edgesValue);
  const rawGroups = safeArray(groupsValue);
  const nodes: CanvasNode[] = [];
  const brokenNodes: BrokenCanvasNode[] = [];
  const presentIds = new Set<string>();
  const usedNodeIds = new Set<string>();
  const rawNodeIdMap = new Map<string, string>();

  rawNodes.forEach((raw, index) => {
    const parsed = safeSchemaParse(CanvasNodeSchema, raw);
    const rawId = safeStringProperty(raw, "id");
    const unsafeIssues = parsed.success
      ? inspectUnsafeCanvasValue(parsed.data.data).map(
          (issue) => `${issue.path}: ${issue.message}`
        )
      : [];
    const duplicate = parsed.success && usedNodeIds.has(parsed.data.id);
    if (parsed.success && !duplicate && unsafeIssues.length === 0) {
      nodes.push(parsed.data);
      usedNodeIds.add(parsed.data.id);
      presentIds.add(parsed.data.id);
      if (!rawNodeIdMap.has(parsed.data.id)) rawNodeIdMap.set(parsed.data.id, parsed.data.id);
      return;
    }

    const id = allocateSafeId(rawId, "broken", usedNodeIds);
    usedNodeIds.add(id);
    presentIds.add(id);
    if (rawId && !rawNodeIdMap.has(rawId)) rawNodeIdMap.set(rawId, id);
    const rawGroupId = safeStringProperty(raw, "group_id");
    brokenNodes.push({
      id,
      position: bestEffortPosition(raw),
      group_id:
        rawGroupId && CanvasIdSchema.safeParse(rawGroupId).success ? rawGroupId : null,
      rawType: safeRead(raw, "type"),
      issues: parsed.success
        ? [...(duplicate ? [`节点 id 重复:${parsed.data.id}`] : []), ...unsafeIssues]
        : parsed.issues,
      raw,
    });
    if (!rawId) issues.push(`nodes[${index}] 缺少可用 id,已分配 ${id}`);
  });

  const edges: CanvasEdge[] = [];
  const brokenEdges: BrokenCanvasEdge[] = [];
  const usedEdgeIds = new Set<string>();
  rawEdges.forEach((raw) => {
    const parsed = safeSchemaParse(CanvasEdgeSchema, raw);
    const rawId = safeStringProperty(raw, "id");
    if (!parsed.success) {
      const id = allocateSafeId(rawId, "broken_edge", usedEdgeIds);
      usedEdgeIds.add(id);
      brokenEdges.push({ id, issues: parsed.issues, raw });
      return;
    }
    const edge = {
      ...parsed.data,
      source: rawNodeIdMap.get(parsed.data.source) ?? parsed.data.source,
      target: rawNodeIdMap.get(parsed.data.target) ?? parsed.data.target,
    };
    if (usedEdgeIds.has(edge.id)) {
      const id = allocateSafeId(null, "broken_edge", usedEdgeIds);
      usedEdgeIds.add(id);
      brokenEdges.push({ id, issues: [`连线 id 重复:${edge.id}`], raw });
      return;
    }
    usedEdgeIds.add(edge.id);
    if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) {
      brokenEdges.push({ id: edge.id, issues: ["连线端点不存在(悬空)"], raw });
      return;
    }
    edges.push(edge);
  });

  const parsedGroups: CanvasGroup[] = [];
  const usedGroupIds = new Set<string>();
  rawGroups.forEach((raw) => {
    const parsed = safeSchemaParse(CanvasGroupSchema, raw);
    if (!parsed.success) {
      issues.push(`丢弃非法成组:${parsed.issues.join("; ")}`);
      return;
    }
    if (usedGroupIds.has(parsed.data.id)) {
      issues.push(`丢弃重复成组 id:${parsed.data.id}`);
      return;
    }
    usedGroupIds.add(parsed.data.id);
    const members: string[] = [];
    const seen = new Set<string>();
    parsed.data.node_ids.forEach((rawNodeId) => {
      const nodeId = rawNodeIdMap.get(rawNodeId) ?? rawNodeId;
      if (!presentIds.has(nodeId)) {
        issues.push(`成组 ${parsed.data.id} 丢弃悬空成员:${rawNodeId}`);
      } else if (seen.has(nodeId)) {
        issues.push(`成组 ${parsed.data.id} 去重成员:${nodeId}`);
      } else {
        seen.add(nodeId);
        members.push(nodeId);
      }
    });
    parsedGroups.push({ ...parsed.data, node_ids: members });
  });

  const groupById = new Map(parsedGroups.map((group) => [group.id, group]));
  const assignment = new Map<string, string>();
  const seedAssignment = (nodeId: string, groupId: string | null): void => {
    if (!groupId) return;
    if (!groupById.has(groupId)) {
      issues.push(`节点 ${nodeId} 清除不存在的 group_id:${groupId}`);
      return;
    }
    assignment.set(nodeId, groupId);
  };
  nodes.forEach((node) => seedAssignment(node.id, node.group_id));
  brokenNodes.forEach((node) => seedAssignment(node.id, node.group_id));

  parsedGroups.forEach((group) => {
    group.node_ids.forEach((nodeId) => {
      const current = assignment.get(nodeId);
      if (!current) {
        assignment.set(nodeId, group.id);
        issues.push(`节点 ${nodeId} 从 group.node_ids 修复 group_id=${group.id}`);
      } else if (current !== group.id) {
        issues.push(`节点 ${nodeId} 成组冲突:${current} 优先,忽略 ${group.id}`);
      }
    });
  });

  const normalizedNodes = nodes.map((node) => ({
    ...node,
    group_id: assignment.get(node.id) ?? null,
  }));
  const normalizedBrokenNodes = brokenNodes.map((node) => ({
    ...node,
    group_id: assignment.get(node.id) ?? null,
  }));
  const groups = parsedGroups.map((group) => {
    const ordered = group.node_ids.filter((nodeId) => assignment.get(nodeId) === group.id);
    assignment.forEach((groupId, nodeId) => {
      if (groupId === group.id && !ordered.includes(nodeId)) ordered.push(nodeId);
    });
    return { ...group, node_ids: ordered };
  });

  return {
    nodes: normalizedNodes,
    brokenNodes: normalizedBrokenNodes,
    edges,
    brokenEdges,
    groups,
    schemaVersion: migrated.to,
    migratedFrom: migrated.from,
    targetSchemaVersion: migrated.target,
    migrationComplete: migrated.complete,
    recoveryRequired:
      !migrated.complete || normalizedBrokenNodes.length > 0 || brokenEdges.length > 0,
    issues,
  };
}

/** Tolerant read path. It never throws; bad entities are isolated for placeholder UI. */
export function loadCanvasDoc(
  rawDoc: unknown,
  fromVersion: number = CANVAS_SCHEMA_VERSION
): LoadCanvasResult {
  try {
    return loadCanvasDocInternal(rawDoc, fromVersion);
  } catch (error) {
    return emptyLoadResult(fromVersion, `画布容错加载失败,按空画布打开:${errorMessage(error)}`);
  }
}
