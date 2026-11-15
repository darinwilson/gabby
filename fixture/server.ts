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
const ME = { username: 'darin', acct: 'darin', display_name: 'Darin', avatar: '' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const status = (id: string, host: string, text: string) => ({
  id,
  content: `<p>${text}</p>`,
  reblog: null,
  account: { username: 'ada', acct: `ada@${host}`, display_name: 'Ada', avatar: '' },
});

const authorized = (req: Request) => req.headers.get('Authorization') === `Bearer ${TOKEN}`;
const unauthorized = () => json({ error: 'The access token is invalid' }, 401);

// Writes keep no state, since the server is shared by every test; each answers with the
// status as it would look afterwards.
async function write(req: Request, host: string, route: string) {
  if (route === 'POST /api/v1/statuses') {
    const body = req.headers.get('Content-Type')?.includes('json')
      ? await req.json()
      : Object.fromEntries(await req.formData());
    if (!body.status) return json({ error: "Validation failed: Text can't be blank" }, 422);
    return json({ ...status('new', host, body.status), account: ME });
  }
  const match = route.match(/^(POST|DELETE) \/api\/v1\/statuses\/([^/]+)(?:\/(\w+))?$/);
  if (!match) return null;
  const [, method, id, action] = match;
  const target = status(id, host, 'A post');
  if (method === 'DELETE' && !action) return json(target);
  switch (method === 'POST' && action) {
    case 'favourite': return json({ ...target, favourited: true });
    case 'unfavourite': return json({ ...target, favourited: false });
    case 'reblog': return json({ ...status(`r${id}`, host, ''), account: ME, reblog: { ...target, reblogged: true }, reblogged: true });
    case 'unreblog': return json({ ...target, reblogged: false });
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
    switch (route) {
      case 'GET /api/v1/instance':
        return json({ uri: host, version: '4.3.0' });
      case 'GET /api/v2/instance':
        return json({ title: TITLES[host], description: `${TITLES[host]}, served by the fixture.`, thumbnail: { url: '' } });
      case 'GET /api/v1/timelines/public':
        return json(firstPage ? [
          status('2', host, `A public post <a href="https://${host}/tags/birds" class="mention hashtag" rel="tag">#<span>birds</span></a>`),
          status('1', host, 'An older public post'),
        ] : []);
      case 'GET /api/v1/timelines/tag/birds':
        return json(firstPage ? [status('t1', host, 'A post about birds')] : []);
      case 'GET /api/v1/timelines/home':
        if (!authorized(req)) return unauthorized();
        return json(firstPage ? [status('h1', host, 'A post from someone you follow')] : []);
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
        return json({ access_token: TOKEN, token_type: 'Bearer', scope: 'read', created_at: 0 });
      case 'POST /oauth/revoke':
        return json({});
      default:
        return json({ error: 'Not found' }, 404);
    }
  },
});
