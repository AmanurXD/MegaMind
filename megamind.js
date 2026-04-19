const https = require('https');

// ==========================================
// 🔧 CONFIGURATION (PASTE YOUR RAW REQUEST HERE)
// ==========================================
const RAW_REQUEST = `GET /users/posts/bump/49970418 HTTP/2
Host: megapersonals.eu
Cookie: _ym_uid=1766852614548077944; _ym_d=1766852614; visitorId=09fd28f7-09a6-4632-96b0-89e8e18dbb79; termsOfUseVersion=2; city=99; publicDomain=megapersonals.eu; mp_screen_client=1379x937; _gid=GA1.2.43589293.1776530576; _ym_isad=2; sid=9bbd881b919f199dae92082b4f0b2aa5; JSESSIONID=E0356D1EBF2F3E389D6E5CC67CDA8C7E; backURL=https%3A%2F%2Fmegapersonals.eu%2Fusers%2Fposts%2Flist; __cf_bm=DOIGEel4UPtAeOmszSRg_pUUV1k1YPnK7.rHnsQuhSY-1776557768.61697-1.0.1.1-7zeIw2HXtLT1C1woKLxD5ezKulZ0zkZbSzCMx1BBjQ82oM8yXy.zUvMEjYp0GSRtanpuraJkuoo9kNMW8dSTq3AaE6kHrsOPOCVsQVzmMpsWMOCJ2U.rAHHJX29WpEeb; _ga_7DGFPGNTB9=GS2.1.s1776556780$o5$g1$t1776557769$j60$l0$h0; _ga=GA1.2.1642405227.1766852621; _gat_gtag_UA_113349993_1=1
Sec-Ch-Ua: "Not/A)Brand";v="8", "Chromium";v="137", "Google Chrome";v="137"
Sec-Ch-Ua-Mobile: ?1
Sec-Ch-Ua-Platform: "Android"
Accept-Language: en-US,en;q=0.9
Upgrade-Insecure-Requests: 1
User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: navigate
Sec-Fetch-User: ?1
Sec-Fetch-Dest: document
Referer: https://megapersonals.eu/users/posts/list
Accept-Encoding: gzip, deflate, br
Priority: u=0, i`;

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
