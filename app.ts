import { oauth, type OAuthProvider } from '@exact/oauth';
import type { Answer, Result, Sources, Store } from './app.contract.d.ts';

// The live origin is a placeholder: live, each server is reached at its own
// origin. Tests select the fixture with `--backend`, which serves every server
// under /<host>.
const origin = 'https://live.invalid';

const FIXTURE = (origin as string) === 'https://live.invalid' ? '' : origin;
if (FIXTURE && !/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(FIXTURE)) {
  throw new Error(`The backend ${FIXTURE} is not the local fixture: tests run only against http://127.0.0.1.`);
}

const base = (host: string) => (FIXTURE ? `${FIXTURE}/${host}` : `https://${host}`);

// Live, the server is whatever the person types, so any HTTPS origin. Sign-in's
// grants can't name every origin, so login is limited to SERVERS.
export const grants = {
  'https://live.invalid': [
    'net.fetch https:',
    'auth.session https://fosstodon.org',
    'auth.session https://mastodon.social',
    'auth.session https://mastodon.art',
    'auth.callback com.example.gabby-be219f:/oauth',
    'secret.keep fosstodon.client',
    'secret.keep fosstodon.session',
    'secret.keep mastodon-social.client',
    'secret.keep mastodon-social.session',
    'secret.keep mastodon-art.client',
    'secret.keep mastodon-art.session',
  ],
  'http://127.0.0.1:4790': [
    'net.fetch http://127.0.0.1:4790',
    'auth.session http://127.0.0.1:4790',
    'auth.callback com.example.gabby-be219f:/oauth',
    'secret.keep fosstodon.client',
    'secret.keep fosstodon.session',
    'secret.keep mastodon-social.client',
    'secret.keep mastodon-social.session',
    'secret.keep mastodon-art.client',
    'secret.keep mastodon-art.session',
  ],
};

const SERVERS: Record<string, string> = {
  'fosstodon.org': 'fosstodon',
  'mastodon.social': 'mastodon-social',
  'mastodon.art': 'mastodon-art',
};

type Post = Result<'loadTimeline'>['posts'][number];

const TIMEOUT = 10000;

const failure = (reason: string) => Object.assign(new Error(reason), { reason });

function parseHost(input: string): string | null {
  const host = input.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(host) ? host : null;
}

async function connect(input: string): Promise<Result<'connect'>> {
  const host = parseHost(input);
  if (!host) return { ok: false, error: 'Enter a server address, like mastodon.social.', host: '' };
  let body: unknown;
  try {
    const response = await fetch(`${base(host)}/api/v1/instance`, { exactTimeout: TIMEOUT });
    body = response.ok ? await response.json() : null;
  } catch {
    return { ok: false, error: `Couldn't reach ${host}.`, host: '' };
  }
  const isMastodon = body !== null && typeof body === 'object'
    && 'version' in body && typeof body.version === 'string'
    && 'uri' in body && typeof body.uri === 'string';
  return isMastodon
    ? { ok: true, error: '', host }
    : { ok: false, error: `${host} isn't a Mastodon server.`, host: '' };
}

type Client = { callback: string; id: string; secret: string };

const providers = new Map<string, OAuthProvider>();

