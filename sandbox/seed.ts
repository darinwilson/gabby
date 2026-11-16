// The sandbox's accounts and posts. Every account signs in with PASSWORD.
import { deflateSync } from 'node:zlib';

export const PASSWORD = 'gabby sandbox password 2026';

type Account = {
  username: string;
  name: string;
  note: string;
  fields?: [string, string][];
  colors: [number, number]; // avatar, header: 0xRRGGBB
  admin?: boolean;
  locked?: boolean;
};

export const ACCOUNTS: Account[] = [
  {
    username: 'alice',
    name: 'Alice Abernathy',
    note: 'Runs this sandbox. Writes about #gardening and #sandbox life.',
    fields: [['Website', 'https://example.com/alice'], ['Pronouns', 'she/her']],
    colors: [0xd9534f, 0x5bc0de],
    admin: true,
  },
  {
    username: 'bob',
    name: 'Bob Brightwater',
    note: 'Photographer. Boosts what he likes.',
    fields: [['Portfolio', 'https://example.com/bob']],
    colors: [0x5cb85c, 0xf0ad4e],
  },
  {
    username: 'carol',
    name: 'Carol 🌻 Castellanos',
    note: 'Long posts, polls and the occasional content warning.',
    colors: [0x9b59b6, 0x34495e],
  },
  {
    username: 'dave',
    name: '',
    note: 'No display name, lots of posts.',
    colors: [0x1abc9c, 0xecf0f1],
  },
  {
    username: 'erin',
    name: 'Erin Quietly',
    note: 'A locked account with nothing posted.',
    colors: [0x7f8c8d, 0x2c3e50],
    locked: true,
  },
];

type Post = {
  key?: string;
  by: string;
  text: string;
  visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  replyTo?: string;
  spoiler?: string;
  image?: { color: number; alt: string };
  poll?: string[];
};

// In posting order: the newest is last.
const POSTS: Post[] = [
  { key: 'welcome', by: 'alice', text: 'Welcome to the Gabby sandbox! Everything here is test data. #sandbox' },
  { by: 'bob', text: 'First light over the harbour this morning.', image: { color: 0xf4a261, alt: 'An orange square standing in for a sunrise photo.' } },
  { by: 'carol', text: 'A post\nwith line breaks\n\nand a blank line between paragraphs.' },
  { by: 'alice', text: 'Tomatoes are finally ripening 🍅 #gardening #summer' },
  { key: 'thread', by: 'carol', text: 'What should the sandbox test next? Replies welcome. #sandbox' },
  { key: 'reply1', by: 'bob', replyTo: 'thread', text: '@carol Post views with long reply threads.' },
  { by: 'alice', replyTo: 'reply1', text: '@bob @carol Agreed, and profile pages.' },
  { by: 'dave', replyTo: 'thread', text: '@carol Media attachments, definitely.' },
  { by: 'carol', replyTo: 'thread', text: 'Thanks all, noted! (a self-reply continues the thread)' },
  { by: 'carol', text: 'Plot details for the book club below.', spoiler: 'Spoilers: chapter 12' },
  { by: 'carol', text: 'Which timeline do you open first?', poll: ['Home', 'Local', 'A hashtag'] },
  { by: 'bob', text: 'Two from the archive.', image: { color: 0x2a9d8f, alt: 'A teal square standing in for a photo.' } },
  { by: 'alice', text: 'Read the docs at https://docs.joinmastodon.org/ and https://gotosocial.org/ #mastodon' },
  { by: 'bob', text: 'Unlisted: shows on my profile but not on public timelines.', visibility: 'unlisted' },
  { by: 'alice', text: 'Followers only: a private post for the people who follow me.', visibility: 'private' },
  { by: 'carol', text: '@alice A direct message, visible only to the two of us.', visibility: 'direct' },
  { key: 'pinned', by: 'alice', text: 'Pinned: the sandbox resets whenever someone runs sandbox-reset, so post freely. #sandbox' },
  { by: 'carol', text: 'A long post to see how wrapping looks. '.repeat(12).trim() },
  { by: 'bob', text: 'Hashtag case test: #Photography #photography #PHOTOGRAPHY' },
  ...Array.from({ length: 25 }, (_, i) => ({ by: 'dave', text: `Counting post ${i + 1} of 25, enough to page through the timeline. #counting` })),
  { key: 'latest', by: 'alice', text: 'The newest post in the sandbox. Hello from the top of the timeline!' },
];

const FOLLOWS: [string, string][] = [
  ['alice', 'bob'], ['alice', 'carol'], ['alice', 'dave'],
  ['bob', 'alice'], ['bob', 'carol'],
  ['carol', 'alice'], ['carol', 'bob'],
  ['dave', 'alice'],
  // erin is locked, so this stays a pending follow request.
  ['dave', 'erin'],
];
const BOOSTS: [string, string][] = [['bob', 'welcome'], ['carol', 'welcome'], ['alice', 'thread'], ['bob', 'latest']];
const FAVOURITES: [string, string][] = [['bob', 'welcome'], ['carol', 'welcome'], ['dave', 'welcome'], ['alice', 'reply1'], ['carol', 'latest']];
const PINS = ['pinned', 'welcome'];

