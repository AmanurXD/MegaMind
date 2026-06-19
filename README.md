# MegaMind

MegaMind is a simple Node.js worker that replays captured bump requests on a loop.

## Configuration

For multiple posts, set one env var per capture:

- `RAW_REQUEST_1_BASE64`
- `RAW_REQUEST_2_BASE64`
- `RAW_REQUEST_3_BASE64`

Each value should be a base64 encoded raw bump request. The worker makes one dynamic pick each 15-minute success frame using a shuffled round-robin queue. With two posts, it gives both posts turns, but the first pick after each shuffle is random instead of a fixed city order.

Older single-post envs still work:

- `RAW_REQUEST_BLOB`: the full raw HTTP request pasted directly into one env var
- `RAW_REQUEST`: the full raw HTTP request as multi-line text
- `RAW_REQUEST_BASE64`: the full raw HTTP request encoded in base64
- `RAW_REQUEST_FILE`: a local file path containing the raw request
- `RAW_REQUESTS_BASE64`: multiple base64 captures separated by commas, newlines, or `|||`

`RAW_REQUEST_BLOB` is the easiest option for ClawCloud Run. You can paste the capture exactly as copied from DevTools. If the env editor only accepts a single line, the app also accepts escaped newlines in the same variable, for example `GET /...\\nHost: ...`.

Optional timing variables:

- `SUCCESS_COOLDOWN_MS` default `910000`
- `RETRY_MS` default `60000`
- `NETWORK_ERROR_RETRY_MS` default `30000`
- `REQUEST_TIMEOUT_MS` default `30000`
- `PORT` default `3000`

## Pod compatibility

The container starts a lightweight HTTP health server so platforms like ClawCloud Run can keep the pod healthy while the worker runs in the background. The health response shows post IDs, scheduler state, and each post status without exposing request headers or cookies.

## Local run

```bash
RAW_REQUEST_1_BASE64="<base64 request>" RAW_REQUEST_2_BASE64="<base64 request>" node megamind.js
```

## Docker build

```bash
docker build -t megamind:latest .
```

## Docker run

```bash
docker run --rm \
  -e RAW_REQUEST_1_BASE64="<city 1 base64 request>" \
  -e RAW_REQUEST_2_BASE64="<city 2 base64 request>" \
  megamind:latest
```

## ClawCloud update flow

1. Open the app in ClawCloud Run.
2. Edit `RAW_REQUEST_1_BASE64` for city 1 and `RAW_REQUEST_2_BASE64` for city 2.
3. Paste the newest base64 capture into the matching variable.
4. Save the env change.
5. Redeploy or restart the app.

You do not need to rebuild the image for new captures. Only the env value needs to change.

## Convert to base64

If you want a single env-safe value for `RAW_REQUEST_1_BASE64`, `RAW_REQUEST_2_BASE64`, or any other capture slot, run:

```bash
node format-raw-request.js < raw-request.txt
```

Or with npm:

```bash
npm run format-request < raw-request.txt
```

The output is ready to paste into the matching `RAW_REQUEST_<number>_BASE64` env value as a single line.

## Safe local testing

Use the fake server to test parsing, scheduling, and response handling without contacting the real site.

Automated local mimic test:

```bash
npm run test:local-mimic
```

That test uses only `local-megamind-mimic.test` captures and a localhost fake server.

Long fake-only mimic test:

```bash
npm run test:long-mimic
```

By default this runs for 30 minutes with a 2-minute success cooldown. It mimics the deployed worker shape, but every request is routed to `127.0.0.1`.

One-hour fake-only test:

```bash
LONG_TEST_DURATION_MS=3600000 npm run test:long-mimic
```

Faster local check:

```bash
LONG_TEST_DURATION_MS=10000 LONG_TEST_SUCCESS_COOLDOWN_MS=1000 npm run test:long-mimic
```

Terminal 1:

```bash
npm run fake-server
```

Terminal 2:

```bash
MEGAMIND_TEST_MODE=1 \
MEGAMIND_TEST_PORT=3998 \
SUCCESS_COOLDOWN_MS=3000 \
RETRY_MS=1000 \
NETWORK_ERROR_RETRY_MS=1000 \
RAW_REQUEST_1_BASE64="<base64 capture 1>" \
RAW_REQUEST_2_BASE64="<base64 capture 2>" \
node megamind.js
```

Fake server modes:

- `FAKE_BUMP_MODE=success`: every bump returns success.
- `FAKE_BUMP_MODE=too-early`: every bump returns the too-early redirect.
- `FAKE_BUMP_MODE=alternate`: success and too-early alternate per post.
- `FAKE_BUMP_MODE=auth`: every bump returns an auth failure.
