import { basename, isAbsolute, resolve as resolvePathName } from 'node:path';

/**
 * Authenticated download route for files a Turn delivered or changed.
 *
 * The browser only knows the coordinate the delivery/review card already
 * carries (Session, announcing event sequence, file index). The Host resolves
 * that coordinate back to the file path from the Session log, confines the
 * resolved file to the configured workspace root, then streams the current
 * bytes with an attachment disposition. No file path crosses the wire.
 */

const ROUTE_PATH = '/api/cloud.download';
const CHUNK_BYTES = 1024 * 1024;

const MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  yml: 'application/yaml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const inject = [
  'connection',
  'fs',
  'sandboxPolicy',
  'sessionQuery',
  'workspaceFiles',
  'workspaceChanges',
] as const;

declare const fsTargetBrand: unique symbol;

/** Opaque filesystem target returned by the Host fs service. */
export type FsTarget = { readonly [fsTargetBrand]: true };

export interface FsStat {
  readonly type: string;
  readonly size?: number;
  readonly version?: string;
}

export interface FsService {
  resolve(path: string, options?: { readonly cwd?: string; readonly signal?: AbortSignal }): Promise<FsTarget>;
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsStat | undefined>;
  readByteRange(
    target: FsTarget,
    range: { readonly offset: number; readonly length: number },
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  contains(parent: FsTarget, child: FsTarget): boolean;
}

export interface WorkspaceFileStat {
  readonly absolutePath: string;
  readonly version: string;
  readonly bytes?: number;
}

export interface WorkspaceFilesService {
  stat(
    scope: { readonly sessionId: string; readonly workspaceRoot: string },
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileStat>;
}

export interface PresentedFile {
  readonly path: string;
  readonly description?: string;
}

export interface PresentedData {
  readonly turn: number;
  readonly callId: string;
  readonly files: readonly unknown[];
}

export interface SessionEvent {
  readonly type: string;
  readonly data?: unknown;
}

export interface SessionHeader {
  readonly id: string;
  readonly cwd?: string;
}

export interface SessionEventWindow {
  readonly session: SessionHeader;
  readonly target: SessionEvent;
}

export interface SessionQueryService {
  readEvent(
    request: { readonly sessionId: string; readonly seq: number; readonly before: number; readonly after: number },
    signal?: AbortSignal,
  ): Promise<SessionEventWindow>;
}

export interface WorkspaceChangedFile {
  readonly path: string;
}

export interface WorkspaceChangesSummary {
  readonly cwd: string;
  readonly files: readonly WorkspaceChangedFile[];
}

export interface WorkspaceChangesService {
  summary(sessionId: string, seq: number): WorkspaceChangesSummary | undefined;
}

export interface SandboxPolicyService {
  readonly workspaceRoot: string;
}

export interface FetchRoute {
  readonly path: string;
  readonly methods: readonly ('GET' | 'HEAD')[];
  readonly requestBody: 'buffered';
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface FetchRegistry {
  register(route: FetchRoute): () => void;
}

export interface DownloadContext {
  readonly connection: { readonly fetch: FetchRegistry };
  readonly fs: FsService;
  readonly sandboxPolicy: SandboxPolicyService;
  readonly sessionQuery: SessionQueryService;
  readonly workspaceFiles: WorkspaceFilesService;
  readonly workspaceChanges: WorkspaceChangesService;
  readonly logger?: { warn?(message: string): void };
}

export interface EffectContext {
  effect(callback: () => void | (() => void), label?: string): void;
}

export type DownloadHostContext = DownloadContext & EffectContext;

interface ResolvedFile {
  readonly absolutePath: string;
  readonly target: FsTarget;
}

class DownloadFailure extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DownloadFailure';
    this.status = status;
  }
}

function contentTypeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const extension = name.slice(dot + 1).toLowerCase();
  return MIME[extension] ?? 'application/octet-stream';
}

/** RFC 5987 attachment header with an ASCII fallback. */
function disposition(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, '_');
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_') || 'download';
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function coordinate(value: string | null): number | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;
}

function isPresentedFile(value: unknown): value is PresentedFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { path, description } = value as { path?: unknown; description?: unknown };
  return typeof path === 'string'
    && path.trim().length > 0
    && (description === undefined || typeof description === 'string');
}

function isPresentedData(value: unknown): value is PresentedData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { turn, callId, files } = value as { turn?: unknown; callId?: unknown; files?: unknown };
  return typeof turn === 'number'
    && Number.isSafeInteger(turn)
    && turn >= 1
    && typeof callId === 'string'
    && callId.length > 0
    && Array.isArray(files);
}

function failure(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function statusOf(error: unknown): number {
  if (error instanceof DownloadFailure) return error.status;
  const code = typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
  switch (code) {
    case 'FS_NOT_FOUND':
    case 'SESSION_QUERY_SESSION_NOT_FOUND':
    case 'SESSION_QUERY_EVENT_NOT_FOUND':
    case 'ENOENT':
    case 'ENOTDIR':
      return 404;
    case 'FS_NOT_REGULAR_FILE':
    case 'FS_PERMISSION_DENIED':
    case 'FS_SANDBOX_DENIED':
    case 'workspace-file/outside-workspace':
    case 'WORKSPACE_FILE_OUTSIDE_WORKSPACE':
      return 403;
    case 'FS_ABORTED':
      return 499;
    default:
      return 500;
  }
}

/**
 * Resolve one file and refuse it unless the configured workspace contains it.
 *
 * `workspaceFiles.stat` intentionally accepts absolute paths and paths outside
 * a Session's cwd (for example repository changes above a nested cwd). The
 * download route is narrower than that capability: a browser must not be able
 * to turn a crafted presented/changed event into an arbitrary file read.
 */
async function assertInsideWorkspace(
  ctx: DownloadContext,
  absolutePath: string,
  signal: AbortSignal,
): Promise<FsTarget> {
  const workspaceRoot = ctx.sandboxPolicy.workspaceRoot;
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new DownloadFailure(403, 'No workspace root is configured.');
  }
  const root = await ctx.fs.resolve(workspaceRoot, { signal });
  const target = await ctx.fs.resolve(absolutePath, { signal });
  if (!ctx.fs.contains(root, target)) {
    throw new DownloadFailure(403, 'File outside the workspace.');
  }
  return target;
}

