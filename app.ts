import { oauth, type OAuthProvider, type OAuthSession } from '@exact/oauth';
import type { Answer, Result, Sources, Storage, Store } from './app.contract.d.ts';

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
    'fs.read app:/tmp/picked',
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
    'fs.read app:/tmp/picked',
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

const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_[\]~#<>|!+-]/g, '\\$&').replace(/^(\s*\d+)\./gm, '$1\\.');

type EmojiJson = { shortcode: string; url: string; static_url?: string };

// A custom emoji is an empty link with the `emoji:` scheme, which the view draws as its image.
// Only an emoji with an image to draw replaces its shortcode.
const usable = (emojis: EmojiJson[]) => emojis.filter((e) => web(e.url));
const known = (emojis: EmojiJson[]) => new Set(usable(emojis).map((e) => e.shortcode));

function emojify(text: string, emojis: EmojiJson[]): string {
  const codes = known(emojis);
  return text.split(/(:[a-zA-Z0-9_]+:)/).map((part, i) =>
    i % 2 === 1 && codes.has(part.slice(1, -1)) ? `[](emoji:${part.slice(1, -1)})` : escapeMarkdown(part)).join('');
}

// A name read aloud or in a title, where an image can't go, leaves its custom emoji out.
function plainName(name: string, emojis: EmojiJson[], fallback: string): string {
  const codes = known(emojis);
  return name.replace(/:([a-zA-Z0-9_]+):/g, (m, code: string) => (codes.has(code) ? '' : m)).replace(/\s+/g, ' ').trim() || fallback;
}

const toEmoji = (emojis: EmojiJson[]) => usable(emojis).map((e) => ({ shortcode: e.shortcode, url: e.url, staticUrl: web(e.static_url) || e.url }));

const INLINE: Record<string, string> = { strong: '**', b: '**', em: '*', i: '*', del: '~~', s: '~~', code: '`' };

