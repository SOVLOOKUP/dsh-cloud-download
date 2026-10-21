import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import {
  apply,
  handle,
  type DownloadContext,
  type FetchRoute,
  type FsStat,
  type FsTarget,
  type SessionEventWindow,
  type WorkspaceChangesSummary,
  type WorkspaceFileStat,
} from '../src/index.js';

const WORKSPACE = '/workspace/project';

function fsTarget(path: string): FsTarget {
  return { path } as unknown as FsTarget;
}

function targetPath(target: FsTarget): string {
  return (target as unknown as { readonly path: string }).path;
}

function presentedEvent(
  files: readonly unknown[],
  sessionId = 'session-a',
  cwd = WORKSPACE,
): SessionEventWindow {
  return {
    session: { id: sessionId, cwd },
    target: {
      type: 'deliverables/presented',
      data: { turn: 1, callId: 'call-1', files },
    },
  };
}

interface FakeOptions {
  readonly event?: SessionEventWindow;
  readonly readError?: unknown;
  readonly summary?: WorkspaceChangesSummary;
  readonly content?: string;
  /** Force the workspace file service to report a different canonical path. */
  readonly absolutePath?: string;
}

class FakeHost {
  readonly routes: FetchRoute[] = [];
  readonly reads: string[] = [];
  readonly warnings: string[] = [];
  readonly workspaceStatCalls: Array<{ readonly path: string; readonly workspaceRoot: string }> = [];
  fsStatCalls = 0;

  readonly ctx: DownloadContext;

  constructor(options: FakeOptions = {}) {
    const content = new TextEncoder().encode(options.content ?? 'hello');

    this.ctx = {
      connection: {
        fetch: {
          register: (route) => {
            this.routes.push(route);
            return () => {};
          },
        },
      },
      sandboxPolicy: { workspaceRoot: WORKSPACE },
      logger: {
        warn: (message) => {
          this.warnings.push(message);
        },
      },
      sessionQuery: {
        readEvent: async () => {
          if (options.readError !== undefined) throw options.readError;
          return options.event ?? presentedEvent([{ path: 'out/report.txt' }]);
        },
      },
      workspaceChanges: {
        summary: () => options.summary,
      },
      workspaceFiles: {
        stat: async (scope, path): Promise<WorkspaceFileStat> => {
          this.workspaceStatCalls.push({ path, workspaceRoot: scope.workspaceRoot });
          return {
            absolutePath: options.absolutePath ?? posix.resolve(scope.workspaceRoot, path),
            version: 'v1',
            bytes: content.byteLength,
          };
        },
      },
      fs: {
        resolve: async (path): Promise<FsTarget> => fsTarget(posix.normalize(path)),
        stat: async (): Promise<FsStat> => {
          this.fsStatCalls += 1;
          return { type: 'file', size: content.byteLength, version: 'v1' };
        },
        readByteRange: async (target, range): Promise<Uint8Array> => {
          this.reads.push(targetPath(target));
          return content.slice(range.offset, range.offset + range.length);
        },
        contains: (parent, child): boolean => {
          const root = targetPath(parent).replace(/\/+$/g, '');
          const target = targetPath(child).replace(/\/+$/g, '');
          return target === root || target.startsWith(`${root}/`);
        },
      },
    };
  }
}

function downloadUrl(params: Readonly<Record<string, string>>): string {
  return `http://localhost/api/cloud.download?${new URLSearchParams(params).toString()}`;
}

function request(
  params: Readonly<Record<string, string>>,
  method: 'GET' | 'HEAD' = 'GET',
): Request {
  return new Request(downloadUrl(params), { method });
}

const baseParams = {
  sessionId: 'session-a',
  seq: '3',
  index: '0',
};

test('rejects a presented relative path that escapes the workspace', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: '../../etc/passwd' }]),
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'File outside the workspace.');
  assert.equal(host.workspaceStatCalls.length, 0);
  assert.equal(host.fsStatCalls, 0);
  assert.deepEqual(host.reads, []);
});

test('rejects a presented absolute path outside the workspace', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: '/etc/passwd' }]),
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'File outside the workspace.');
  assert.equal(host.workspaceStatCalls.length, 0);
  assert.equal(host.fsStatCalls, 0);
  assert.deepEqual(host.reads, []);
});

