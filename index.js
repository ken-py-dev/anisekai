const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require('axios');
const https = require('https');
const { createHTTP2Adapter } = require('axios-http2-adapter');
const crypto = require("crypto");
const NodeCache = require("node-cache");
const { getBaseUrl } = require("./libs/host_base");
const redirectCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const metaCache = new NodeCache({ checkperiod: 600 });

const http2Agent = new https.Agent({
  ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 6,
  maxFreeSockets: 6,
});

const http2Adapter = createHTTP2Adapter({
  httpsAgent: http2Agent,
  settings: { enablePush: false, maxConcurrentStreams: 100 },
});

const http2Axios = axios.create({
  adapter: http2Adapter,
  timeout: 30000,
  maxRedirects: 5,
});

function buildPlayerUrl(playerUrl, hlsProxyUrl, tracks, preferredSubUrl, intro, outro) {
  let url = `${playerUrl}?url=${encodeURIComponent(hlsProxyUrl)}`;
  const valid = tracks ? tracks.filter(Boolean) : [];
  if (valid.length > 0) {
    let track = valid.find(t => t.default) || valid[0];
    if (preferredSubUrl) {
      const match = valid.find(t => t.file === preferredSubUrl || t.proxyUrl === preferredSubUrl);
      if (match) track = match;
    }
    const subUrl = track.proxyUrl || track.file;
    if (subUrl) {
      url += `&sub=${encodeURIComponent(subUrl)}`;
      if (track.label) url += `&subLabel=${encodeURIComponent(track.label)}`;
      if (track.language) url += `&subLang=${encodeURIComponent(track.language)}`;
    }
  }
  if (intro && intro.end > intro.start) url += `&intro=${intro.start}-${intro.end}`;
  if (outro && outro.end > outro.start) url += `&outro=${outro.start}-${outro.end}`;
  return url;
}

function getMobileHeaders(origin, referer) {
  return {
    'Host': new URL(origin || referer).hostname,
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-PH,en-US;q=0.9,en;q=0.8',
    'Origin': origin || referer,
    'Referer': referer || origin,
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  };
}

async function fetchWithBypass(url, headers, responseType) {
  try {
    return await axios.get(url, { headers, responseType, validateStatus: s => s < 400 });
  } catch (e) {
    if (e.response?.status !== 403) throw e;
    const mobileHeaders = {
      ...getMobileHeaders(headers['Origin'], headers['Referer']),
      ...(headers['Cookie'] ? { 'Cookie': headers['Cookie'] } : {}),
    };
    return http2Axios.get(url, { headers: mobileHeaders, responseType, validateStatus: s => s < 400 });
  }
}

function getSecondsUntilMidnightPH() {
  const now = Date.now();
  const PH_OFFSET = 8 * 60 * 60 * 1000;
  const nowPH = now + PH_OFFSET;
  const nextMidnightPH = Math.ceil(nowPH / 86400000) * 86400000;
  return Math.ceil((nextMidnightPH - nowPH) / 1000);
}

async function getCachedMeta(key, fetchFn) {
  const cached = metaCache.get(key);
  if (cached !== undefined) return cached;
  const data = await fetchFn();
  const ttl = getSecondsUntilMidnightPH();
  metaCache.set(key, data, ttl);
  return data;
}

const router = express.Router();
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const {
  scrapeHome,
  scrapeAnimeInfo,
  scrapeListing,
  scrapeSearch,
  scrapeSchedule,
  getEpisodeList,
  getStreamUrl,
  BASE_URL,
} = require("./scraper");

router.use(express.static(path.join(__dirname, "public"), { index: false }));

