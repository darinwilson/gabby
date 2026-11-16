// A local GoToSocial server to try Gabby against a real ActivityPub server
// without writing to a public one. See README.md, "A GoToSocial sandbox".
import { spawn, type Subprocess } from 'bun';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, cpSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seed } from './seed.ts';

const VERSION = '0.22.3';
const RELEASES = `https://codeberg.org/superseriousbusiness/gotosocial/releases/download/v${VERSION}`;

// Gabby's local backend (`web-sandbox`): every server it names is served under /<host> here.
const PROXY_PORT = 4790;
const GTS_PORT = PROXY_PORT + 1;
// GoToSocial builds its links from this host, so they lead back through the proxy.
const GTS_HOST = `localhost:${PROXY_PORT}`;

const root = join(import.meta.dir, '..', '.sandbox');
const install = join(root, `gotosocial-${VERSION}`);
const binary = join(install, 'gotosocial');
const data = join(root, 'data');
// Written once seeding finishes; data without it was left by an interrupted start.
const seeded = join(data, '.seeded');
const config = join(root, 'config.yaml');

const log = (message: string) => console.log(`sandbox: ${message}`);

async function download(name: string, sums: Map<string, string>): Promise<string> {
  const path = join(root, 'downloads', name);
  if (!existsSync(path)) {
    log(`downloading ${name}`);
    const response = await fetch(`${RELEASES}/${name}`);
    if (!response.ok) throw new Error(`downloading ${name}: HTTP ${response.status}`);
    mkdirSync(join(root, 'downloads'), { recursive: true });
    await Bun.write(`${path}.part`, response);
    renameSync(`${path}.part`, path);
  }
  const sum = createHash('sha256').update(await Bun.file(path).bytes()).digest('hex');
  if (sum !== sums.get(name)) {
    rmSync(path);
    throw new Error(`${name} doesn't match the release checksum`);
  }
  return path;
}

async function run(command: string[], cwd?: string, env?: Record<string, string>, quiet = false) {
  const output = quiet ? 'pipe' : 'inherit';
  const child = spawn(command, { cwd, env: { ...process.env, ...env }, stdout: output, stderr: output });
  if ((await child.exited) === 0) return;
  if (quiet) console.error(await new Response(child.stdout).text(), await new Response(child.stderr).text());
  throw new Error(`${command.join(' ')} failed`);
}

// GoToSocial publishes binaries for Linux and the BSDs but not macOS, where it
// builds from the release's source, which needs Go.
async function ensureBinary() {
  if (existsSync(binary)) return;
  const response = await fetch(`${RELEASES}/checksums.txt`);
  if (!response.ok) throw new Error(`downloading checksums.txt: HTTP ${response.status}`);
  const sums = new Map((await response.text()).trim().split('\n').map((line) => {
    const [sum, name] = line.trim().split(/\s+/);
    return [name, sum] as [string, string];
  }));
  const staging = `${install}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch as string];
  if (process.platform === 'linux' && arch) {
    const archive = await download(`gotosocial_${VERSION}_linux_${arch}.tar.gz`, sums);
    await run(['tar', 'xzf', archive, '-C', staging]);
  } else {
    if (!Bun.which('go')) throw new Error('building GoToSocial needs Go (https://go.dev/dl, or `brew install go`)');
    const source = await download(`gotosocial-${VERSION}-source-code.tar.gz`, sums);
    const assets = await download(`gotosocial_${VERSION}_web-assets.tar.gz`, sums);
    const src = join(root, 'src');
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    await run(['tar', 'xzf', source, '-C', src]);
    log('building GoToSocial (a few minutes the first time)');
    await run([
      'go', 'build', '-trimpath',
      '-tags', 'netgo osusergo static_build timetzdata nomsgpack stdlibjson',
      '-ldflags', `-s -w -X main.Version=${VERSION}`,
      '-o', join(staging, 'gotosocial'), './cmd/gotosocial',
    ], src, { CGO_ENABLED: '0' });
    await run(['tar', 'xzf', assets, '-C', staging]);
    cpSync(join(src, 'web', 'template'), join(staging, 'web', 'template'), { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
  rmSync(install, { recursive: true, force: true });
  cpSync(staging, install, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
}

function writeConfig() {
  writeFileSync(config, [
    `host: "${GTS_HOST}"`,
    'protocol: "http"',
    'bind-address: "127.0.0.1"',
    `port: ${GTS_PORT}`,
    'db-type: "sqlite"',
    `db-address: "${join(data, 'sqlite.db')}"`,
    `storage-local-base-path: "${join(data, 'storage')}"`,
    `web-template-base-dir: "${join(install, 'web', 'template')}/"`,
    `web-asset-base-dir: "${join(install, 'web', 'assets')}/"`,
    'instance-expose-public-timeline: true',
    'accounts-registration-open: false',
    // Seeding makes hundreds of requests in a few seconds.
    'advanced-rate-limit-requests: 0',
    'advanced-throttling-multiplier: 0',
    'log-level: "warn"',
    '',
  ].join('\n'));
}

async function gts(...args: string[]) {
  await run([binary, '--config-path', config, ...args], undefined, undefined, true);
}

async function waitForServer(server: Subprocess) {
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw new Error('GoToSocial exited during startup');
    try {
      if ((await fetch(`http://127.0.0.1:${GTS_PORT}/api/v1/instance`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('GoToSocial did not start');
}