// Mastodon's post HTML is a small allowlist (p, br, a, span, strong, em, del, code, pre,
// blockquote, ul, ol, li), which maps onto Markdown; other tags keep only their text.
function markdown(html: string, host: string, emojis: EmojiJson[] = []): string {
  type Frame = { tag: string; out: string; href?: string; skip?: boolean; ellipsis?: boolean; index?: number };
  const stack: Frame[] = [{ tag: '', out: '' }];
  const top = () => stack[stack.length - 1];
  const inPre = () => stack.some((f) => f.tag === 'pre');
  for (const [, close, name, attrs, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (text !== undefined) {
      const decoded = decode(text);
      top().out += inPre() || stack.some((f) => f.tag === 'code') ? decoded
        : stack.some((f) => f.tag === 'a') ? escapeMarkdown(decoded) : emojify(decoded, emojis);
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
  account: { id: string; username: string; acct: string; display_name: string; avatar: string; emojis?: EmojiJson[] };
  emojis?: EmojiJson[];
  mentions?: { id: string; acct: string }[];
  reblog: Status | null;
  sensitive?: boolean;
  media_attachments?: MediaJson[];
  card?: {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    image_description?: string | null;
    provider_name: string | null;
  } | null;
};

type MediaJson = {
  id: string;
  type: string;
  url: string | null;
  preview_url: string | null;
  remote_url?: string | null;
  description: string | null;
  meta?: { [size in 'original' | 'small']?: { width?: number; height?: number; aspect?: number } } | null;
};

const MEDIA_KINDS = ['image', 'video', 'gifv', 'audio'];
const web = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : '');

function toMedia(m: MediaJson): Post['media'][number] {
  const size = (s?: { width?: number; height?: number; aspect?: number }) =>
    s?.aspect ?? (s?.width && s?.height ? s.width / s.height : 0);
  const ratio = size(m.meta?.original) || size(m.meta?.small);
  // An attachment the server couldn't fetch from another server is "unknown"; its link is the original.
  const kind = MEDIA_KINDS.includes(m.type) && web(m.url) ? m.type : 'unknown';
  return {
    id: m.id,
    kind,
    url: kind === 'unknown' ? web(m.remote_url) || web(m.url) : web(m.url),
    preview: web(m.preview_url),
    description: m.description ?? '',
    ratio,
  };
}

function toCard(card: Status['card']): Post['card'] {
  const url = web(card?.url);
  if (!card || !url || !URL.canParse(url)) return { url: '', title: '', description: '', image: '', alt: '', provider: '' };
  return {
    url,
    title: card.title || url,
    description: card.description ?? '',
    image: web(card.image),
    alt: card.image_description ?? '',
    provider: card.provider_name || new URL(url).hostname,
  };
}

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
  const named = account.emojis ?? [];
  const boosterNamed = booster?.emojis ?? [];
  const emojis = [...(shown.emojis ?? []), ...named, ...boosterNamed];
  return {
    id: status.id,
    statusId: shown.id,
    name: plainName(account.display_name, named, account.username),
    nameMarkup: emojify(account.display_name || account.username, named),
    handle: `@${account.acct}`,
    avatar: account.avatar,
    text: markdown(shown.content, host, shown.emojis ?? []),
    boostedBy: booster ? plainName(booster.display_name, boosterNamed, booster.username) : '',
    boostedByMarkup: booster ? emojify(booster.display_name || booster.username, boosterNamed) : '',
    emoji: toEmoji(emojis),
    boostedAvatar: booster?.avatar ?? '',
    posted: Date.parse(shown.created_at),
    visibility: shown.visibility,
    ...counts(shown),
    accountId: account.id,
    pinned: false,
    media: (shown.media_attachments ?? []).map(toMedia).filter((m) => m.url !== ''),
    sensitive: shown.sensitive ?? false,
    card: toCard(shown.card),
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

const GONE: Post = {
  id: '', statusId: '', name: '', nameMarkup: '', handle: '', avatar: '', text: '', boostedBy: '', boostedByMarkup: '', boostedAvatar: '', posted: 0,
  visibility: '', replies: 0, reblogs: 0, favourites: 0, reblogged: false, favourited: false, accountId: '',
  pinned: false, media: [], sensitive: false, card: { url: '', title: '', description: '', image: '', alt: '', provider: '' }, emoji: [],
};

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
    // A deleted post is an answer, not a failure: the view says it's gone.
    if (response.status === 404) return null;
    if (!response.ok) throw failure('http');
    return response.json();
  };
  const status = (await get(id, '')) as Status | null;
  // A boost has no thread of its own; the post it boosted does.
  const shown = status && (status.reblog ?? status);
  const context = shown && (await get(shown.id, '/context')) as { ancestors: Status[]; descendants: Status[] } | null;
  if (!shown || !context) return { host, id, ancestors: [], post: GONE, replies: [], signedIn: signed, gone: true };
  const thread = {
    host,
    id,
    ancestors: context.ancestors.map((s) => toPost(s, host)),
    post: toPost(shown, host),
    replies: context.descendants.map((s) => toPost(s, host)),
    signedIn: signed,
    gone: false,
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
    name: plainName(account.display_name, account.emojis ?? [], account.username),
    nameMarkup: emojify(account.display_name || account.username, account.emojis ?? []),
    emoji: toEmoji(account.emojis ?? []),
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

type Attachment = Result<'draftMedia'>[number];
type Picked = { path: string; name: string; type: string; size: number };

// Files uploaded for each post being written (a new post, or a reply to a post), sent with it.
const drafts = new Map<string, Attachment[]>();
// One Idempotency-Key per draft, so a post retried after a lost reply is made once.
const postKeys = new Map<string, string>();
const draftKey = (host: string, replyTo: string) => JSON.stringify([host, replyTo]);
let uploads = 0;

const utf8 = (text: string) => new TextEncoder().encode(text);
// storage.fs.readFile reads at most 16 MiB (Exact reference.md, fs).
const MAX_READ = 16 * 1024 * 1024;
const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus',
};
const typeOf = (file: Picked) => file.type || EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';
// Mastodon takes one video or audio file, or images only.
const playable = (type: string) => /^(video|audio)\//.test(type) || type === 'image/gif';

type Limits = { characters: number; media: number; urlLength: number };
const limits = new Map<string, Limits>();

async function limitsFor(host: string): Promise<Limits> {
  const kept = limits.get(host);
  if (kept) return kept;
  const response = await fetch(`${base(host)}/api/v2/instance`, { exactTimeout: TIMEOUT }).catch(() => null);
  const body = response?.ok
    ? ((await response.json().catch(() => ({}))) as { configuration?: { statuses?: { max_characters?: number; max_media_attachments?: number; characters_reserved_per_url?: number } } })
    : {};
  const statuses = body.configuration?.statuses ?? {};
  const found = { characters: statuses.max_characters ?? 500, media: statuses.max_media_attachments ?? 4, urlLength: statuses.characters_reserved_per_url ?? 23 };
  if (response?.ok) limits.set(host, found);
  return found;
}

// Counts as Mastodon does: a link is urlLength characters, a mention counts only its
// username, and a character is a user-perceived one (Intl.Segmenter is not on every host).
function charactersIn(text: string, urlLength: number): number {
  const counted = text
    .replace(/https?:\/\/[^\s<>"]+/g, 'x'.repeat(urlLength))
    .replace(/(^|[^\w/])@(\w+)@[\w.-]+\w/g, '$1@$2');
  let count = 0;
  let joined = false;
  let flags = 0;
  for (const ch of counted) {
    const c = ch.codePointAt(0)!;
    const extends_ = (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x1f3fb && c <= 0x1f3ff) || (c >= 0xe0020 && c <= 0xe007f) || c === 0x20e3;
    if (c === 0x200d) { joined = true; continue; }
    if (extends_ || joined) { joined = false; continue; }
    if (c >= 0x1f1e6 && c <= 0x1f1ff) { if (flags++ % 2 === 1) continue; } else flags = 0;
    count++;
  }
  return count;
}

async function composeLimits(host: string, text: string): Promise<Result<'composeLimits'>> {
  const found = await limitsFor(host);
  return { text, left: found.characters - charactersIn(text, found.urlLength), media: found.media };
}

// Mastodon takes media only as multipart/form-data (POST /api/v2/media).
async function uploadOne(host: string, file: Picked, store: Store, storage: Storage): Promise<Attachment> {
  const bytes = new Uint8Array(await storage.fs.readFile(file.path));
  const boundary = `----GabbyFormBoundary${++uploads}${crypto.randomUUID().replace(/-/g, '')}`;
  const name = file.name.replace(/["\r\n\\]/g, '_');
  const head = utf8(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${typeOf(file)}\r\n\r\n`);
  const tail = utf8(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  const provider = await providerFor(host, store);
  const response = await provider.fetch(store, `${base(host)}/api/v2/media`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  if (response.status === 413) throw failure('too-large');
  if (response.status === 429) throw failure('rate-limited');
  if (!response.ok) throw Object.assign(failure('http'), { detail: (await response.json().catch(() => ({}))).error ?? '' });
  let media = (await response.json()) as { id: string; type: string; url: string | null; preview_url: string | null };
  // 202: the server is still processing it (video, audio, GIF), and a post can't use it until it is done.
  for (let wait = 1000; response.status === 202 && !media.url; wait = Math.min(wait * 2, 5000)) {
    await new Promise((r) => setTimeout(r, wait));
    const check = await provider.fetch(store, `${base(host)}/api/v1/media/${encodeURIComponent(media.id)}`);
    if (check.status === 206) continue;
    if (!check.ok) throw failure('http');
    media = await check.json();
  }
  return { id: media.id, kind: media.type, preview: media.type === 'image' || media.type === 'gifv' ? (media.preview_url ?? '') : '', name: file.name };
}

async function uploadMedia(host: string, replyTo: string, files: Picked[], store: Store, storage: Storage): Promise<Result<'uploadMedia'>> {
  const { media: max } = await limitsFor(host);
  const key = draftKey(host, replyTo);
  const kept = drafts.get(key) ?? [];
  const room = max - kept.length;
  const chosen = files.slice(0, room);
  const kinds = [...kept.map((a) => (a.kind === 'image' ? 'image/' : `${a.kind}/`)), ...chosen.map(typeOf)];
  if (kinds.some(playable) && kinds.length > 1) return { ok: false, error: 'A post can have one video or audio file, or up to 4 images.' };
  const large = chosen.find((file) => file.size > MAX_READ);
  if (large) return { ok: false, error: `${large.name} is over 16 MB, the largest file Gabby can upload.` };
  try {
    for (const file of chosen) {
      const added = await uploadOne(host, file, store, storage);
      drafts.set(key, [...(drafts.get(key) ?? []), added]);
    }
  } catch (error) {
    const { reason, detail, signedOut } = error as { reason?: string; detail?: string; signedOut?: boolean };
    return {
      ok: false,
      error: reason === 'too-large' ? 'That file is too large for this server.'
        : reason === 'rate-limited' ? 'This server is taking no more uploads for now. Try again in a few minutes.'
        : signedOut ? 'Log in again to add files.'
        : detail ? `Couldn't add the file: ${detail}` : "Couldn't add the file.",
    };
  }
  return files.length > room
    ? { ok: false, error: `A post can have at most ${max} files.` }
    : { ok: true, error: '' };
}

// Mastodon 4.4 and later delete unattached media on request; an older server keeps it a day.
async function forget(host: string, ids: string[], store: Store) {
  const provider = await providerFor(host, store).catch(() => null);
  for (const id of ids) {
    await provider?.fetch(store, `${base(host)}/api/v1/media/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
  }
}

async function dropMedia(host: string, replyTo: string, id: string, store: Store): Promise<Result<'dropMedia'>> {
  const key = draftKey(host, replyTo);
  drafts.set(key, (drafts.get(key) ?? []).filter((a) => a.id !== id));
  await forget(host, [id], store);
  return { ok: true, error: '' };
}

async function discardDraft(host: string, replyTo: string, store: Store): Promise<Result<'discardDraft'>> {
  const key = draftKey(host, replyTo);
  const ids = (drafts.get(key) ?? []).map((a) => a.id);
  drafts.delete(key);
  postKeys.delete(key);
  await forget(host, ids, store);
  return { ok: true, error: '' };
}

async function publish(host: string, replyTo: string, text: string, visibility: string, store: Store): Promise<Result<'publish'>> {
  const draft = draftKey(host, replyTo);
  const media = drafts.get(draft) ?? [];
  const key = postKeys.get(draft) ?? crypto.randomUUID();
  postKeys.set(draft, key);
  let response: Response;
  try {
    response = await (await providerFor(host, store)).fetch(store, `${base(host)}/api/v1/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({
        status: text,
        visibility,
        media_ids: media.map((a) => a.id),
        ...(replyTo ? { in_reply_to_id: replyTo } : {}),
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: (error as { signedOut?: boolean }).signedOut
        ? 'Log in again to post.'
        : "Couldn't reach the server. Check your connection and try again.",
    };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ? `Couldn't post: ${body.error}` : "Couldn't post." };
  }
  const status = (await response.json()) as Status;
  drafts.delete(draft);
  postKeys.delete(draft);
  const created = toPost(status, host);
  // Home timelines are read once, so the new post goes on top of the one kept.
  const home = feeds.get(JSON.stringify([host, true, '']));
  if (home && home.posts.length > 0) home.posts = [created, ...home.posts];
  if (replyTo) answered(host, replyTo, created);
  return { ok: true, error: '' };
}

// Counts a reply on the post it answers wherever that post is kept, and adds it to that post's thread.
// Only a kept copy that changed is marked, so every other view still reads the server when opened.
function answered(host: string, replyTo: string, reply: Post) {
  const hit = (p: Post) => p.statusId === replyTo;
  const take = (p: Post) => (hit(p) ? { ...p, replies: p.replies + 1 } : p);
  for (const feed of feeds.values()) if (feed.host === host) feed.posts = feed.posts.map(take);
  for (const [key, person] of people) {
    if (person.host !== host || ![...person.pinned, ...person.posts].some(hit)) continue;
    personActed.add(key);
    people.set(key, { ...person, pinned: person.pinned.map(take), posts: person.posts.map(take) });
  }
  for (const [key, thread] of threads) {
    const under = thread.replies.findIndex(hit);
    if (thread.host !== host || !(hit(thread.post) || under >= 0 || thread.ancestors.some(hit))) continue;
    acted.add(key);
    const replies = thread.replies.map(take);
    // Shown straight under the post it answers, as the newest of its replies.
    if (hit(thread.post)) replies.push(reply);
    else if (under >= 0) replies.splice(under + 1, 0, reply);
    threads.set(key, { ...thread, ancestors: thread.ancestors.map(take), post: take(thread.post), replies });
  }
}

// A reply mentions the post's author and everyone it mentions, except whoever is replying,
// and keeps the post's visibility, as Mastodon's own app does.
const VISIBILITY_ORDER = ['public', 'unlisted', 'private', 'direct'];

async function replyDraft(host: string, id: string, store: Store): Promise<Result<'replyDraft'>> {
  if (!(await signedIn(host, store))) throw failure('auth-required');
  const provider = await providerFor(host, store);
  const [response, mine] = await Promise.all([
    provider.fetch(store, `${base(host)}/api/v1/statuses/${encodeURIComponent(id)}`),
    provider.fetch(store, `${base(host)}/api/v1/accounts/verify_credentials`),
  ]);
  if (response.status === 401 || mine.status === 401) throw failure('auth-expired');
  if (response.status === 404) throw failure('not-found');
  if (!response.ok || !mine.ok) throw failure('http');
  const status = (await response.json()) as Status;
  const me = (await mine.json()) as { id: string; source?: { privacy?: string } };
  const shown = status.reblog ?? status;
  const people = [shown.account, ...(shown.mentions ?? [])].filter((a) => a.id !== me.id);
  const mention = [...new Set(people.map((a) => a.acct))].map((acct) => `@${acct} `).join('');
  // Mastodon's web client starts at the narrower of the post's visibility and the account's default.
  const narrower = (a: string, b: string) => (VISIBILITY_ORDER.indexOf(a) > VISIBILITY_ORDER.indexOf(b) ? a : b);
  return {
    host,
    id,
    name: shown.account.display_name || shown.account.username,
    text: markdown(shown.content, host),
    mention,
    visibility: narrower(shown.visibility, me.source?.privacy ?? 'public'),
    widest: shown.visibility,
  };
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
  draftMedia: ([host, replyTo]) => [...(drafts.get(draftKey(host, replyTo)) ?? [])],
  uploadMedia: ([host, replyTo, files], store, storage) => uploadMedia(host, replyTo, files, store, storage),
  dropMedia: ([host, replyTo, id], store) => dropMedia(host, replyTo, id, store),
  discardDraft: ([host, replyTo], store) => discardDraft(host, replyTo, store),
  composeLimits: ([host, text]) => composeLimits(host, text),
  publish: ([host, replyTo, text, visibility], store) => publish(host, replyTo, text, visibility, store),
  replyDraft: ([host, id], store) => replyDraft(host, id, store),
  morePosts: ([host, id], store) => morePosts(host, id, store),
  setFollow: ([host, id, follow], store) => setFollow(host, id, follow, store),
  nextPage: async ([host, home, tag], store) => {
    await append(feedFor(host, home, tag), store);
    return { ok: true };
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
