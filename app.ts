import { oauth, type OAuthProvider, type OAuthSession } from '@exact/oauth';
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

const SCOPES = ['read', 'write'];

type Client = { callback: string; id: string; secret: string; scopes: string };

// A session from before Gabby asked to write can't like or boost, so it signs in again.
const active = (session: OAuthSession) => session.signedIn && SCOPES.every((s) => session.scopes.includes(s));

const providers = new Map<string, OAuthProvider>();

// Mastodon has no preregistered clients: each server issues its own, for the
// callback this build signs in through.
async function providerFor(host: string, store: Store): Promise<OAuthProvider> {
  const ready = providers.get(host);
  if (ready) return ready;
  const name = `${SERVERS[host]}.client`;
  const callback = authCallback();
  let client = JSON.parse(store.get(name) ?? 'null') as Client | null;
  if (client?.callback !== callback || client.scopes !== SCOPES.join(' ')) {
    const response = await fetch(`${base(host)}/api/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Gabby', redirect_uris: callback, scopes: SCOPES.join(' ') }),
      exactTimeout: TIMEOUT,
    });
    if (!response.ok) throw failure('register');
    const body = (await response.json()) as { client_id: string; client_secret: string };
    client = { callback, id: body.client_id, secret: body.client_secret, scopes: SCOPES.join(' ') };
    store.set(name, JSON.stringify(client));
  }
  const server = base(host);
  const provider = oauth({
    issuer: server,
    endpoints: { authorization: `${server}/oauth/authorize`, token: `${server}/oauth/token`, revocation: `${server}/oauth/revoke` },
    clientId: client.id,
    clientSecret: client.secret,
    scopes: SCOPES,
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
    return { host, supported: true, signedIn: active(session), error: session.error };
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
    store.get(`${SERVERS[host]}.client`) !== null && active(await (await providerFor(host, store)).session(store))));
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

// A hashtag gets the `tag:` scheme, which the view draws as a pill that opens it in the app,
// on the server whose timeline shows it.
function link(href: string, cls: string[], host: string): string {
  const name = cls.includes('hashtag') ? /\/tags\/([^/?#]+)/.exec(href)?.[1] : undefined;
  return name ? `tag:/tag/${host}/${name}` : href;
}

type Status = {
  id: string;
  created_at: string;
  visibility: string;
  content: string;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  favourited?: boolean;
  reblogged?: boolean;
  account: { id: string; username: string; acct: string; display_name: string; avatar: string };
  reblog: Status | null;
};

type AccountJson = Status['account'] & {
  header: string;
  note: string;
  fields?: { name: string; value: string }[];
  followers_count: number;
  following_count: number;
  statuses_count: number;
};

const counts = (status: Status) => ({
  replies: status.replies_count,
  reblogs: status.reblogs_count,
  favourites: status.favourites_count,
  reblogged: status.reblogged ?? false,
  favourited: status.favourited ?? false,
});

function toPost(status: Status, host: string): Post {
  const shown = status.reblog ?? status;
  const { account } = shown;
  const booster = status.reblog ? status.account : null;
  return {
    id: status.id,
    statusId: shown.id,
    name: account.display_name || account.username,
    handle: `@${account.acct}`,
    avatar: account.avatar,
    text: markdown(shown.content, host),
    boostedBy: booster ? booster.display_name || booster.username : '',
    boostedAvatar: booster?.avatar ?? '',
    posted: Date.parse(shown.created_at),
    visibility: shown.visibility,
    ...counts(shown),
    accountId: account.id,
    pinned: false,
  };
}

type Feed = Result<'loadTimeline'>;

// Kept per timeline, so Back from a hashtag returns to the posts it left.
const feeds = new Map<string, Feed>();

function feedFor(host: string, home: boolean, tag: string): Feed {
  const key = JSON.stringify([host, home, tag]);
  let feed = feeds.get(key);
  if (!feed) feeds.set(key, feed = { host, home, tag, posts: [], hasNext: true, signedIn: false });
  return feed;
}

async function signedIn(host: string, store: Store): Promise<boolean> {
  return host in SERVERS && store.get(`${SERVERS[host]}.client`) !== null
    && active(await (await providerFor(host, store)).session(store));
}

async function append(feed: Feed, store: Store) {
  const { host, home, tag } = feed;
  const last = feed.posts.at(-1);
  const query = last ? `&max_id=${last.id}` : '';
  const path = tag ? `tag/${encodeURIComponent(tag)}` : home ? 'home' : 'public';
  const url = `${base(host)}/api/v1/timelines/${path}?limit=20${query}`;
  // Signed in, a timeline says which posts the person has liked or boosted.
  const response = home || await signedIn(host, store)
    ? await (await providerFor(host, store)).fetch(store, url)
    : await fetch(url, { exactTimeout: TIMEOUT });
  if (response.status === 401 || response.status === 422) throw failure('auth-required');
  if (!response.ok) throw failure('http');
  const page = (await response.json()) as Status[];
  feed.posts = feed.posts.concat(page.map((s) => toPost(s, host)));
  feed.hasNext = page.length > 0;
}

type Thread = Result<'loadThread'>;

// Each thread as last loaded. Loading fetches it again, so a post opened again shows its new
// replies; only the refresh after act() reads the copy act() updated (the keys in `acted`).
const threads = new Map<string, Thread>();
const acted = new Set<string>();

async function loadThread(host: string, id: string, store: Store): Promise<Thread> {
  const key = JSON.stringify([host, id]);
  const signed = await signedIn(host, store);
  const kept = threads.get(key);
  if (kept && acted.delete(key)) return { ...kept, signedIn: signed };
  const get = async (statusId: string, path: string) => {
    const url = `${base(host)}/api/v1/statuses/${encodeURIComponent(statusId)}${path}`;
    const response = signed
      ? await (await providerFor(host, store)).fetch(store, url)
      : await fetch(url, { exactTimeout: TIMEOUT });
    if (response.status === 401) throw failure(signed ? 'auth-expired' : 'auth-required');
    if (response.status === 404) throw failure('not-found');
    if (!response.ok) throw failure('http');
    return response.json();
  };
  const status = (await get(id, '')) as Status;
  // A boost has no thread of its own; the post it boosted does.
  const shown = status.reblog ?? status;
  const context = (await get(shown.id, '/context')) as { ancestors: Status[]; descendants: Status[] };
  const thread = {
    host,
    id,
    ancestors: context.ancestors.map((s) => toPost(s, host)),
    post: toPost(shown, host),
    replies: context.descendants.map((s) => toPost(s, host)),
    signedIn: signed,
  };
  threads.set(key, thread);
  return thread;
}

type Person = Result<'loadPerson'>;

// Kept per account, so a follow or a page of posts adds to the profile as it was loaded.
const people = new Map<string, Person>();
// Profiles are read on every open; only the refresh straight after a change reads the kept copy.
const personActed = new Set<string>();

async function read(host: string, path: string, signed: boolean, store: Store): Promise<unknown> {
  const url = `${base(host)}${path}`;
  const response = signed
    ? await (await providerFor(host, store)).fetch(store, url)
    : await fetch(url, { exactTimeout: TIMEOUT });
  if (response.status === 401) throw failure(signed ? 'auth-expired' : 'auth-required');
  if (response.status === 404) throw failure('not-found');
  if (!response.ok) throw failure('http');
  return response.json();
}

const POSTS_PAGE = 20;
const postsPath = (id: string, maxId?: string) =>
  `/api/v1/accounts/${encodeURIComponent(id)}/statuses?limit=${POSTS_PAGE}&exclude_replies=true${maxId ? `&max_id=${maxId}` : ''}`;

// Mastodon's own profile page: replies left out, pinned posts first.
async function loadPerson(host: string, id: string, store: Store): Promise<Person> {
  const key = JSON.stringify([host, id]);
  const signed = await signedIn(host, store);
  const kept = people.get(key);
  if (kept && personActed.delete(key)) return { ...kept, signedIn: signed };
  const at = `/api/v1/accounts/${encodeURIComponent(id)}`;
  const [account, pinned, page, relations, me] = (await Promise.all([
    read(host, at, signed, store),
    read(host, `${at}/statuses?pinned=true`, signed, store),
    read(host, postsPath(id), signed, store),
    signed ? read(host, `/api/v1/accounts/relationships?id[]=${encodeURIComponent(id)}`, true, store) : [],
    signed ? read(host, '/api/v1/accounts/verify_credentials', true, store) : null,
  ])) as [AccountJson, Status[], Status[], { following: boolean; requested: boolean }[], { id: string } | null];
  const person: Person = {
    host,
    id,
    name: account.display_name || account.username,
    handle: account.acct.includes('@') ? `@${account.acct}` : `@${account.acct}@${host}`,
    avatar: account.avatar,
    // Mastodon names a placeholder image when no banner is set.
    banner: !account.header || account.header.endsWith('/missing.png') ? '' : account.header,
    bio: markdown(account.note ?? '', host),
    fields: (account.fields ?? []).map((f, i) => ({ key: String(i), name: f.name, value: markdown(f.value, host) })),
    followers: account.followers_count,
    following: account.following_count,
    statuses: account.statuses_count,
    pinned: pinned.map((s) => ({ ...toPost(s, host), pinned: true })),
    posts: page.map((s) => toPost(s, host)),
    hasNext: page.length > 0,
    signedIn: signed,
    self: me?.id === id,
    followed: relations[0]?.following ?? false,
    requested: relations[0]?.requested ?? false,
  };
  people.set(key, person);
  return person;
}

async function morePosts(host: string, id: string, store: Store): Promise<Result<'morePosts'>> {
  const key = JSON.stringify([host, id]);
  const person = people.get(key);
  if (!person || !person.hasNext) return { ok: true };
  const after = person.posts.at(-1)?.id;
  const page = (await read(host, postsPath(id, after), await signedIn(host, store), store)) as Status[];
  // act() or setFollow() may have replaced the profile while the page loaded.
  const now = people.get(key);
  if (!now || now.posts.at(-1)?.id !== after) return { ok: true };
  people.set(key, { ...now, posts: now.posts.concat(page.map((s) => toPost(s, host))), hasNext: page.length > 0 });
  personActed.add(key);
  return { ok: true };
}

async function setFollow(host: string, id: string, follow: boolean, store: Store): Promise<Result<'setFollow'>> {
  const url = `${base(host)}/api/v1/accounts/${encodeURIComponent(id)}/${follow ? 'follow' : 'unfollow'}`;
  const relation = (await (await providerFor(host, store)).json(store, url, { method: 'POST' })) as { following: boolean; requested: boolean };
  const key = JSON.stringify([host, id]);
  const person = people.get(key);
  if (person) {
    const change = Number(relation.following) - Number(person.followed);
    people.set(key, { ...person, followed: relation.following, requested: relation.requested, followers: person.followers + change });
    personActed.add(key);
  }
  return { ok: true };
}

// Mastodon answers with the status as it now stands, which every timeline and thread showing it takes.
async function act(host: string, statusId: string, action: string, store: Store): Promise<Result<'act'>> {
  const url = `${base(host)}/api/v1/statuses/${encodeURIComponent(statusId)}/${action}`;
  const body = (await (await providerFor(host, store)).json(store, url, { method: 'POST' })) as Status;
  const updated = body.reblog ?? body;
  const take = (p: Post) => (p.statusId === updated.id ? { ...p, ...counts(updated) } : p);
  for (const feed of feeds.values()) feed.posts = feed.posts.map(take);
  for (const [key, person] of people) {
    personActed.add(key);
    people.set(key, { ...person, pinned: person.pinned.map(take), posts: person.posts.map(take) });
  }
  for (const [key, thread] of threads) {
    acted.add(key);
    threads.set(key, { ...thread, ancestors: thread.ancestors.map(take), post: take(thread.post), replies: thread.replies.map(take) });
  }
  return { ok: true };
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
    feed.signedIn = await signedIn(host, store);
    if (feed.posts.length === 0) await append(feed, store);
    return { ...feed };
  },
  loadThread: ([host, id], store) => loadThread(host, id, store),
  act: ([host, statusId, action], store) => act(host, statusId, action, store),
  loadPerson: ([host, id], store) => loadPerson(host, id, store),
  morePosts: ([host, id], store) => morePosts(host, id, store),
  setFollow: ([host, id, follow], store) => setFollow(host, id, follow, store),
  nextPage: async ([host, home, tag], store) => {
    await append(feedFor(host, home, tag), store);
    return { ok: true };
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
