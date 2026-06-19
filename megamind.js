const fs = require('fs');
const http = require('http');
const https = require('https');

const DEFAULT_SUCCESS_COOLDOWN_MS = (15 * 60 * 1000) + 10000;
const DEFAULT_RETRY_MS = 60 * 1000;
const DEFAULT_NETWORK_ERROR_RETRY_MS = 30 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_PORT = 3000;

const state = {
  phase: 'starting',
  configLoaded: false,
  activePostId: null,
  postCount: 0,
  lastSchedulerPickAt: null,
  schedulerQueue: [],
  posts: []
};

function normalizeRawRequestValue(value) {
  if (!value) {
    return '';
  }

  if (!value.includes('\n') && value.includes('\\n')) {
    return value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  }

  return value;
}

function splitMultiValue(value) {
  return (value || '')
    .split(/\r?\n|,|\|\|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRawRequests() {
  const captures = [];
  const indexedKeys = Object.keys(process.env)
    .map((key) => {
      const match = key.match(/^RAW_REQUEST_(\d+)_(BASE64|BLOB|FILE|RAW)$/);
      return match ? { key, index: Number(match[1]), type: match[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  for (const item of indexedKeys) {
    const value = process.env[item.key] || '';

    if (item.type === 'BASE64') {
      captures.push({
        source: item.key,
        raw: Buffer.from(value, 'base64').toString('utf8')
      });
      continue;
    }

    if (item.type === 'FILE') {
      captures.push({
        source: item.key,
        raw: fs.readFileSync(value, 'utf8')
      });
      continue;
    }

    captures.push({
      source: item.key,
      raw: normalizeRawRequestValue(value)
    });
  }

  for (const value of splitMultiValue(process.env.RAW_REQUESTS_BASE64)) {
    captures.push({
      source: 'RAW_REQUESTS_BASE64',
      raw: Buffer.from(value, 'base64').toString('utf8')
    });
  }

  if (captures.length > 0) {
    return captures;
  }

  if (process.env.RAW_REQUEST_BLOB) {
    return [{ source: 'RAW_REQUEST_BLOB', raw: normalizeRawRequestValue(process.env.RAW_REQUEST_BLOB) }];
  }

  if (process.env.RAW_REQUEST_BASE64) {
    return [{
      source: 'RAW_REQUEST_BASE64',
      raw: Buffer.from(process.env.RAW_REQUEST_BASE64, 'base64').toString('utf8')
    }];
  }

  if (process.env.RAW_REQUEST_FILE) {
    return [{ source: 'RAW_REQUEST_FILE', raw: fs.readFileSync(process.env.RAW_REQUEST_FILE, 'utf8') }];
  }

  return [{ source: 'RAW_REQUEST', raw: normalizeRawRequestValue(process.env.RAW_REQUEST || '') }];
}

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

function readBooleanEnv(name, fallback = false) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseRawRequest(raw) {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error(
      'No raw request was provided. Set RAW_REQUEST_1_BASE64, RAW_REQUESTS_BASE64, or RAW_REQUEST_BASE64.'
    );
  }

  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines.shift();

  if (!firstLine) {
    throw new Error('The raw request is missing the request line.');
  }

  const [method, path] = firstLine.trim().split(/\s+/);

  if (!method || !path) {
    throw new Error(`Could not parse method/path from request line: ${firstLine}`);
  }

  const pathMatch = path.match(/\/bump\/(\d+)/);
  const postId = pathMatch ? pathMatch[1] : 'UNKNOWN';

  let hostname = 'megapersonals.eu';
  const headers = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(':');

    if (colonIndex === -1) {
      continue;
    }

    const key = line.substring(0, colonIndex).trim().toLowerCase();
    const value = line.substring(colonIndex + 1).trim();

    if (!key || !value) {
      continue;
    }

    if (key === 'host') {
      hostname = value;
      continue;
    }

    headers[key] = value;
  }

  return { method, path, postId, hostname, headers };
}

function parseCookieValue(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(';').map((part) => part.trim());

  for (const part of parts) {
    const separatorIndex = part.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.substring(0, separatorIndex).trim();
    const value = part.substring(separatorIndex + 1).trim();

    if (key === name) {
      return value || null;
    }
  }

  return null;
}

function getPostLabel(capture, requestConfig) {
  const cityOverride = process.env[`CITY_${capture.index}_LABEL`];

  if (cityOverride) {
    return cityOverride;
  }

  const cityCookie = parseCookieValue(requestConfig.headers.cookie, 'city');

  if (cityCookie) {
    return `city ${cityCookie}`;
  }

  return `post ${requestConfig.postId}`;
}

function describePost(post) {
  return `${post.label} / post ${post.postId}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toLocaleString();
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function toPublicPost(post) {
  return {
    source: post.source,
    postId: post.postId,
    label: post.label,
    hostname: post.hostname,
    path: post.path,
    phase: post.phase,
    disabled: post.disabled,
    lastAttemptAt: post.lastAttemptAt,
    lastSuccessAt: post.lastSuccessAt,
    lastStatus: post.lastStatus,
    lastLocation: post.lastLocation,
    lastError: post.lastError
  };
}

function refreshPublicState(posts, schedulerQueue = []) {
  state.postCount = posts.length;
  state.posts = posts.map(toPublicPost);
  state.schedulerQueue = [...schedulerQueue];
}

function startHealthServer() {
  const port = readNumberEnv('PORT', DEFAULT_PORT);

  const server = http.createServer((req, res) => {
    const body = JSON.stringify({
      ok: true,
      service: 'megamind',
      ...state
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  });

  server.listen(port, '0.0.0.0', () => {
    log(`Health server listening on port ${port}.`);
  });

  return server;
}

function buildRequestOptions(requestConfig, requestTimeoutMs, testConfig) {
  if (!testConfig.enabled) {
    return {
      protocol: 'https:',
      hostname: requestConfig.hostname,
      port: 443,
      path: requestConfig.path,
      method: requestConfig.method,
      headers: requestConfig.headers,
      timeout: requestTimeoutMs
    };
  }

  return {
    protocol: 'http:',
    hostname: testConfig.host,
    port: testConfig.port,
    path: requestConfig.path,
    method: requestConfig.method,
    headers: {
      ...requestConfig.headers,
      host: `${testConfig.host}:${testConfig.port}`,
      'x-original-host': requestConfig.hostname,
      'x-megamind-test-mode': '1'
    },
    timeout: requestTimeoutMs
  };
}

function bumpPost(requestConfig, requestTimeoutMs, testConfig) {
  return new Promise((resolve, reject) => {
    const options = buildRequestOptions(requestConfig, requestTimeoutMs, testConfig);
    const client = options.protocol === 'http:' ? http : https;

    const req = client.request(options, (res) => {
      res.resume();
      resolve({
        status: res.statusCode || 0,
        location: res.headers.location || ''
      });
    });

    req.setTimeout(requestTimeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${requestTimeoutMs}ms`));
    });

    req.on('error', (error) => reject(error));
    req.end();
  });
}