test('rejects a changed file outside the workspace', async () => {
  const host = new FakeHost({
    summary: {
      cwd: WORKSPACE,
      files: [{ path: '../../etc/passwd' }],
    },
  });

  const response = await handle(host.ctx, request({ ...baseParams, kind: 'changes' }));

  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'File outside the workspace.');
  assert.equal(host.workspaceStatCalls.length, 0);
  assert.equal(host.fsStatCalls, 0);
  assert.deepEqual(host.reads, []);
});

test('does not treat a sibling prefix as inside the workspace', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: '/workspace/project-evil/secret.txt' }]),
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'File outside the workspace.');
  assert.equal(host.fsStatCalls, 0);
});

test('rejects a symlink target that resolves outside the workspace', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: 'out/link' }]),
    absolutePath: '/etc/passwd',
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'File outside the workspace.');
  assert.equal(host.workspaceStatCalls.length, 1);
  assert.equal(host.fsStatCalls, 0);
  assert.deepEqual(host.reads, []);
});

test('rejects a session window whose header belongs to another Session', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: 'out/report.txt' }], 'session-b'),
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'File not found in this Session.');
  assert.equal(host.workspaceStatCalls.length, 0);
  assert.equal(host.fsStatCalls, 0);
});

test('rejects a changed-file summary for another Session', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: 'out/report.txt' }], 'session-b'),
    summary: {
      cwd: WORKSPACE,
      files: [{ path: 'out/report.txt' }],
    },
  });

  const response = await handle(host.ctx, request({ ...baseParams, kind: 'changes' }));

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'File not found in this Session.');
  assert.equal(host.workspaceStatCalls.length, 0);
  assert.equal(host.fsStatCalls, 0);
});

test('maps an event sequence from another Session to 404', async () => {
  const host = new FakeHost({
    readError: Object.assign(new Error('no event at seq 3'), {
      code: 'SESSION_QUERY_EVENT_NOT_FOUND',
    }),
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Download unavailable.');
  assert.equal(host.workspaceStatCalls.length, 0);
  assert.equal(host.fsStatCalls, 0);
});

test('streams a workspace file normally', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: 'out/report.txt' }]),
    content: 'workspace bytes',
  });

  const response = await handle(host.ctx, request(baseParams));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(response.headers.get('content-disposition') ?? '', /report\.txt/);
  assert.equal(await response.text(), 'workspace bytes');
  assert.deepEqual(host.reads, ['/workspace/project/out/report.txt']);
});

test('streams a changed file inside the workspace', async () => {
  const host = new FakeHost({
    summary: {
      cwd: WORKSPACE,
      files: [{ path: 'out/report.txt' }],
    },
    content: 'changed bytes',
  });

  const response = await handle(host.ctx, request({ ...baseParams, kind: 'changes' }));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'changed bytes');
  assert.equal(host.workspaceStatCalls.length, 1);
  assert.equal(host.workspaceStatCalls[0]?.workspaceRoot, WORKSPACE);
  assert.deepEqual(host.reads, ['/workspace/project/out/report.txt']);
});

test('registers one GET/HEAD download route', () => {
  const host = new FakeHost();
  let dispose: (() => void) | undefined;

  apply({
    ...host.ctx,
    effect: (callback) => {
      const result = callback();
      dispose = typeof result === 'function' ? result : undefined;
    },
  });

  assert.equal(host.routes.length, 1);
  assert.equal(host.routes[0]?.path, '/api/cloud.download');
  assert.deepEqual(host.routes[0]?.methods, ['GET', 'HEAD']);
  assert.equal(host.routes[0]?.requestBody, 'buffered');
  dispose?.();
});

test('HEAD reports metadata without opening the file', async () => {
  const host = new FakeHost({
    event: presentedEvent([{ path: 'out/report.txt' }]),
    content: 'workspace bytes',
  });

  const response = await handle(host.ctx, request(baseParams, 'HEAD'));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '15');
  assert.equal(await response.text(), '');
  assert.equal(host.fsStatCalls, 1);
  assert.deepEqual(host.reads, []);
});