// Mastodon has no preregistered clients: each server issues its own, for the
// callback this build signs in through.
async function providerFor(host: string, store: Store): Promise<OAuthProvider> {
  const ready = providers.get(host);
  if (ready) return ready;
  const name = `${SERVERS[host]}.client`;
  const callback = authCallback();
  let client = JSON.parse(store.get(name) ?? 'null') as Client | null;
  if (client?.callback !== callback) {
    const response = await fetch(`${base(host)}/api/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Gabby', redirect_uris: callback, scopes: 'read' }),
      exactTimeout: TIMEOUT,
    });
    if (!response.ok) throw failure('register');
    const body = (await response.json()) as { client_id: string; client_secret: string };
    client = { callback, id: body.client_id, secret: body.client_secret };
    store.set(name, JSON.stringify(client));
  }
  const server = base(host);
  const provider = oauth({
    issuer: server,
    endpoints: { authorization: `${server}/oauth/authorize`, token: `${server}/oauth/token`, revocation: `${server}/oauth/revoke` },
    clientId: client.id,
    clientSecret: client.secret,
    scopes: ['read'],
    key: `${SERVERS[host]}.session`,
    apis: [new URL(server).origin],
  });
  providers.set(host, provider);
  return provider;
}

async function loadAccount(host: string, store: Store): Promise<Result<'loadAccount'>> {
  if (!(host in SERVERS)) return { host, supported: false, signedIn: false, error: '' };
  try {
    const session = await (await providerFor(host, store)).session(store);
    return { host, supported: true, signedIn: session.signedIn, error: session.error };
  } catch {
    return { host, supported: true, signedIn: false, error: `Couldn't prepare login for ${host}.` };
  }
}

async function loadProfile(host: string, store: Store): Promise<Result<'loadProfile'>> {
  const me = (await (await providerFor(host, store)).json(store, `${base(host)}/api/v1/accounts/verify_credentials`)) as {
    username: string; acct: string; display_name: string; avatar: string;
  };
  return { host, name: me.display_name || me.username, handle: `@${me.acct}@${host}`, avatar: me.avatar };
}

// The servers whose sessions the store still holds.
async function loadRecent(store: Store): Promise<Result<'loadRecent'>> {
  const signedIn = await Promise.all(Object.keys(SERVERS).map(async (host) =>
    store.get(`${SERVERS[host]}.client`) !== null && (await (await providerFor(host, store)).session(store)).signedIn));
  return Object.keys(SERVERS).filter((_, i) => signedIn[i]).map((host) => ({ host }));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function plainText(html: string): string {
  return decode(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .trim();
}

const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]~#<>|!-]/g, '\\$&');

const INLINE: Record<string, string> = { strong: '**', b: '**', em: '*', i: '*', del: '~~', s: '~~', code: '`' };

// Mastodon's post HTML is a small allowlist (p, br, a, span, strong, em, del, code, pre,
// blockquote, ul, ol, li), which maps onto Markdown; other tags keep only their text.
function markdown(html: string, host: string): string {
  type Frame = { tag: string; out: string; href?: string; skip?: boolean; ellipsis?: boolean; index?: number };
  const stack: Frame[] = [{ tag: '', out: '' }];
  const top = () => stack[stack.length - 1];
  const inPre = () => stack.some((f) => f.tag === 'pre');
  for (const [, close, name, attrs, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (text !== undefined) {
      const decoded = decode(text);
      top().out += inPre() || stack.some((f) => f.tag === 'code') ? decoded : escapeMarkdown(decoded);
      continue;
    }
    const tag = name.toLowerCase();
    if (tag === 'br') { top().out += '\n'; continue; }
    if (!close) {
      const cls = /class="([^"]*)"/i.exec(attrs)?.[1].split(/\s+/) ?? [];
      stack.push({
        tag,
        out: '',
        href: tag === 'a' ? link(decode(/href="([^"]*)"/i.exec(attrs)?.[1] ?? ''), cls, host) : undefined,
        skip: tag === 'span' && cls.includes('invisible'),
        ellipsis: tag === 'span' && cls.includes('ellipsis'),
        index: 0,
      });
      continue;
    }
    const i = stack.findLastIndex((f) => f.tag === tag);
    if (i <= 0) continue;
    while (stack.length - 1 > i) { const f = stack.pop()!; top().out += f.out; }
    const f = stack.pop()!;
    const parent = top();
    let out = f.out;
    if (f.skip) out = '';
    else if (f.ellipsis) out += '…';
    else if (tag in INLINE && !inPre()) out = out.trim() ? `${INLINE[tag]}${out}${INLINE[tag]}` : out;
    else if (tag === 'a') out = f.href ? `[${out}](<${f.href.replace(/[<>]/g, encodeURIComponent)}>)` : out;
    else if (tag === 'pre') out = `\n\n\`\`\`\n${out.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`;
    else if (tag === 'p') out = `\n\n${out.trim()}\n\n`;
    else if (tag === 'blockquote') out = `\n\n${out.trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
    else if (tag === 'ul' || tag === 'ol') out = `\n\n${out.trim()}\n\n`;
    else if (tag === 'li') {
      const marker = parent.tag === 'ol' ? `${++parent.index!}. ` : '- ';
      out = `${marker}${out.trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n   ')}\n`;
    }
    parent.out += out;
  }
  while (stack.length > 1) { const f = stack.pop()!; top().out += f.out; }
  return top().out.replace(/\n{3,}/g, '\n\n').trim();
}

// A hashtag opens in the app, on the server whose timeline shows it.
function link(href: string, cls: string[], host: string): string {
  const name = cls.includes('hashtag') ? /\/tags\/([^/?#]+)/.exec(href)?.[1] : undefined;
  return name ? `/tag/${host}/${name}` : href;
}

type Status = {
  id: string;
  content: string;
  account: { username: string; acct: string; display_name: string; avatar: string };
  reblog: Status | null;
};

function toPost(status: Status, host: string): Post {
  const shown = status.reblog ?? status;
  const { account } = shown;
  return {
    id: status.id,
    name: account.display_name || account.username,
    handle: `@${account.acct}`,
    avatar: account.avatar,
    text: markdown(shown.content, host),
  };
}

type Feed = Result<'loadTimeline'>;

// Kept per timeline, so Back from a hashtag returns to the posts it left.
const feeds = new Map<string, Feed>();

function feedFor(host: string, home: boolean, tag: string): Feed {
  const key = JSON.stringify([host, home, tag]);
  let feed = feeds.get(key);
  if (!feed) feeds.set(key, feed = { host, home, tag, posts: [], hasNext: true });
  return feed;
}

async function signedIn(host: string, store: Store): Promise<boolean> {
  return host in SERVERS && store.get(`${SERVERS[host]}.client`) !== null
    && (await (await providerFor(host, store)).session(store)).signedIn;
}

async function append(feed: Feed, store: Store) {
  const { host, home, tag } = feed;
  const last = feed.posts.at(-1);
  const query = last ? `&max_id=${last.id}` : '';
  const path = tag ? `tag/${encodeURIComponent(tag)}` : home ? 'home' : 'public';
  const url = `${base(host)}/api/v1/timelines/${path}?limit=20${query}`;
  const response = home || (tag && await signedIn(host, store))
    ? await (await providerFor(host, store)).fetch(store, url)
    : await fetch(url, { exactTimeout: TIMEOUT });
  if (response.status === 401 || response.status === 422) throw failure('auth-required');
  if (!response.ok) throw failure('http');
  const page = (await response.json()) as Status[];
  feed.posts = feed.posts.concat(page.map((s) => toPost(s, host)));
  feed.hasNext = page.length > 0;
}

async function loadInstance(host: string): Promise<Result<'loadInstance'>> {
  const response = await fetch(`${base(host)}/api/v2/instance`, { exactTimeout: TIMEOUT });
  if (!response.ok) throw failure('http');
  const body = (await response.json()) as { title?: string; description?: string; thumbnail?: { url?: string } };
  return {
    domain: host,
    title: body.title || host,
    description: plainText(body.description ?? '').replace(/\r\n/g, '\n'),
    thumbnail: body.thumbnail?.url ?? '',
  };
}

const sources: Sources = {
  connect: ([input]) => connect(input),
  loadAccount: ([host], store) => loadAccount(host, store),
  // The account resource has made the provider, so the browser opens with
  // nothing awaited before it, as a web popup requires.
  signIn: ([host], store) => providers.get(host)!.signIn(store),
  loadInstance: ([host]) => loadInstance(host),
  loadProfile: ([host], store) => loadProfile(host, store),
  loadRecent: (_args, store) => loadRecent(store),
  loadTimeline: async ([host, home, tag], store) => {
    const feed = feedFor(host, home, tag);
    if (feed.posts.length === 0) await append(feed, store);
    return { ...feed };
  },
  nextPage: async ([host, home, tag], store) => {
    await append(feedFor(host, home, tag), store);
    return { ok: true };
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
