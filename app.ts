import type { Answer, Result, Sources } from './app.contract.d.ts';

// The server is whatever the person types, so any HTTPS origin.
export const grants = 'net.fetch https:';

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
    const response = await fetch(`https://${host}/api/v1/instance`, { exactTimeout: TIMEOUT });
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
function markdown(html: string): string {
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
        href: tag === 'a' ? decode(/href="([^"]*)"/i.exec(attrs)?.[1] ?? '') : undefined,
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

type Status = {
  id: string;
  content: string;
  account: { username: string; acct: string; display_name: string; avatar: string };
  reblog: Status | null;
};

function toPost(status: Status): Post {
  const shown = status.reblog ?? status;
  const { account } = shown;
  return {
    id: status.id,
    name: account.display_name || account.username,
    handle: `@${account.acct}`,
    avatar: account.avatar,
    text: markdown(shown.content),
  };
}

let feed = { host: '', posts: [] as Post[], hasNext: true };

async function append(host: string) {
  const last = feed.posts.at(-1);
  const query = last ? `&max_id=${last.id}` : '';
  const response = await fetch(`https://${host}/api/v1/timelines/public?limit=20${query}`, { exactTimeout: TIMEOUT });
  if (response.status === 401 || response.status === 422) throw failure('auth-required');
  if (!response.ok) throw failure('http');
  const page = (await response.json()) as Status[];
  if (feed.host !== host) return;
  feed = { host, posts: feed.posts.concat(page.map(toPost)), hasNext: page.length > 0 };
}

async function loadInstance(host: string): Promise<Result<'loadInstance'>> {
  const response = await fetch(`https://${host}/api/v2/instance`, { exactTimeout: TIMEOUT });
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
  loadInstance: ([host]) => loadInstance(host),
  loadTimeline: async ([host]) => {
    if (feed.host !== host) feed = { host, posts: [], hasNext: true };
    if (feed.posts.length === 0) await append(host);
    return feed;
  },
  nextPage: async ([host]) => {
    await append(host);
    return { ok: true };
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
