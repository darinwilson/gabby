// A stand-in for the Mastodon servers the tests name, each under /<host>.
// Tests reach it through `--backend`, which app.ts maps every server onto.
const port = Number(process.env.PORT ?? 4790);

const TITLES: Record<string, string> = {
  'fosstodon.org': 'Fosstodon',
  'mastodon.social': 'Mastodon',
  'mastodon.art': 'Mastodon.ART',
  'hachyderm.io': 'Hachyderm',
};
const TOKEN = 'fixture-token';
const ME = { id: 'me', username: 'darin', acct: 'darin', display_name: 'Darin', avatar: '' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

// An hour before the tests' clock starts, so every post reads "1h".
const POSTED = '2025-12-31T23:00:00.000Z';

const status = (id: string, host: string, text: string, account = { id: 'ada', username: 'ada', acct: `ada@${host}`, display_name: 'Ada', avatar: '' }) => ({
  id,
  created_at: POSTED,
  visibility: 'public',
  content: `<p>${text}</p>`,
  replies_count: 10,
  reblogs_count: 6,
  favourites_count: 1,
  favourited: false,
  reblogged: false,
  reblog: null as unknown,
  account,
});

const boost = (id: string, host: string, original: ReturnType<typeof status>) =>
  ({ ...status(id, host, '', { id: 'grace', username: 'grace', acct: `grace@${host}`, display_name: 'Grace', avatar: '' }), reblog: original });

// Posts a test can open, each with the post it replies to.
const LIN = (host: string) => ({ id: 'lin', username: 'lin', acct: `lin@${host}`, display_name: 'Lin', avatar: '' });

// A file in a post, served from fixture/media by its extension.
const FILE = (host: string, id: string, type: string, ext: string, description: string | null = null, width = 640, height = 400) => ({
  id,
  type,
  url: `http://127.0.0.1:${port}/${host}/media/${id}.${ext}`,
  preview_url: `http://127.0.0.1:${port}/${host}/media/${id}.jpg`,
  remote_url: null,
  description,
  meta: { original: { width, height, aspect: width / height } },
});

type Spec = {
  text: (host: string) => string;
  parent?: string;
  by?: (host: string) => ReturnType<typeof LIN>;
  mentions?: (host: string) => { id: string; acct: string }[];
  visibility?: string;
  media?: (host: string) => object[];
  sensitive?: boolean;
  card?: (host: string) => object;
};

const POSTS: Record<string, Spec> = {
  '1': { text: () => 'An older public post' },
  '2': { text: (host) => `A public post <a href="https://${host}/tags/birds" class="mention hashtag" rel="tag">#<span>birds</span></a>` },
  'c1': { text: () => 'A reply', parent: '2' },
  'c2': { text: () => 'A reply to the reply', parent: 'c1' },
  'h1': { text: () => 'A post from someone you follow', mentions: (host) => [{ id: 'grace', acct: `grace@${host}` }, { id: 'me', acct: 'darin' }] },
  'b1': { text: () => 'A post someone you follow boosted' },
  'l1': { text: () => 'A post from a locked account', by: LIN, visibility: 'private' },
  'm1': { text: () => 'A post of your own', by: () => ME },
  'p3': {
    text: () => 'Two pictures',
    media: (host) => [FILE(host, 'g1', 'image', 'jpg', 'A test pattern in bright colours'), FILE(host, 'g2', 'image', 'jpg')],
    card: () => ({ url: 'https://example.com/pictures', title: 'Pictures', description: '', image: null, provider_name: 'Example' }),
  },
  'f1': { text: () => 'A GIF', media: (host) => [FILE(host, 'f1', 'gifv', 'mp4', null, 320, 180)] },
  // A remote file the server didn't fetch, and an upload still processing.
  'u1': {
    text: () => 'A file from another server',
    media: (host) => [
      { ...FILE(host, 'u1', 'unknown', 'jpg'), url: null, preview_url: null, remote_url: 'https://elsewhere.example/files/u1.tiff', meta: null },
      { ...FILE(host, 'u2', 'image', 'jpg'), url: null },
    ],
  },
  // Cards as other fediverse servers send them: null fields, and a URL that doesn't parse.
  'x1': { text: () => 'A bare link', card: () => ({ url: 'https://example.com/bare', title: null, description: null, image: null, provider_name: '' }) },
  'x2': { text: () => 'A broken link', card: () => ({ url: 'https://', title: 'Broken', description: '', image: null, provider_name: '' }) },
  'v1': { text: () => 'A video', media: (host) => [FILE(host, 'v1', 'video', 'mp4', 'A test pattern that moves', 320, 180)] },
  'a1': { text: () => 'A sound', media: (host) => [{ ...FILE(host, 'a1', 'audio', 'm4a', 'A 440 Hz tone'), meta: null }] },
  'k1': {
    text: () => 'Reading <a href="https://example.com/birds" rel="nofollow noopener" target="_blank"><span class="invisible">https://</span><span class="">example.com/birds</span></a>',
    card: (host) => ({
      url: 'https://example.com/birds',
      title: 'A field guide to garden birds',
      description: 'Twelve birds you can see from your window, and how to tell them apart.',
      image: `http://127.0.0.1:${port}/${host}/media/card.jpg`,
      provider_name: 'Example Field Guides',
    }),
  },
  's1': { text: () => 'A picture marked sensitive', sensitive: true, media: (host) => [FILE(host, 's1', 'image', 'jpg', 'A test pattern')] },
  's2': {
    text: () => 'A sensitive link',
    sensitive: true,
    card: (host) => ({ url: 'https://example.com/s2', title: 'Sensitive', description: '', image: `http://127.0.0.1:${port}/${host}/media/card.jpg`, provider_name: 'Example' }),
  },
};
const post = (id: string, host: string) => ({
  ...status(id, host, POSTS[id].text(host), POSTS[id].by?.(host)),
  visibility: POSTS[id].visibility ?? 'public',
  mentions: POSTS[id].mentions?.(host) ?? [],
  media_attachments: POSTS[id].media?.(host) ?? [],
  sensitive: POSTS[id].sensitive ?? false,
  card: POSTS[id].card?.(host) ?? null,
});
const ancestors = (id: string): string[] => {
  const parent = POSTS[id].parent;
  return parent ? [...ancestors(parent), parent] : [];
};
const descendants = (id: string) => Object.keys(POSTS).filter((other) => ancestors(other).includes(id));

// Who the signed-in account follows or has asked to follow. The fixture restarts for each
// test, so this starts empty every time.
const following = new Set<string>();
const requested = new Set<string>();

// Ada's profile, as her own server describes her (so her acct has no domain).
const ADA = (host: string) => ({
  id: 'ada',
  username: 'ada',
  acct: 'ada',
  display_name: 'Ada',
  avatar: '',
  header: `https://${host}/headers/original/missing.png`,
  note: `<p>Writes about <a href="https://${host}/tags/birds" class="mention hashtag" rel="tag">#<span>birds</span></a></p>`,
  fields: [{ name: 'Website', value: '<a href="https://ada.example" rel="me nofollow noopener noreferrer" target="_blank"><span class="invisible">https://</span><span class="">ada.example</span></a>' }],
  followers_count: 120 + Number(following.has('ada')),
  following_count: 45,
  statuses_count: 2,
});

// Lin approves followers and has no posts or bio; the profile of whoever signed in is Darin's.
const PROFILES: Record<string, (host: string) => object> = {
  ada: ADA,
  lin: (host) => ({ ...LIN(host), acct: 'lin', locked: true, header: '', note: '', fields: [], followers_count: 3, following_count: 1, statuses_count: 0 }),
  me: () => ({ ...ME, header: '', note: '', fields: [], followers_count: 0, following_count: 1, statuses_count: 1 }),
};
const PROFILE_POSTS: Record<string, string[]> = { ada: ['2', '1'], lin: [], me: ['m1'] };

const MEDIA = (id: string, host: string, type = 'image') => ({
  id,
  type,
  url: `http://127.0.0.1:${port}/${host}/media/${id}.png`,
  preview_url: type === 'image' ? `http://127.0.0.1:${port}/${host}/media/${id}.png` : null,
  description: null,
});

// Uploaded media not yet in a post, by id. An id is the lowest free one, so a test's ids are known.
const unattached = new Map<string, { type: string; checks: number }>();
const freeMediaId = () => {
  for (let n = 1; ; n++) if (!unattached.has(`m${n}`)) return `m${n}`;
};
const VISIBILITIES = ['public', 'unlisted', 'private', 'direct'];

const authorized = (req: Request) => req.headers.get('Authorization') === `Bearer ${TOKEN}`;
const unauthorized = () => json({ error: 'The access token is invalid' }, 401);

// Writes to statuses keep no state; each answers with the status as it would look afterwards.
async function write(req: Request, host: string, route: string) {
  if (route === 'POST /api/v1/statuses') {
    const body = req.headers.get('Content-Type')?.includes('json')
      ? await req.json()
      : Object.fromEntries(await req.formData());
    const ids: string[] = [body['media_ids[]'] ?? body.media_ids ?? []].flat();
    const text = String(body.status ?? '');
    if (!text && !ids.length) return json({ error: "Validation failed: Text can't be blank" }, 422);
    if ([...text].length > 500) return json({ error: 'Validation failed: Text character limit of 500 exceeded' }, 422);
    if (body.visibility && !VISIBILITIES.includes(body.visibility)) return json({ error: 'Validation failed: Visibility is not included in the list' }, 422);
    if (ids.some((id) => !unattached.has(id))) return json({ error: 'Validation failed: Media is not found' }, 422);
    if (ids.some((id) => unattached.get(id)!.checks < 1 && unattached.get(id)!.type !== 'image')) return json({ error: 'Cannot attach files that have not finished processing. Try again in a moment!' }, 422);
    const media = ids.map((id) => MEDIA(id, host, unattached.get(id)!.type));
    for (const id of ids) unattached.delete(id);
    return json({
      ...status('new', host, text.replace(/\n/g, '<br>'), ME),
      visibility: body.visibility ?? 'public',
      in_reply_to_id: body.in_reply_to_id ?? null,
      replies_count: 0,
      reblogs_count: 0,
      favourites_count: 0,
      media_attachments: media,
    });
  }
  const match = route.match(/^(POST|DELETE) \/api\/v1\/statuses\/([^/]+)(?:\/(\w+))?$/);
  if (!match) return null;
  const [, method, id, action] = match;
  const target = status(id, host, 'A post');
  if (method === 'DELETE' && !action) return json(target);
  switch (method === 'POST' && action) {
    case 'favourite': return json({ ...target, favourited: true, favourites_count: target.favourites_count + 1 });
    case 'unfavourite': return json(target);
    case 'reblog': return json({ ...status(`r${id}`, host, '', ME), reblog: { ...target, reblogged: true, reblogs_count: target.reblogs_count + 1 }, reblogged: true });
    case 'unreblog': return json(target);
  }
  return null;
}

Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const [, host, ...rest] = url.pathname.split('/');
    const route = `${req.method} /${rest.join('/')}`;
    if (!(host in TITLES)) return json({ error: 'Not found' }, 404);
    const firstPage = !url.searchParams.has('max_id');
    if (req.method !== 'GET' && route.startsWith('/api/v1/statuses', req.method.length + 1)) {
      if (!authorized(req)) return unauthorized();
      const response = await write(req, host, route);
      if (response) return response;
    }
    if (route === 'GET /api/v1/accounts/relationships') {
      if (!authorized(req)) return unauthorized();
      return json(url.searchParams.getAll('id[]').map((id) => ({ id, following: following.has(id), requested: requested.has(id) })));
    }
    const follow = route.match(/^POST \/api\/v1\/accounts\/([^/]+)\/(follow|unfollow)$/);
    if (follow) {
      if (!authorized(req)) return unauthorized();
      const [, id, verb] = follow;
      following.delete(id);
      requested.delete(id);
      if (verb === 'follow') (id === 'lin' ? requested : following).add(id);
      return json({ id, following: following.has(id), requested: requested.has(id) });
    }
    const account = route.match(/^GET \/api\/v1\/accounts\/([^/]+)(\/statuses)?$/);
    if (account && account[1] !== 'verify_credentials') {
      const id = account[1];
      if (!(id in PROFILES)) return json({ error: 'Record not found' }, 404);
      if (!account[2]) return json(PROFILES[id](host));
      if (url.searchParams.get('pinned') === 'true') return json(id === 'ada' ? [post('1', host)] : []);
      return json(firstPage ? PROFILE_POSTS[id].map((p) => post(p, host)) : []);
    }
    if (route === 'POST /api/v2/media') {
      if (!authorized(req)) return unauthorized();
      const file = (await req.formData()).get('file');
      if (!(file instanceof Blob) || file.size === 0) return json({ error: 'Validation failed: File is missing' }, 422);
      const id = freeMediaId();
      const type = /^(video|audio)\//.test(file.type) ? file.type.split('/')[0] : file.type.startsWith('image/') ? 'image' : 'unknown';
      unattached.set(id, { type, checks: 0 });
      // As Mastodon does, video and audio are processed after the reply: 202 with no url yet.
      if (type === 'image') return json(MEDIA(id, host));
      return json({ ...MEDIA(id, host, type), url: null }, 202);
    }
    const media = route.match(/^(GET|DELETE) \/api\/v1\/media\/([^/]+)$/);
    if (media) {
      if (!authorized(req)) return unauthorized();
      const kept = unattached.get(media[2]);
      if (!kept) return json({ error: 'Record not found' }, 404);
      if (media[1] === 'DELETE') {
        unattached.delete(media[2]);
        return json(MEDIA(media[2], host, kept.type));
      }
      // Still processing on the first check.
      if (kept.checks++ < 1) return json({ ...MEDIA(media[2], host, kept.type), url: null }, 206);
      return json(MEDIA(media[2], host, kept.type));
    }
    if (route.startsWith('GET /media/')) {
      const ext = route.match(/\.(jpg|mp4|m4a)$/)?.[1];
      const file = ext ? `media/sample.${ext}` : '../assets/icon.png';
      return new Response(Bun.file(new URL(file, import.meta.url)), { headers: CORS });
    }
    const read = route.match(/^GET \/api\/v1\/statuses\/([^/]+)(\/context)?$/);
    if (read) {
      const [, id, context] = read;
      if (!(id in POSTS)) return json({ error: 'Record not found' }, 404);
      return json(context
        ? { ancestors: ancestors(id).map((a) => post(a, host)), descendants: descendants(id).map((d) => post(d, host)) }
        : post(id, host));
    }
    switch (route) {
      case 'GET /api/v1/instance':
        return json({ uri: host, version: '4.3.0' });
      case 'GET /api/v2/instance':
        return json({
          title: TITLES[host],
          description: `${TITLES[host]}, served by the fixture.`,
          thumbnail: { url: '' },
          configuration: { statuses: { max_characters: 500, max_media_attachments: 4, characters_reserved_per_url: 23 } },
        });
      case 'GET /api/v1/timelines/public':
        return json(firstPage ? [
          post('2', host),
          post('1', host),
          post('p3', host),
          post('v1', host),
          post('a1', host),
          post('k1', host),
          post('s1', host),
          post('f1', host),
          post('u1', host),
          post('x1', host),
          post('x2', host),
          post('s2', host),
          boost('bp3', host, post('p3', host)),
        ] : []);
      case 'GET /api/v1/timelines/tag/birds':
        return json(firstPage ? [status('t1', host, 'A post about birds')] : []);
      case 'GET /api/v1/timelines/home':
        if (!authorized(req)) return unauthorized();
        return json(firstPage ? [
          post('h1', host),
          boost('h2', host, post('b1', host)),
          post('l1', host),
          post('m1', host),
        ] : []);
      case 'GET /api/v1/accounts/verify_credentials':
        if (!authorized(req)) return unauthorized();
        return json(ME);
      case 'POST /api/v1/apps':
        return json({ client_id: 'fixture-client', client_secret: 'fixture-secret' });
      case 'GET /oauth/authorize': {
        const back = new URL(url.searchParams.get('redirect_uri') ?? '');
        back.searchParams.set('code', 'fixture-code');
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        return new Response(null, { status: 302, headers: { Location: back.href } });
      }
      case 'POST /oauth/token':
        return json({ access_token: TOKEN, token_type: 'Bearer', scope: 'read write', created_at: 0 });
      case 'POST /oauth/revoke':
        return json({});
      default:
        return json({ error: 'Not found' }, 404);
    }
  },
});
