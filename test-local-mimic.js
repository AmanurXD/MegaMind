const { spawn } = require('child_process');
const http = require('http');
const { createFakeBumpServer } = require('./fake-bump-server');

const fakePort = 3998;
const healthPort = 3999;

function toBase64(value) {
  return Buffer.from(value.trim(), 'utf8').toString('base64');
}

function createRawRequest(postId, city) {
  return `
GET /users/posts/bump/${postId} HTTP/2
Host: local-megamind-mimic.test
Cookie: test_session=${city}; city=${city}
User-Agent: MegaMindLocalMimic/1.0
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

async function main() {
  const fakeLogs = [];
  const fakeServer = createFakeBumpServer({
    mode: 'success',
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
      MEGAMIND_TEST_PORT: String(fakePort),
      PORT: String(healthPort),
      SUCCESS_COOLDOWN_MS: '150',
      RETRY_MS: '100',
      NETWORK_ERROR_RETRY_MS: '100',
      REQUEST_TIMEOUT_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const workerOutput = [];
  worker.stdout.on('data', (chunk) => workerOutput.push(chunk.toString()));
  worker.stderr.on('data', (chunk) => workerOutput.push(chunk.toString()));

  try {
    await wait(900);
    const health = await getJson(`http://127.0.0.1:${healthPort}/`);
    const seenPostIds = [...new Set(fakeLogs.map((entry) => entry.postId))].sort();
    const expectedPostIds = ['51320130', '51742976'];

    if (JSON.stringify(seenPostIds) !== JSON.stringify(expectedPostIds)) {
      throw new Error(`Expected fake server to see both posts. Saw: ${seenPostIds.join(', ')}`);
    }

    if (health.postCount !== 2) {
      throw new Error(`Expected health endpoint to report 2 posts. Got: ${health.postCount}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          testedAgainst: 'local fake server only',
          fakeHost: 'local-megamind-mimic.test',
          seenPostIds,
          attempts: fakeLogs.length,
          healthPhase: health.phase
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
