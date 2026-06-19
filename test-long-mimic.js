const { spawn } = require('child_process');
const http = require('http');
const { createFakeBumpServer } = require('./fake-bump-server');

const DEFAULT_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_SUCCESS_COOLDOWN_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_MS = 5 * 1000;
const DEFAULT_FAKE_PORT = 3998;
const DEFAULT_HEALTH_PORT = 3999;

function readNumberEnv(name, fallback) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number. Received: ${value}`);
  }

  return parsed;
}

function toBase64(value) {
  return Buffer.from(value.trim(), 'utf8').toString('base64');
}

function createRawRequest(postId, city) {
  return `
GET /users/posts/bump/${postId} HTTP/2
Host: local-megamind-mimic.test
Cookie: test_session=${city}; city=${city}
User-Agent: MegaMindLongMimic/1.0
Accept: text/html
Referer: http://local-megamind-mimic.test/users/posts/list
`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

function countAttempts(fakeLogs) {
  return fakeLogs.reduce((summary, entry) => {
    summary[entry.postId] = (summary[entry.postId] || 0) + 1;
    return summary;
  }, {});
}

function assertFakeOnly(fakeLogs) {
  for (const entry of fakeLogs) {
    if (!entry.testMode || entry.originalHost !== 'local-megamind-mimic.test') {
      throw new Error(
        `Unexpected non-fake request observed: ${JSON.stringify(entry)}`
      );
    }
  }
}

async function main() {
  const durationMs = readNumberEnv('LONG_TEST_DURATION_MS', DEFAULT_DURATION_MS);
  const successCooldownMs = readNumberEnv(
    'LONG_TEST_SUCCESS_COOLDOWN_MS',
    DEFAULT_SUCCESS_COOLDOWN_MS
  );
  const retryMs = readNumberEnv('LONG_TEST_RETRY_MS', DEFAULT_RETRY_MS);
  const fakePort = readNumberEnv('LONG_TEST_FAKE_PORT', DEFAULT_FAKE_PORT);
  const healthPort = readNumberEnv('LONG_TEST_HEALTH_PORT', DEFAULT_HEALTH_PORT);
  const expectedPostIds = ['51320130', '51742976'];
  const fakeLogs = [];

  const fakeServer = createFakeBumpServer({
    mode: process.env.LONG_TEST_FAKE_MODE || 'success',
    logger: (line) => fakeLogs.push(JSON.parse(line))
  });

  await new Promise((resolve) => fakeServer.listen(fakePort, '127.0.0.1', resolve));

  const worker = spawn(process.execPath, ['megamind.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      RAW_REQUEST_1_BASE64: toBase64(createRawRequest('51742976', 'city-one')),
      RAW_REQUEST_2_BASE64: toBase64(createRawRequest('51320130', 'city-two')),
      MEGAMIND_TEST_MODE: '1',
      MEGAMIND_TEST_HOST: '127.0.0.1',
      MEGAMIND_TEST_PORT: String(fakePort),
      PORT: String(healthPort),
      SUCCESS_COOLDOWN_MS: String(successCooldownMs),
      RETRY_MS: String(retryMs),
      NETWORK_ERROR_RETRY_MS: String(retryMs),
      REQUEST_TIMEOUT_MS: '30000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const workerOutput = [];
  worker.stdout.on('data', (chunk) => workerOutput.push(chunk.toString()));
  worker.stderr.on('data', (chunk) => workerOutput.push(chunk.toString()));

  try {
    console.log(
      JSON.stringify(
        {
          started: true,
          fakeOnly: true,
          durationMs,
          successCooldownMs,
          fakeHost: 'local-megamind-mimic.test',
          fakeServer: `http://127.0.0.1:${fakePort}`,
          health: `http://127.0.0.1:${healthPort}`
        },
        null,
        2
      )
    );

    await wait(durationMs);
    const health = await getJson(`http://127.0.0.1:${healthPort}/`);
    assertFakeOnly(fakeLogs);

    const attemptsByPost = countAttempts(fakeLogs);
    const seenPostIds = Object.keys(attemptsByPost).sort();

    for (const postId of expectedPostIds) {
      if (!seenPostIds.includes(postId)) {
        throw new Error(`Expected post ${postId} to be bumped by the fake server test.`);
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          testedAgainst: 'local fake server only',
          fakeHost: 'local-megamind-mimic.test',
          durationMs,
          successCooldownMs,
          attempts: fakeLogs.length,
          attemptsByPost,
          healthPhase: health.phase,
          healthPosts: health.posts
        },
        null,
        2
      )
    );
  } finally {
    worker.kill('SIGTERM');
    fakeServer.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