// A solid-colour PNG, enough for avatars, headers and attachments.
function png(width: number, height: number, color: number): Blob {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([color >> 16, (color >> 8) & 0xff, color & 0xff], 1 + x * 3);
  const pixels = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) pixels.set(row, y * row.length);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array())], { type: 'image/png' });
}

const OOB = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPES = 'read write follow';

async function check(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

// Signs in through GoToSocial's own pages, as a person in a browser would:
// it has no password grant.
async function token(base: string, client: { client_id: string; client_secret: string }, email: string): Promise<string> {
  const cookies = new Map<string, string>();
  const step = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      redirect: 'manual',
      headers: { ...init.headers, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const at = pair.indexOf('=');
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  };
  const query = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: OOB, scope: SCOPES });
  await step(`/oauth/authorize?${query}`);
  const signIn = await step('/auth/sign_in', { method: 'POST', body: new URLSearchParams({ username: email, password: PASSWORD }) });
  if (signIn.status !== 302) throw new Error(`signing in ${email}: HTTP ${signIn.status}`);
  await step('/oauth/authorize');
  const approved = await step('/oauth/authorize', { method: 'POST', body: new URLSearchParams() });
  const code = new URL(approved.headers.get('location') ?? '', base).searchParams.get('code');
  if (!code) throw new Error(`authorizing ${email}: HTTP ${approved.status}, no code`);
  const response = await check(await fetch(`${base}/oauth/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code, ...client, redirect_uri: OOB }),
  }), `token for ${email}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function seed(base: string, gts: (...args: string[]) => Promise<void>) {
  console.log('sandbox: creating accounts');
  for (const account of ACCOUNTS) {
    await gts('admin', 'account', 'create', '--username', account.username, '--email', `${account.username}@example.test`, '--password', PASSWORD);
    if (account.admin) await gts('admin', 'account', 'promote', '--username', account.username);
  }

  const client = (await (await check(await fetch(`${base}/api/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Gabby sandbox seed', redirect_uris: OOB, scopes: SCOPES }),
  }), 'registering the seed client')).json()) as { client_id: string; client_secret: string };

  const tokens = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) tokens.set(account.username, await token(base, client, `${account.username}@example.test`));

  const api = async (as: string, method: string, path: string, body?: object | FormData) => {
    const json = body && !(body instanceof FormData);
    const response = await check(await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens.get(as)}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(body) : body,
    }), `${as} ${method} ${path}`);
    return response.json() as Promise<{ id: string }>;
  };

  console.log('sandbox: filling in profiles');
  for (const account of ACCOUNTS) {
    const form = new FormData();
    form.set('display_name', account.name);
    form.set('note', account.note);
    form.set('locked', String(account.locked ?? false));
    form.set('avatar', png(400, 400, account.colors[0]), 'avatar.png');
    form.set('header', png(1500, 500, account.colors[1]), 'header.png');
    (account.fields ?? []).forEach(([name, value], i) => {
      form.set(`fields_attributes[${i}][name]`, name);
      form.set(`fields_attributes[${i}][value]`, value);
    });
    const me = await api(account.username, 'PATCH', '/api/v1/accounts/update_credentials', form);
    ids.set(account.username, me.id);
  }

  for (const [follower, followed] of FOLLOWS) await api(follower, 'POST', `/api/v1/accounts/${ids.get(followed)}/follow`);

  console.log(`sandbox: posting ${POSTS.length} statuses`);
  const statuses = new Map<string, string>();
  for (const post of POSTS) {
    const mediaIds: string[] = [];
    if (post.image) {
      const form = new FormData();
      form.set('file', png(1200, 800, post.image.color), 'photo.png');
      form.set('description', post.image.alt);
      mediaIds.push((await api(post.by, 'POST', '/api/v2/media', form)).id);
    }
    const status = await api(post.by, 'POST', '/api/v1/statuses', {
      status: post.text,
      visibility: post.visibility ?? 'public',
      in_reply_to_id: post.replyTo ? statuses.get(post.replyTo) : undefined,
      spoiler_text: post.spoiler,
      sensitive: post.spoiler ? true : undefined,
      media_ids: mediaIds.length ? mediaIds : undefined,
      poll: post.poll ? { options: post.poll, expires_in: 30 * 24 * 3600 } : undefined,
    });
    if (post.key) statuses.set(post.key, status.id);
  }

  for (const [who, key] of BOOSTS) await api(who, 'POST', `/api/v1/statuses/${statuses.get(key)}/reblog`);
  for (const [who, key] of FAVOURITES) await api(who, 'POST', `/api/v1/statuses/${statuses.get(key)}/favourite`);
  for (const key of PINS) await api(POSTS.find((p) => p.key === key)!.by, 'POST', `/api/v1/statuses/${statuses.get(key)}/pin`);
  console.log('sandbox: seeded');
}