router.get(["/api", "/api"], async (req, res) => {
  try {
    const result = await getCachedMeta("home", scrapeHome);
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/info", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: "Anime ID required. Use ?id=anime-slug" });
    const result = await getCachedMeta(`info:${id}`, () => scrapeAnimeInfo(id));
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api/info :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/listing", async (req, res) => {
  try {
    const { type, page } = req.query;
    if (!type) return res.status(400).json({ success: false, error: "type query parameter required (e.g. new-release)" });
    let fullUrl = `${BASE_URL}/${type.replace(/^\/+/, '')}`;
    if (page && parseInt(page) > 1) fullUrl += `?page=${parseInt(page)}`;
    const result = await getCachedMeta(`listing:${type}:${page || 1}`, () => scrapeListing(fullUrl));
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api/listing :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ success: false, error: "Search query 'q' is required" });
    const result = await scrapeSearch(q.trim());
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api/search :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/episodes", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: "Anime ID required. Use ?id=anime-slug" });
    const result = await getCachedMeta(`episodes:${id}`, () => getEpisodeList(id));
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api/episodes :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/stream", async (req, res) => {
  try {
    const { id, ep } = req.query;
    if (!id || !ep) {
      return res.status(400).json({ success: false, error: "id and ep required (e.g. ?id=slug&ep=1)" });
    }
    const origin_url = getBaseUrl(req, true);
    const directBase = getBaseUrl(req, false);
    const playerBase = getBaseUrl(req, false, false);
    const result = await getStreamUrl(id, ep);
    if (result.success && result.data?.servers) {
      const preferredSubUrl = req.query.sub || null;
      await Promise.all(result.data.servers.map(async (s) => {
        if (s.hlsUrl) {
          const p = new URLSearchParams({ url: s.hlsUrl });
          if (s.url) p.set('referer', s.url);
          const tunnelUrl = `${origin_url}/api/hls-proxy?${p.toString()}`;
          s.redirectId = await storeRedirectUrl(tunnelUrl, '.m3u8');
          s.proxyUrl = `${directBase}/api/redirect?id=${s.redirectId}&ext=.m3u8`;
        }
        if (s.tracks?.length) {
          await Promise.all(s.tracks.map(async (t) => {
            if (!t.file) return;
            const p = new URLSearchParams({ url: t.file });
            if (s.url) p.set('referer', s.url);
            const tunnelUrl = `${origin_url}/api/hls-proxy?${p.toString()}`;
            t.redirectId = await storeRedirectUrl(tunnelUrl, '.vtt');
            t.proxyUrl = `${directBase}/api/redirect?id=${t.redirectId}&ext=.vtt`;
          }));
        }
        if (s.downloadLinks) {
          const entries = Object.entries(s.downloadLinks);
          const results = await Promise.all(entries.map(async ([quality, url]) => {
            if (typeof url !== 'string') return [quality, null];
            const p = new URLSearchParams({ url });
            if (s.url) p.set('referer', s.url);
            const tunnelUrl = `${origin_url}/api/hls-proxy?${p.toString()}`;
            const rid = await storeRedirectUrl(tunnelUrl, '.mp4');
            return [quality, { url, proxyUrl: `${directBase}/api/redirect?id=${rid}&ext=.mp4` }];
          }));
          s.downloadLinks = Object.fromEntries(results.filter(([, v]) => v));
        }
        if (s.proxyUrl) {
          s.playerUrl = buildPlayerUrl(`${playerBase}/player`, s.proxyUrl, s.tracks, preferredSubUrl, s.intro, s.outro);
        } else {
          s.playerUrl = s.url || null;
        }
      }));

      const first = result.data.servers.find(s => s.playerUrl || s.url);
      if (first) result.data.playerUrl = first.playerUrl || first.url;
    }
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api/stream :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/schedule", async (req, res) => {
  try {
    const { date } = req.query;
    const result = await getCachedMeta(`schedule:${date || ''}`, () => scrapeSchedule(date || null));
    res.json(result);
  } catch (err) {
    console.error("[anikoto] GET /api/schedule :", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "anikoto-scraper", uptime: process.uptime() });
});

async function getCachedRedirect(id) {
  let cached = redirectCache.get(id);
  if (cached) return cached;
  return null;
}

async function storeRedirectUrl(tunnelUrl, ext) {
  const id = crypto.randomUUID();
  const data = { url: tunnelUrl, ext: ext || null, _updatedAt: Date.now() };
  redirectCache.set(id, data);
  return id;
}

router.get("/api/redirect", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: "id query parameter is required" });
    const cached = await getCachedRedirect(id);
    if (!cached) return res.status(404).json({ success: false, error: "Redirect ID not found or expired" });
    let tunnelUrl = cached.url;
    if (cached.ext) tunnelUrl += `&ext=${cached.ext}`;
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.redirect(302, tunnelUrl);
  } catch (err) {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.status(500).json({ success: false, error: err.message });
  }
});

const cookieJar = new Map();

async function getCookiesForReferer(refererUrl) {
  if (!refererUrl) return '';
  const key = new URL(refererUrl).origin;
  const cached = cookieJar.get(key);
  if (cached && Date.now() < cached.expires) return cached.cookies;
  try {
    const resp = await axios.get(refererUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 5000,
      validateStatus: () => true,
    });
    const setCookie = resp.headers['set-cookie'];
    if (setCookie) {
      const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
        .map(c => c.split(';')[0]).join('; ');
      cookieJar.set(key, { cookies, expires: Date.now() + 60000 });
      return cookies;
    }
  } catch {}
  return '';
}