function shuffle(values) {
  const result = [...values];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function refillSchedulerQueue(posts, lastSelectedPostId) {
  const readyPostIds = posts
    .filter((post) => !post.disabled)
    .map((post) => post.postId);

  const queue = shuffle(readyPostIds);

  if (queue.length > 1 && queue[0] === lastSelectedPostId) {
    const swapIndex = queue.findIndex((postId) => postId !== lastSelectedPostId);
    [queue[0], queue[swapIndex]] = [queue[swapIndex], queue[0]];
  }

  return queue;
}

function pickNextPost(posts, scheduler) {
  if (posts.every((post) => post.disabled)) {
    return null;
  }

  while (scheduler.queue.length > 0) {
    const postId = scheduler.queue.shift();
    const post = posts.find((item) => item.postId === postId && !item.disabled);

    if (post) {
      scheduler.lastSelectedPostId = post.postId;
      return post;
    }
  }

  scheduler.queue = refillSchedulerQueue(posts, scheduler.lastSelectedPostId);
  return pickNextPost(posts, scheduler);
}

function buildPostsFromEnv() {
  const rawCaptures = readRawRequests();
  const seenPostIds = new Set();

  return rawCaptures.map((capture, index) => {
    capture.index = index + 1;
    const requestConfig = parseRawRequest(capture.raw);

    if (requestConfig.postId === 'UNKNOWN') {
      throw new Error(`Could not parse the post ID from ${capture.source}. Expected '/users/posts/bump/<id>'.`);
    }

    if (seenPostIds.has(requestConfig.postId)) {
      throw new Error(`Duplicate post ID configured: ${requestConfig.postId}`);
    }

    seenPostIds.add(requestConfig.postId);

    return {
      source: capture.source,
      postId: requestConfig.postId,
      label: getPostLabel(capture, requestConfig),
      hostname: requestConfig.hostname,
      path: requestConfig.path,
      requestConfig,
      phase: 'ready',
      disabled: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      lastLocation: null,
      lastError: null
    };
  });
}

async function runWorker() {
  const posts = buildPostsFromEnv();
  const scheduler = {
    queue: [],
    lastSelectedPostId: null
  };

  state.configLoaded = true;
  state.phase = 'running';
  refreshPublicState(posts, scheduler.queue);

  const successCooldownMs = readNumberEnv('SUCCESS_COOLDOWN_MS', DEFAULT_SUCCESS_COOLDOWN_MS);
  const retryMs = readNumberEnv('RETRY_MS', DEFAULT_RETRY_MS);
  const networkErrorRetryMs = readNumberEnv(
    'NETWORK_ERROR_RETRY_MS',
    DEFAULT_NETWORK_ERROR_RETRY_MS
  );
  const requestTimeoutMs = readNumberEnv('REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS);
  const testConfig = {
    enabled: readBooleanEnv('MEGAMIND_TEST_MODE'),
    host: process.env.MEGAMIND_TEST_HOST || '127.0.0.1',
    port: readNumberEnv('MEGAMIND_TEST_PORT', 3998)
  };

  let shouldStop = false;

  const stopHandler = (signal) => {
    if (shouldStop) {
      return;
    }

    shouldStop = true;
    state.phase = 'stopping';
    log(`Received ${signal}. Finishing the current cycle, then exiting.`);
  };

  process.on('SIGINT', () => stopHandler('SIGINT'));
  process.on('SIGTERM', () => stopHandler('SIGTERM'));

  log(`MegaMind bumper started with ${posts.length} post(s).`);
  log(`Post rotation: ${posts.map(describePost).join(', ')}`);
  if (testConfig.enabled) {
    log(`Test mode enabled. Routing bump requests to http://${testConfig.host}:${testConfig.port}.`);
  }

  while (!shouldStop) {
    const post = pickNextPost(posts, scheduler);

    if (!post) {
      state.phase = 'all_disabled';
      refreshPublicState(posts, scheduler.queue);
      log('All configured posts are disabled. Stopping worker.');
      return;
    }

    state.activePostId = post.postId;
    state.lastSchedulerPickAt = new Date().toISOString();
    state.phase = 'running';
    post.phase = 'running';
    refreshPublicState(posts, scheduler.queue);

    try {
      post.lastAttemptAt = new Date().toISOString();
      process.stdout.write(`[${timestamp()}] Attempting bump for ${describePost(post)}... `);

      const response = await bumpPost(post.requestConfig, requestTimeoutMs, testConfig);
      post.lastStatus = response.status;
      post.lastLocation = response.location;
      post.lastError = null;

      if (response.status === 302 && response.location.includes('success_publish')) {
        console.log(`SUCCESS for ${describePost(post)}.`);
        post.phase = 'cooldown';
        post.lastSuccessAt = new Date().toISOString();
        state.phase = 'cooldown';
        refreshPublicState(posts, scheduler.queue);
        log(`Next dynamic pick in ${successCooldownMs}ms.`);
        await sleep(successCooldownMs);
        post.phase = 'ready';
        continue;
      }

      if (response.status === 302 && response.location.includes('/users/posts/list')) {
        console.log(`Too early for ${describePost(post)}.`);
        post.phase = 'waiting_window';
        state.phase = 'waiting_window';
        refreshPublicState(posts, scheduler.queue);
        log(`Retrying dynamic pick in ${retryMs}ms.`);
        await sleep(retryMs);
        post.phase = 'ready';
        continue;
      }

      if (
        response.location.includes('login') ||
        response.status === 401 ||
        response.status === 403
      ) {
        console.log(`AUTH ERROR for ${describePost(post)}.`);
        post.phase = 'auth_error';
        post.disabled = true;
        post.lastError = 'Cookies expired or the session is no longer authenticated.';
        refreshPublicState(posts, scheduler.queue);
        log(`${describePost(post)} disabled: ${post.lastError}`);
        continue;
      }

      console.log(`Unexpected response: ${response.status} -> ${response.location || '(no location)'}`);
      post.phase = 'unexpected_response';
      state.phase = 'unexpected_response';
      refreshPublicState(posts, scheduler.queue);
      log(`Retrying dynamic pick in ${retryMs}ms.`);
      await sleep(retryMs);
      post.phase = 'ready';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      post.phase = 'network_error';
      post.lastError = message;
      state.phase = 'network_error';
      refreshPublicState(posts, scheduler.queue);
      log(`Network or runtime error for ${describePost(post)}: ${message}`);
      log(`Retrying dynamic pick in ${networkErrorRetryMs}ms.`);
      await sleep(networkErrorRetryMs);
      post.phase = 'ready';
    }
  }

  state.phase = 'stopped';
  refreshPublicState(posts, scheduler.queue);
  log('MegaMind bumper stopped.');
}

async function main() {
  const server = startHealthServer();

  try {
    await runWorker();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.phase = state.configLoaded ? 'error' : 'idle';
    state.posts = [];
    log(`Worker halted: ${message}`);
  }

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  state.phase = 'error';
  log(`Fatal bootstrap error: ${message}`);
  process.exit(1);
});
