const https = require('https');

// ==========================================
// 🔧 CONFIGURATION (PASTE YOUR RAW REQUEST HERE)
// ==========================================
const RAW_REQUEST = `GET /users/posts/bump/50511057 HTTP/2
Host: megapersonals.eu
Cookie: _ym_uid=1773621904359197761; _ym_d=1773621904; visitorId=59efe8d4-a629-406c-a4a3-839c89aa573f; termsOfUseVersion=2; _ga_7DGFPGNTB9=GS2.1.s1773715162$o4$g0$t1773715162$j60$l0$h0; _ga=GA1.1.1379120135.1773621910; _gid=GA1.2.1473477669.1773621911; publicDomain=megapersonals.eu; mp_screen_client=1920x947; sid=d95e1e491712c0a830f78836e564714b; backURL=https%3A%2F%2Fmegapersonals.eu%2Fusers%2Fposts%2Fselect%2F50511057; _ym_isad=2; JSESSIONID=C2152B79FAC2C99A5C261485729F418C; __cf_bm=cPI677zelA2jWQMCyicgBg__MStRTcNNHOYPSSo1w2E-1773715155.1254668-1.0.1.1-CbqW30xj3QcqqGvB1fQM7Vn_UEsy9zm5N4d3rtyMY2zAwkiLd7UmOgLRUnlosxpd_rs9w3MEI0m5Z6Cm2BgOXhxL_La9RX8RwlwafpRFFCQouJprreOxffo1ndEnVtJO; _gat_gtag_UA_113349993_1=1
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-US,en;q=0.9
Accept-Encoding: gzip, deflate, br
Sec-Gpc: 1
Referer: https://megapersonals.eu/users/posts/select/50511057
Upgrade-Insecure-Requests: 1
Sec-Fetch-Dest: document
Sec-Fetch-Mode: navigate
Sec-Fetch-Site: same-origin
Sec-Fetch-User: ?1
Priority: u=0, i
Te: trailers`;

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
                console.log("   -> Please update the RAW_REQUEST block with a fresh copy.");
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