router.get("/api/hls-proxy", async (req, res) => {
  try {
    const { url, referer } = req.query;
    
    if (!url) return res.status(400).json({ success: false, error: "url query parameter is required" });
    
    let ori;
    let cookies = '';
    if (referer) {
      try { ori = new URL(referer).origin + '/'; } catch { ori = null; }
      if (referer.includes('plyr.php') || referer.includes('mewcdn')) {
        cookies = await getCookiesForReferer(referer);
      }
    }
    if (!ori) {
      ori = url;
      if (ori.includes("megaplay") || ori.includes("cinewave") || ori.includes("lostproject") || ori.includes("streamzone") || ori.includes("vidtube") || ori.includes("mewstream")) {
          ori = "https://megaplay.buzz/";
      } else if (ori.includes("vidwish") || ori.includes("watching.onl")) {
          ori = "https://vidwish.live/";
      } else if (ori.includes("vibeplayer") || ori.includes("mewcdn")) {
          ori = "https://mewcdn.online/";
      } else if (ori.includes("ibyteimg")) {
          ori = "https://vidwish.live/";
      } else {
          ori = "https://megaplay.buzz/";
      }
    }

    const chainRef = (referer && (referer.includes('plyr.php') || referer.includes('mewcdn'))) ? referer : ori;
    const refParam = `&referer=${encodeURIComponent(chainRef)}`;
    const proxyBase = `${getBaseUrl(req, true)}/api/hls-proxy?url=`;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': ori,
      'Origin': new URL(ori).origin,
    };
    if (cookies) reqHeaders['Cookie'] = cookies;
    const response = await fetchWithBypass(url, reqHeaders, 'arraybuffer');

    const contentType = response.headers['content-type'] || '';
    const isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8');

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Cache-Control', 'public, max-age=300');

    if (!isM3u8) {
      let buf = Buffer.from(response.data);
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        const iend = buf.indexOf('IEND');
        if (iend !== -1) {
          let off = iend + 8;
          while (off + 188 < buf.length && !(buf[off] === 0x47 && buf[off + 188] === 0x47)) off++;
          buf = buf.subarray(off);
        }
      }
      res.set('Content-Type', contentType || 'application/octet-stream');
      return res.send(buf);
    }

    const text = Buffer.from(response.data).toString('utf8');
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const rewritten = text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('"')) return line;
      try {
        const absolute = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
        return proxyBase + encodeURIComponent(absolute) + refParam;
      } catch { return line; }
    }).join('\n');

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(rewritten);
  } catch (err) {
    console.error('[hls-proxy]', err.message);
    if (err.response?.status === 404) return res.status(404).json({ success: false, error: 'Not found' });
    res.status(502).json({ success: false, error: err.message });
  }
});

const DOMAIN_HEADER_MAP = [
  { domains: ['tmdb.org', 'image.tmdb.org'], referer: 'https://www.themoviedb.org/' },
  { domains: ['anilist.co'], referer: 'https://anilist.co/' },
  { domains: ['allanime.day', 'allanime.to', 'allanime.site'], referer: 'https://allanime.day/' },
];

function getImageHeaders(imageUrl) {
  const urlLower = imageUrl.toLowerCase();
  for (const entry of DOMAIN_HEADER_MAP) {
    if (entry.domains.some(d => urlLower.includes(d))) {
      return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': entry.referer,
        'Origin': new URL(entry.referer).origin,
      };
    }
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Referer': `${BASE_URL}/`,
    'Origin': BASE_URL,
  };
}

router.get("/api/image-proxy", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "url query parameter is required" });

    let imageUrl = url;
    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

    const attempts = [
      getImageHeaders(imageUrl),
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://allanime.day/' },
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': `${BASE_URL}/` },
    ];

    let response = null;
    for (const headers of attempts) {
      try {
        response = await axios.get(imageUrl, {
          headers,
          responseType: 'arraybuffer',
          validateStatus: s => s >= 200 && s < 400,
        });
        if (response) break;
      } catch (e) {
        if (e.response?.status === 404) break;
      }
    }

    if (!response || !response.data || response.data.length < 100) {
      res.set('Content-Type', 'image/gif');
      res.set('Cache-Control', 'public, max-age=300');
      return res.send(TRANSPARENT_GIF);
    }

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.debug('[image-proxy]', err.message);
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(TRANSPARENT_GIF);
  }
});

