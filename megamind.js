const https = require('https');

// ==========================================
// 🔧 CONFIGURATION
// ==========================================
function loadRawRequest() {
    if (process.env.RAW_REQUEST_BASE64) {
        return Buffer.from(process.env.RAW_REQUEST_BASE64.trim(), 'base64').toString('utf8');
    }

    if (process.env.RAW_REQUEST) {
        return process.env.RAW_REQUEST.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    }

    console.log("❌ ERROR: Missing RAW_REQUEST_BASE64 environment variable.");
    console.log("   Run: npm run encode-request -- raw-request.txt");
    console.log("   Then paste the output into Railway/Render as RAW_REQUEST_BASE64.");
    process.exit(1);
}

const RAW_REQUEST = loadRawRequest();

// ==========================================
// ⚙️ PARSER ENGINE
// ==========================================
function parseRawRequest(raw) {
    const lines = raw.trim().split(/\r?\n/);
    const firstLine = lines.shift(); // e.g., "GET /users/posts/bump/50511057 HTTP/2"
    const [method, path] = firstLine.split(' ');

    // Extract Post ID directly from the path
    const pathMatch = path.match(/\/bump\/(\d+)/);
    const postId = pathMatch ? pathMatch[1] : "UNKNOWN";

    const headers = {};
    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue; // Skip lines without a colon
        
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
    }

    const hostname = headers['Host'] || 'megapersonals.eu';

    return { method, path, postId, hostname, headers };
}

// Parse the request once at startup
const REQUEST_CONFIG = parseRawRequest(RAW_REQUEST);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function bumpPost() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: REQUEST_CONFIG.hostname,
            path: REQUEST_CONFIG.path,
            method: REQUEST_CONFIG.method,
            headers: REQUEST_CONFIG.headers
        };

        const req = https.request(options, (res) => {
            resolve({
                status: res.statusCode,
                location: res.headers.location || ""
            });
            // We only care about the 302 location header, empty the body buffer to prevent memory leaks
            res.on('data', () => {}); 
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

async function startMegaWorker() {
    console.clear();
    console.log(`🍑 MegaPersonals Bumper - Post ${REQUEST_CONFIG.postId}`);
    console.log("---------------------------------------------");

    if (REQUEST_CONFIG.postId === "UNKNOWN") {
        console.log("❌ ERROR: Could not parse POST_ID from your raw request.");
        console.log("   Make sure you copied a 'GET /users/posts/bump/...' request.");
        process.exit(1);
    }

    while (true) {
        try {
            process.stdout.write(`[${new Date().toLocaleTimeString()}] Attempting Bump... `);
            
            const res = await bumpPost();

            // LOGIC GATE
            
            // CASE 1: SUCCESS
            if (res.status === 302 && res.location.includes("success_publish")) {
                console.log("✅ SUCCESS! Bumped.");
                console.log("   -> Sleeping for 15 minutes (Locking Phase)...");
                await sleep((15 * 60 * 1000) + 10000); // 15 mins + 10 seconds buffer
            }
            
            // CASE 2: TOO EARLY (COOLDOWN)
            else if (res.status === 302 && res.location.includes("/users/posts/list")) {
                console.log("⏳ Failed (Too Early).");
                console.log("   -> Retrying in 60 seconds to find the window...");
                await sleep(60 * 1000);
            }
            
            // CASE 3: AUTH ERROR
            else if (res.location.includes("login") || res.status === 403 || res.status === 401) {
                console.log("\n❌ FATAL: Cookies Expired or Logged Out.");
                console.log("   -> Please update the RAW_REQUEST_BASE64 environment variable with a fresh copy.");
                process.exit(1);
            }
            
            // CASE 4: UNKNOWN
            else {
                console.log(`⚠️ Unknown Response: ${res.status} -> ${res.location}`);
                await sleep(60 * 1000);
            }

        } catch (e) {
            console.log(`\n❌ Network Error: ${e.message}`);
            await sleep(30 * 1000); // Retry in 30s
        }
    }
}

startMegaWorker();
