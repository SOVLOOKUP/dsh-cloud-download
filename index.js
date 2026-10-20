import { basename } from 'node:path';

/**
 * Authenticated download route for files a Turn delivered or changed.
 *
 * The browser only knows the coordinate the delivery/review card already
 * carries (Session, announcing event sequence, file index). The Host resolves
 * that coordinate back to the file path from the Session log, then streams the
 * current bytes with an attachment disposition. No file path crosses the wire.
 */

const ROUTE_PATH = '/api/cloud.download';
const CHUNK_BYTES = 1024 * 1024;

const MIME = {
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
];

function contentTypeOf(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** RFC 5987 attachment header with an ASCII fallback. */
function disposition(name) {
  const cleaned = name.replace(/[\r\n"]/g, '_');
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_') || 'download';
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function coordinate(value) {
  return typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

function isPresentedFile(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { path, description } = value;
  return typeof path === 'string' && path.trim().length > 0 && (description === undefined || typeof description === 'string');
}

function isPresentedData(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { turn, callId, files } = value;
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 1
    && typeof callId === 'string' && callId.length > 0
    && Array.isArray(files);
}

function failure(status, message) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function statusOf(error) {
  const code = typeof error === 'object' && error !== null ? error.code : undefined;
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
      return 403;
    case 'FS_ABORTED':
      return 499;
    default:
      return 500;
  }
}

/** Resolve the delivered or changed file path from the Session log. */
async function resolvePath(ctx, request, sessionId, seq, index, kind) {
  const signal = request.signal;
  if (kind === 'changes') {
    const summary = ctx.workspaceChanges.summary(sessionId, seq);
    if (summary === undefined) return undefined;
    const file = summary.files[index];
    if (file === undefined) return undefined;
    const stat = await ctx.workspaceFiles.stat({
      sessionId,
      workspaceRoot: summary.cwd ?? ctx.sandboxPolicy.workspaceRoot,
    }, file.path, signal);
    return stat.absolutePath;
  }

  const read = await ctx.sessionQuery.readEvent({ sessionId, seq, before: 0, after: 0 }, signal);
  const event = read.target;
  if (event.type !== 'deliverables/presented' || !isPresentedData(event.data)) return undefined;
  const file = event.data.files[index];
  if (!isPresentedFile(file)) return undefined;
  const stat = await ctx.workspaceFiles.stat({
    sessionId,
    workspaceRoot: read.session.cwd ?? ctx.sandboxPolicy.workspaceRoot,
  }, file.path, signal);
  return stat.absolutePath;
}

async function streamFile(ctx, request, absolutePath) {
  const target = await ctx.fs.resolve(absolutePath, { signal: request.signal });
  const info = await ctx.fs.stat(target, request.signal);
  if (info === undefined || info.type !== 'file') return failure(404, 'File not found.');

  const name = basename(absolutePath);
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypeOf(name),
    'Content-Disposition': disposition(name),
    'X-Content-Type-Options': 'nosniff',
  };
  if (info.size !== undefined) headers['Content-Length'] = String(info.size);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  let offset = 0;
  const total = info.size;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await ctx.fs.readByteRange(target, { offset, length: CHUNK_BYTES }, request.signal);
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

async function handle(ctx, request) {
  try {
    request.signal.throwIfAborted();
    const query = new URL(request.url).searchParams;

    const sessionId = query.get('sessionId');
    const seq = coordinate(query.get('seq'));
    const index = coordinate(query.get('index'));
    const kind = query.get('kind') === 'changes' ? 'changes' : 'present';
    if (!sessionId || seq === undefined || index === undefined) return failure(400, 'Missing download coordinates.');

    const absolutePath = await resolvePath(ctx, request, sessionId, seq, index, kind);
    if (absolutePath === undefined) return failure(404, 'File not found in this Session.');
    return await streamFile(ctx, request, absolutePath);
  } catch (error) {
    request.signal.throwIfAborted();
    ctx.logger?.warn?.(`cloud download failed: ${error instanceof Error ? error.message : String(error)}`);
    return failure(statusOf(error), 'Download unavailable.');
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: (request) => handle(ctx, request),
  }), 'cloud-download: download route');
}