function serveHtml(file, apiBase) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  return html.replace(/{{API_BASE}}/g, apiBase).replace(/{{BASE_PATH}}/g, apiBase.replace(/\/api$/, ''));
}

router.get("/", (req, res) => {
  const apiBase = getBaseUrl(req) + '/api';
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  res.send(serveHtml('index.html', apiBase));
});

router.get("/docs", (req, res) => {
  const apiBase = getBaseUrl(req) + '/api';
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  res.send(serveHtml('docs.html', apiBase));
});


const WATCH_TEMPLATE = fs.readFileSync(path.join(__dirname, 'public', 'watch.html'), 'utf8');

router.get("/watch/:slug/:ep", async (req, res) => {
  const origin_url = getBaseUrl(req);
  const directBase = getBaseUrl(req, false);
  const playerBase = getBaseUrl(req, false, false);
  let tunnel = getBaseUrl(req, true);
      tunnel +=  "/api";
  const apiBase = origin_url + '/api';
  try {
    const { slug, ep } = req.params;
    if (!slug || !ep) return res.redirect('/');

    const [infoResult, streamResult] = await Promise.all([
      scrapeAnimeInfo(slug),
      getStreamUrl(slug, parseInt(ep)),
    ]);
    const info = infoResult?.data || {};
    const stream = streamResult?.data || {};

    const servers = await Promise.all((stream.servers || []).map(async (s) => {
      const enriched = { ...s };
      if (enriched.hlsUrl) {
        const p = new URLSearchParams({ url: enriched.hlsUrl });
        if (s.url) p.set('referer', s.url);
        const tunnelUrl = `${tunnel}/hls-proxy?${p.toString()}`;
        enriched.redirectId = await storeRedirectUrl(tunnelUrl, '.m3u8');
        enriched.proxyUrl = `${directBase}/api/redirect?id=${enriched.redirectId}&ext=.m3u8`;
      }
      if (enriched.tracks?.length) {
        await Promise.all(enriched.tracks.map(async (t) => {
          if (!t.file) return;
          const p = new URLSearchParams({ url: t.file });
          if (s.url) p.set('referer', s.url);
          const tunnelUrl = `${tunnel}/hls-proxy?${p.toString()}`;
          t.redirectId = await storeRedirectUrl(tunnelUrl, '.vtt');
          t.proxyUrl = `${directBase}/api/redirect?id=${t.redirectId}&ext=.vtt`;
        }));
      }
      if (enriched.downloadLinks) {
        const entries = Object.entries(enriched.downloadLinks);
        const results = await Promise.all(entries.map(async ([quality, url]) => {
          if (typeof url !== 'string') return [quality, null];
          const p = new URLSearchParams({ url });
          if (s.url) p.set('referer', s.url);
          const tunnelUrl = `${tunnel}/hls-proxy?${p.toString()}`;
          const rid = await storeRedirectUrl(tunnelUrl, '.mp4');
          return [quality, { url, proxyUrl: `${directBase}/api/redirect?id=${rid}&ext=.mp4` }];
        }));
        enriched.downloadLinks = Object.fromEntries(results.filter(([, v]) => v));
      }
      if (enriched.proxyUrl) {
        enriched.playerUrl = buildPlayerUrl(playerBase + '/player', enriched.proxyUrl, enriched.tracks, req.query.sub || null, enriched.intro, enriched.outro);
      } else {
        enriched.playerUrl = enriched.url || null;
      }
      return enriched;
    }));

    const defaultServer = servers.find(s => s.proxyUrl || s.url);

    const data = {
      title: info.title || slug,
      titleJp: info.titleJp || null,
      description: info.synopsis || null,
      poster: info.poster || null,
      embedUrl: defaultServer?.url || '',
      playerUrl: defaultServer?.playerUrl || '',
      servers,
      totalEpisodes: info.totalEpisodes || 0,
      epNum: parseInt(ep),
    };

    const esc = s => (s || '').replace(/"/g, '&quot;').replace(/'/g, "\\'");
    const escHtml = s => (s || '').replace(/</g, '&lt;');

    const metaTitle = esc(data.title);
    const metaDesc = esc((data.description || `Watch ${data.title} episode ${ep} online.`).substring(0, 300));
    const metaImage = data.poster ? `<meta property="og:image" content="${esc(data.poster)}">` : '';
    const posterTag = data.poster ? `<div class="poster"><img src="${esc(apiBase + '/image-proxy?url=' + encodeURIComponent(data.poster))}" alt="${esc(data.title)}" onerror="onImgError(this)"></div>` : '';
    const totalLabel = data.totalEpisodes ? ` of ${data.totalEpisodes}` : '';
    const descHtml = data.description ? `<p>${escHtml(data.description).substring(0, 300)}</p>` : '';
    const serverDropdown = data.servers.length
      ? `<select id="server-select" onchange="switchServer(this)"><option value="">Select server...</option>${data.servers.map((s, i) =>
          `<option value="${esc(s.playerUrl || s.url || '')}" data-fallback="${esc(s.url || '')}" data-server-index="${i}"${i === 0 ? ' selected' : ''}>${s.name} (${s.type})</option>`
        ).join('')}</select>`
      : '';

    const prevStyle = data.epNum > 1 ? '' : 'display:none';
    const nextStyle = data.totalEpisodes > data.epNum ? '' : 'display:none';
    const prevHtml = `<a href="javascript:void(0)" onclick="navigateEp(${data.epNum - 1})" class="prev" style="${prevStyle}"><i class="fas fa-chevron-left"></i> Ep ${data.epNum - 1}</a>`;
    const nextHtml = `<a href="javascript:void(0)" onclick="navigateEp(${data.epNum + 1})" class="next" style="${nextStyle}">Ep ${data.epNum + 1} <i class="fas fa-chevron-right"></i></a>`;
    const statusClass = data.playerUrl ? ' ok' : '';
    const statusIcon = data.playerUrl ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-info-circle"></i>';
    const statusText = data.playerUrl ? 'Player ready' : 'Select a server above to start watching';

    const html = WATCH_TEMPLATE
      .replace(/{{META_TITLE}}/g, metaTitle)
      .replace(/{{META_DESC}}/g, metaDesc)
      .replace('{{META_IMAGE}}', metaImage)
      .replace('{{POSTER_TAG}}', posterTag)
      .replace('{{PAGE_TITLE}}', escHtml(data.title))
      .replace(/{{EP}}/g, ep)
      .replace('{{TOTAL_LABEL}}', totalLabel)
      .replace('{{DESC_HTML}}', descHtml)
      .replace(/{{PLAYER_URL}}/g, esc(data.playerUrl))
      .replace(/{{EMBED_URL}}/g, esc(data.embedUrl))
      .replace(/{{SERVER_DROPDOWN}}/g, serverDropdown)
      .replace('{{PREV_LINK}}', prevHtml)
      .replace('{{NEXT_LINK}}', nextHtml)
      .replace('{{STATUS_CLASS}}', statusClass)
      .replace('{{STATUS_ICON}}', statusIcon)
      .replace('{{STATUS_TEXT}}', statusText)
      .replace('{{SLUG_JS}}', slug.replace(/'/g, "\\'"))
      .replace('{{EP_JS}}', ep)
      .replace(/{{API_BASE}}/g, apiBase)
      .replace(/{{BASE_PATH}}/g, apiBase.replace(/\/api$/, ''))
      .replace('{{SERVERS_JSON}}', JSON.stringify(data.servers).replace(/<\//g, '<\\/'))
      .replace('{{PLAYER_BASE}}', (playerBase + '/player').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.send(html);
  } catch (err) {
    console.error("[anikoto] GET /watch/:slug/:ep :", err.message);
    res.status(500).set("Cache-Control", "no-cache, no-store, must-revalidate").set("Pragma", "no-cache").set("Expires", "0").send(`<!DOCTYPE html><html><body><h1>Error</h1><p>${err.message}</p><a href="${origin_url || ''}/">Back to Home</a></body></html>`);
  }
});

const app = express();
app.use("/", router);
app.use(express.static(path.join(__dirname, "public")));

router.get("/player", async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const dest = `https://www.ken-py-dev.gleeze.com/player?${qs}`;
    const response = await axios.get(dest, { responseType: "text", validateStatus: s => s < 400 });
    return res.type("html").send(response.data);
  } catch {
    try {
      const qs = new URLSearchParams(req.query).toString();
      const fallbackDest = `https://allanime.day/player?${qs}`;
      const response = await axios.get(fallbackDest, { responseType: "text", validateStatus: s => s < 400 });
      return res.type("html").send(response.data);
    } catch {}
    res.status(404).json({ success: false, message: "Player is dead replace it with new one or your own player.html!" });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () =>
    console.log(`ANISEKAI SCRAPER RUNNING ON PORT: ${PORT}\n== [ MAIN PAGE → GET/ ] ===\n=== [ API DOCUMENTATION → GET/docs ] ===`)
  );
}

module.exports = app;