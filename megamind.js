const https = require('https');

// ==========================================
// 🔧 CONFIGURATION
// ==========================================
const CONFIG = {
    POST_ID: "49958774", // The ID from your URL
    
    // Paste your massive Cookie string here
    COOKIE: `_ym_uid=1766852614548077944; _ym_d=1766852614; _ym_isad=2; visitorId=09fd28f7-09a6-4632-96b0-89e8e18dbb79; termsOfUseVersion=2; _gid=GA1.2.977015484.1766852621; city=99; publicDomain=megapersonals.eu; mp_screen_client=958x944; JSESSIONID=F53076E118DA1EBC21B4F61DFBB7EF9B; sid=256f96909bf2c9a9b2aa6dcbb6faba57; backURL=https%3A%2F%2Fmegapersonals.eu%2Fusers%2Fposts%2Flist; __cf_bm=desJEXeWzPu9prB3vcpBIvc0LgTbD2S1mky.MaoUmdU-1766852755.1001263-1.0.1.1-vd_kTwYWMSrpQI0chR4VZeda9wyBffaqBKqYn9_4oabcAGTHJXjT0v1kVIo0nPD7Vn20eAPpl4sx8mEPNmq.fsfPHezq__2OYtmlfpTgim8tDwTrCTbBWedx6qDs5Cal; _ga_7DGFPGNTB9=GS2.1.s1766852620$o1$g1$t1766852755$j13$l0$h0; _ga=GA1.2.1642405227.1766852621`
};

// Headers matching your capture exactly
const HEADERS = {
    "Host": "megapersonals.eu",
    "Cookie": CONFIG.COOKIE,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Referer": "https://megapersonals.eu/users/posts/list",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Chromium";v="143", "Not A(Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Priority": "u=0, i"
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function bumpPost() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'megapersonals.eu',
            path: `/users/posts/bump/${CONFIG.POST_ID}`,
            method: 'GET',
            headers: HEADERS
        };

        const req = https.request(options, (res) => {
            // We only care about headers because it's a 302 Redirect
            resolve({
                status: res.statusCode,
                location: res.headers.location || ""
            });
            // We don't even need to consume body for a 302, but let's be clean
            res.on('data', () => {}); 
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

async function startMegaWorker() {
    console.clear();
    console.log(`🍑 MegaPersonals Bumper - Post ${CONFIG.POST_ID}`);
    console.log("---------------------------------------------");

    while (true) {
        try {
            process.stdout.write(`[${new Date().toLocaleTimeString()}] Attempting Bump... `);
            
            const res = await bumpPost();

            // LOGIC GATE
            
            // CASE 1: SUCCESS
            // The location URL contains "success_publish"
            if (res.status === 302 && res.location.includes("success_publish")) {
                console.log("✅ SUCCESS! Bumped.");
                console.log("   -> Sleeping for 15 minutes (Locking Phase)...");
                
                // Sleep 15 mins + 10 seconds buffer to be perfectly safe
                await sleep((15 * 60 * 1000) + 10000); 
            }
            
            // CASE 2: TOO EARLY (COOLDOWN)
            // The location URL is just back to the list
            else if (res.status === 302 && res.location.includes("/users/posts/list")) {
                console.log("⏳ Failed (Too Early).");
                console.log("   -> Retrying in 60 seconds to find the window...");
                
                // Wait 1 minute and probe again
                await sleep(60 * 1000);
            }
            
            // CASE 3: AUTH ERROR
            // Usually 302 to /login or a 403 Forbidden
            else if (res.location.includes("login") || res.status === 403 || res.status === 401) {
                console.log("\n❌ FATAL: Cookies Expired or Logged Out.");
                console.log("   -> Please update CONFIG.COOKIE.");
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
