const http = require('http');

function getPostId(path) {
  const match = path.match(/\/users\/posts\/bump\/(\d+)/);
  return match ? match[1] : 'unknown';
}

function getResponse(path, mode, counters) {
  const postId = getPostId(path);
  const count = (counters.get(postId) || 0) + 1;
  counters.set(postId, count);

  if (mode === 'auth') {
    return { status: 403, location: '/login' };
  }

  if (mode === 'too-early') {
    return { status: 302, location: '/users/posts/list' };
  }

  if (mode === 'alternate' && count % 2 === 0) {
    return { status: 302, location: '/users/posts/list' };
  }

  return { status: 302, location: `/users/posts/list?success_publish=${postId}` };
}

function createFakeBumpServer(options = {}) {
  const mode = options.mode || process.env.FAKE_BUMP_MODE || 'success';
  const logger = options.logger || console.log;
  const counters = new Map();

  return http.createServer((req, res) => {
    const response = getResponse(req.url || '/', mode, counters);
    const postId = getPostId(req.url || '/');

    logger(
      JSON.stringify({
        at: new Date().toISOString(),
        method: req.method,
        path: req.url,
        postId,
        originalHost: req.headers['x-original-host'] || null,
        testMode: req.headers['x-megamind-test-mode'] === '1',
        response
      })
    );

    res.writeHead(response.status, {
      Location: response.location,
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify({ ok: true, postId, mode, response }));
  });
}

if (require.main === module) {
  const port = Number(process.env.FAKE_BUMP_PORT || 3998);
  const server = createFakeBumpServer();

  server.listen(port, '127.0.0.1', () => {
    console.log(`Fake bump server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { createFakeBumpServer };
