// @ts-nocheck
/**
 * Worker 1 — Developer Agent (Node-only).
 * Proposes local codebase reads/edits. Writes never run until the Supervisor
 * approval node receives OK by email.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());

const BLOCKED_PATH_RE =
  /(^|[\\/])(\.env($|\.)|node_modules|[\\/]\.git([\\/]|$)|google-services\.json|GoogleService-Info|serviceAccount|keystore|\.jks$|\.keystore$|\.pem$|\.p12$)/i;

const MAX_READ_BYTES = 80_000;
const MAX_WRITE_BYTES = 200_000;

function resolveProjectPath(relativePath) {
  const cleaned = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!cleaned || cleaned.includes('\0')) {
    throw new Error('Invalid file path');
  }
  const resolved = path.resolve(PROJECT_ROOT, cleaned);
  const rootWithSep = PROJECT_ROOT.endsWith(path.sep)
    ? PROJECT_ROOT
    : PROJECT_ROOT + path.sep;
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('Path is outside the Miras project');
  }
  if (BLOCKED_PATH_RE.test(resolved) || BLOCKED_PATH_RE.test(cleaned)) {
    throw new Error('Blocked path (secrets, vendor, or VCS)');
  }
  return { resolved, relative: path.relative(PROJECT_ROOT, resolved).replace(/\\/g, '/') };
}

function stripFence(raw) {
  return String(raw || '')
    .replace(/^```[\w.-]*\s*/i, '')
    .replace(/\s*```$/i, '');
}

function parseWriteBlocks(task) {
  const files = [];
  const text = String(task || '');
  const fence = /write\s+(\S+)\s*```(?:[\w.-]*)\r?\n?([\s\S]*?)```/gi;
  let match;
  while ((match = fence.exec(text))) {
    files.push({ path: match[1].trim(), content: match[2] });
  }
  if (!files.length) {
    const simple = text.match(/\bwrite\s+(\S+)\s+([\s\S]+)/i);
    if (simple) {
      files.push({ path: simple[1].trim(), content: stripFence(simple[2].trim()) });
    }
  }
  return files;
}

function parseReadTargets(task) {
  const targets = [];
  const re = /\b(?:read|open|cat|show)\s+([^\s\n]+)/gi;
  let match;
  while ((match = re.exec(task))) {
    targets.push(match[1].trim());
  }
  return targets;
}

async function readFileSafe(relativePath) {
  const { resolved, relative } = resolveProjectPath(relativePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`${relative} is not a file`);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`${relative} is larger than ${MAX_READ_BYTES} bytes`);
  }
  const content = await fs.readFile(resolved, 'utf8');
  return { path: relative, content, bytes: Buffer.byteLength(content) };
}

async function listDirSafe(relativePath) {
  const { resolved, relative } = resolveProjectPath(relativePath || '.');
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return {
    path: relative || '.',
    entries: entries.slice(0, 80).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
    })),
  };
}

/**
 * Plan (never mutate) file operations for the supervisor.
 * @param {{ task?: string }} state
 */
export async function runDeveloperAgent(state) {
  const task = String(state.task || '').trim();
  const notes = [];
  const writes = parseWriteBlocks(task);
  const reads = parseReadTargets(task);

  for (const target of reads.slice(0, 8)) {
    try {
      const file = await readFileSafe(target);
      const preview =
        file.content.length > 6000
          ? `${file.content.slice(0, 6000)}\n… [truncated]`
          : file.content;
      notes.push(`READ ${file.path} (${file.bytes} bytes)\n${preview}`);
    } catch (error) {
      notes.push(`READ failed ${target}: ${error.message}`);
    }
  }

  if (/\b(ls|list|dir)\b/i.test(task) && !writes.length && !reads.length) {
    const dirMatch = task.match(/\b(?:ls|list|dir)\s+([^\s\n]+)/i);
    try {
      const listing = await listDirSafe(dirMatch?.[1] || 'src');
      notes.push(
        `LIST ${listing.path}\n${listing.entries.map((e) => `${e.type}\t${e.name}`).join('\n')}`
      );
    } catch (error) {
      notes.push(`LIST failed: ${error.message}`);
    }
  }

  if (writes.length) {
    const files = [];
    for (const file of writes.slice(0, 10)) {
      const { relative } = resolveProjectPath(file.path);
      const content = String(file.content ?? '');
      if (Buffer.byteLength(content) > MAX_WRITE_BYTES) {
        throw new Error(`${relative} exceeds write size limit`);
      }
      files.push({ path: relative, content });
    }
    const summary = `Developer write: ${files.map((f) => f.path).join(', ')}`;
    return {
      nextWorker: 'developer',
      workerResults: {
        developer: notes.join('\n\n') || summary,
      },
      pendingAction: {
        worker: 'developer',
        type: 'write_files',
        sensitive: true,
        summary,
        payload: { files: files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content), content: f.content })) },
      },
      finalResponse: notes.join('\n\n'),
    };
  }

  const report =
    notes.join('\n\n') ||
    `Developer agent ready. Send:\n- read src/lib/foo.ts\n- ls src/lib\n- write path/to/file.ts \\\`\\\`\\\`\\n...code...\\n\\\`\\\`\\\``;

  return {
    nextWorker: 'developer',
    workerResults: { developer: report },
    pendingAction: {
      worker: 'developer',
      type: 'none',
      sensitive: false,
      summary: 'No file mutations proposed',
      payload: null,
    },
    finalResponse: report,
  };
}

/**
 * Apply approved file writes inside the project root.
 * @param {{ type?: string, payload?: { files?: { path: string, content: string }[] } }} action
 */
export async function executeDeveloperAction(action) {
  if (action?.type !== 'write_files') {
    return { ok: true, skipped: true };
  }
  const written = [];
  for (const file of action.payload?.files || []) {
    const { resolved, relative } = resolveProjectPath(file.path);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, String(file.content ?? ''), 'utf8');
    written.push(relative);
  }
  return { ok: true, written };
}
