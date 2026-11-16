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
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

const POSTS: Record<string, { text: (host: string) => string; parent?: string; by?: (host: string) => ReturnType<typeof LIN> }> = {
  '1': { text: () => 'An older public post' },
  '2': { text: (host) => `A public post <a href="https://${host}/tags/birds" class="mention hashtag" rel="tag">#<span>birds</span></a>` },
  'c1': { text: () => 'A reply', parent: '2' },
  'c2': { text: () => 'A reply to the reply', parent: 'c1' },
  'h1': { text: () => 'A post from someone you follow' },
  'b1': { text: () => 'A post someone you follow boosted' },
  'l1': { text: () => 'A post from a locked account', by: LIN },
  'm1': { text: () => 'A post of your own', by: () => ME },
};
const post = (id: string, host: string) => status(id, host, POSTS[id].text(host), POSTS[id].by?.(host));
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

const MEDIA = (id: string, host: string) => ({
  id,
  type: 'image',
  url: `http://127.0.0.1:${port}/${host}/media/${id}.png`,
  preview_url: `http://127.0.0.1:${port}/${host}/media/${id}.png`,
  description: null,
});

const authorized = (req: Request) => req.headers.get('Authorization') === `Bearer ${TOKEN}`;
const unauthorized = () => json({ error: 'The access token is invalid' }, 401);

// Writes to statuses keep no state; each answers with the status as it would look afterwards.
async function write(req: Request, host: string, route: string) {
  if (route === 'POST /api/v1/statuses') {
    const body = req.headers.get('Content-Type')?.includes('json')
      ? await req.json()
      : Object.fromEntries(await req.formData());
    if (!body.status && !(body.media_ids ?? []).length) return json({ error: "Validation failed: Text can't be blank" }, 422);
    const media = [body['media_ids[]'] ?? body.media_ids ?? []].flat().map((id: string) => MEDIA(id, host));
    return json({ ...status('new', host, String(body.status ?? '').replace(/\n/g, '<br>'), ME), visibility: body.visibility ?? 'public', media_attachments: media });
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
      return json(MEDIA('m1', host));
    }
    if (route.startsWith('GET /media/')) return new Response(Bun.file(new URL('../assets/icon.png', import.meta.url)), { headers: CORS });
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
        return json({ title: TITLES[host], description: `${TITLES[host]}, served by the fixture.`, thumbnail: { url: '' } });
      case 'GET /api/v1/timelines/public':
        return json(firstPage ? [
          post('2', host),
          post('1', host),
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