/**
 * Reject an obviously outside candidate before asking the workspace file
 * service to touch it. This keeps a crafted event from using existence/timing
 * differences to probe paths outside the workspace; the post-stat check below
 * still catches symlinks that resolve outside.
 */
async function assertCandidateInsideWorkspace(
  ctx: DownloadContext,
  baseDirectory: string,
  path: string,
  signal: AbortSignal,
): Promise<void> {
  const candidate = isAbsolute(path) ? path : resolvePathName(baseDirectory, path);
  await assertInsideWorkspace(ctx, candidate, signal);
}

async function confineToWorkspace(
  ctx: DownloadContext,
  absolutePath: string,
  signal: AbortSignal,
): Promise<ResolvedFile> {
  const target = await assertInsideWorkspace(ctx, absolutePath, signal);
  return { absolutePath, target };
}

/** Resolve the delivered or changed file path from the Session log. */
async function resolvePath(
  ctx: DownloadContext,
  request: Request,
  sessionId: string,
  seq: number,
  index: number,
  kind: 'changes' | 'present',
): Promise<ResolvedFile> {
  const signal = request.signal;

  // Verify the event belongs to the requested Session before either branch
  // consults a Session-keyed secondary service. This is the cross-Session
  // boundary: a caller-supplied id must never select another Session's data.
  const read = await ctx.sessionQuery.readEvent({ sessionId, seq, before: 0, after: 0 }, signal);
  if (read.session.id !== sessionId) {
    throw new DownloadFailure(404, 'File not found in this Session.');
  }

  if (kind === 'changes') {
    const summary = ctx.workspaceChanges.summary(sessionId, seq);
    if (summary === undefined) throw new DownloadFailure(404, 'File not found in this Session.');
    const file = summary.files[index];
    if (file === undefined) throw new DownloadFailure(404, 'File not found in this Session.');
    const base = summary.cwd || read.session.cwd || ctx.sandboxPolicy.workspaceRoot;
    await assertCandidateInsideWorkspace(ctx, base, file.path, signal);
    const stat = await ctx.workspaceFiles.stat({ sessionId, workspaceRoot: base }, file.path, signal);
    return confineToWorkspace(ctx, stat.absolutePath, signal);
  }

  const event = read.target;
  if (event.type !== 'deliverables/presented' || !isPresentedData(event.data)) {
    throw new DownloadFailure(404, 'File not found in this Session.');
  }
  const file = event.data.files[index];
  if (!isPresentedFile(file)) throw new DownloadFailure(404, 'File not found in this Session.');
  const base = read.session.cwd || ctx.sandboxPolicy.workspaceRoot;
  await assertCandidateInsideWorkspace(ctx, base, file.path, signal);
  const stat = await ctx.workspaceFiles.stat({ sessionId, workspaceRoot: base }, file.path, signal);
  return confineToWorkspace(ctx, stat.absolutePath, signal);
}

async function streamFile(
  ctx: DownloadContext,
  request: Request,
  resolved: ResolvedFile,
): Promise<Response> {
  const info = await ctx.fs.stat(resolved.target, request.signal);
  if (info === undefined || info.type !== 'file') return failure(404, 'File not found.');

  const name = basename(resolved.absolutePath);
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypeOf(name),
    'Content-Disposition': disposition(name),
    'X-Content-Type-Options': 'nosniff',
  };
  if (info.size !== undefined) headers['Content-Length'] = String(info.size);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  let offset = 0;
  const total = info.size;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await ctx.fs.readByteRange(
          resolved.target,
          { offset, length: CHUNK_BYTES },
          request.signal,
        );
        if (chunk.byteLength === 0) {
          controller.close();
          return;
        }
        offset += chunk.byteLength;
        controller.enqueue(chunk);
        if (total !== undefined ? offset >= total : chunk.byteLength < CHUNK_BYTES) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {},
  }, {
    highWaterMark: 4,
    size: (chunk) => chunk.byteLength,
  });
  return new Response(stream, { status: 200, headers });
}

/** Resolve one authenticated download request into a streaming response. */
export async function handle(ctx: DownloadContext, request: Request): Promise<Response> {
  try {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const query = new URL(request.url).searchParams;

    const sessionId = query.get('sessionId');
    const seq = coordinate(query.get('seq'));
    const index = coordinate(query.get('index'));
    const kind = query.get('kind') === 'changes' ? 'changes' : 'present';
    if (!sessionId || seq === undefined || index === undefined) {
      return failure(400, 'Missing download coordinates.');
    }

    const resolved = await resolvePath(ctx, request, sessionId, seq, index, kind);
    return await streamFile(ctx, request, resolved);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    ctx.logger?.warn?.(
      `cloud download failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return failure(
      statusOf(error),
      error instanceof DownloadFailure ? error.message : 'Download unavailable.',
    );
  }
}

export function apply(ctx: DownloadHostContext): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: (request) => handle(ctx, request),
  }), 'cloud-download: download route');
}