// Gabby's backend serves each server under /<host>, so the proxy drops that
// prefix. Paths without one (sign-in pages, media) pass through as they are.
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/;

function serveProxy() {
  const target = `http://127.0.0.1:${GTS_PORT}`;
  return Bun.serve({
    port: PROXY_PORT,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      const [, first, ...rest] = url.pathname.split('/');
      const path = rest.length > 0 && HOST.test(first) ? `/${rest.join('/')}` : url.pathname;
      const headers = new Headers(request.headers);
      headers.set('host', GTS_HOST);
      let response: Response;
      try {
        response = await fetch(`${target}${path}${url.search}`, {
          method: request.method,
          headers,
          body: request.body,
          redirect: 'manual',
        });
      } catch {
        return new Response('The sandbox proxy could not reach GoToSocial.', { status: 502 });
      }
      const out = new Headers(response.headers);
      // fetch has already decoded the body.
      out.delete('content-encoding');
      out.delete('content-length');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
    },
  });
}

async function start(reset: boolean) {
  await ensureBinary();
  // Before anything else, so a running fixture or sandbox stops this before it touches the data.
  let proxy: ReturnType<typeof serveProxy>;
  try {
    proxy = serveProxy();
  } catch (error) {
    if ((error as { code?: string }).code === 'EADDRINUSE') {
      throw new Error(`port ${PROXY_PORT} is taken: stop the fixture server or the other sandbox first`);
    }
    throw error;
  }
  let server: Subprocess | undefined;
  const stop = () => {
    server?.kill();
    proxy.stop(true);
  };
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  try {
    const fresh = reset || !existsSync(seeded);
    if (fresh) {
      if (existsSync(data)) log(reset ? 'removing the old server data' : 'the last start stopped before seeding finished; seeding again');
      rmSync(data, { recursive: true, force: true });
    }
    mkdirSync(data, { recursive: true });
    writeConfig();
    server = spawn([binary, '--config-path', config, 'server', 'start'], {
      env: { ...process.env, GIN_MODE: 'release' },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    await waitForServer(server);
    if (fresh) {
      await seed(`http://127.0.0.1:${GTS_PORT}`, gts);
      writeFileSync(seeded, '');
    }
    log(`GoToSocial ${VERSION} is up. Run Gabby against it with: bun exact.mjs web-sandbox`);
    log(`Every server address in Gabby leads here; sign in to fosstodon.org, mastodon.social or mastodon.art as one of the accounts in sandbox/seed.ts.`);
    log('Ctrl-C stops it; the data stays in .sandbox/data until `bun exact.mjs sandbox-reset`.');
    await server.exited;
    throw new Error('GoToSocial stopped');
  } finally {
    stop();
  }
}

const command = process.argv[2] ?? 'start';
try {
  if (command === 'start') await start(false);
  else if (command === 'reset') await start(true);
  else if (command === 'clean') rmSync(root, { recursive: true, force: true });
  else {
    console.error('usage: bun sandbox/sandbox.ts [start|reset|clean]');
    process.exit(1);
  }
} catch (error) {
  console.error(`sandbox: ${(error as Error).message}`);
  process.exit(1);
}
