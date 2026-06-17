const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://anikoto.cz';

const cache = new Map();
const DEFAULT_TTL_MS = 60_000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs = DEFAULT_TTL_MS) {
  if (!data || (typeof data === 'object' && data.success === false)) return;
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function cacheKey(fnName, ...args) {
  return `${fnName}:${args.map(a => String(a)).join('|')}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}, 300_000);

const requestHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

function extractSlug(href) {
  return href
    .replace(BASE_URL, '')
    .replace('/watch/', '')
    .replace(/\/ep-\d+$/, '')
    .replace(/^\/+|\/+$/g, '');
}

function resolveUrl(path) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${BASE_URL}${path}`;
}

function getImgSrc(imgEl) {
  const $ = (typeof imgEl === 'object' && imgEl.length !== undefined) ? imgEl : null;
  if (!$ || !$.length) return null;
  const src = $.attr('src') || '';
  const dataSrc = $.attr('data-src') || $.attr('data-lazy-src') || $.attr('data-original') || '';
  const isPlaceholder = !src || src.startsWith('data:image') || src.includes('placeholder') || src.includes('blank') || src.includes('loading');
  return isPlaceholder && dataSrc ? dataSrc : (src || dataSrc || null);
}

function parsePosterItem($, el) {
  const $poster = $(el);
  const link = $poster.find('> a').first();
  const href = link.attr('href') || '';
  const img = link.find('> img').first();
  const title = img.attr('alt') || '';
  const poster = getImgSrc(img);
  const dataTip = $poster.attr('data-tip') || null;

  const slug = extractSlug(href);
  const fullUrl = resolveUrl(href);
  const posterUrl = poster ? resolveUrl(poster) : null;

  const metaLeft = $poster.find('.meta > .inner > .left');
  const epSub = metaLeft.find('.ep-status.sub span').text().trim() || null;
  const epDub = metaLeft.find('.ep-status.dub span').text().trim() || null;
  const epTotal = metaLeft.find('.ep-status.total span').text().trim() || null;
  const typeLabel = $poster.find('.meta > .inner > .right').text().trim() || null;

  return {
    id: slug || null,
    internalId: dataTip ? parseInt(dataTip) : null,
    title: title || null,
    poster: posterUrl,
    episode: { sub: epSub, dub: epDub, total: epTotal },
    type: typeLabel,
  };
}

function parseScaffItem($, el) {
  const $item = $(el);
  const href = $item.attr('href') || '';
  const posterEl = $item.find('> .inner > .poster').first();
  const infoEl = $item.find('> .inner > .info').first();

  const img = posterEl.find('img').first();
  const titleEl = infoEl.find('.name.d-title').first();
  const title = titleEl.text().trim() || img.attr('alt') || '';
  const titleJp = titleEl.attr('data-jp') || null;
  const poster = getImgSrc(img);
  const dataTip = posterEl.attr('data-tip') || null;

  const slug = extractSlug(href);
  const posterUrl = poster ? resolveUrl(poster) : null;

  let typeLabel = null, rating = null, duration = null;
  infoEl.find('.meta > .dot').each((i, dot) => {
    const text = $(dot).text().trim();
    if ($(dot).find('.fa-star').length || $(dot).hasClass('score')) {
      const m = text.match(/[\d.]+/);
      rating = m ? m[0] : text;
    } else if (text.includes('min') || text.includes('hr')) {
      duration = text;
    } else {
      typeLabel = text;
    }
  });

  const epWrap = infoEl.find('.meta > .ep-wrap');
  let epSub = null, epDub = null;
  if (epWrap.length) {
    epSub = epWrap.find('.ep-status.sub span').text().trim() || null;
    epDub = epWrap.find('.ep-status.dub span').text().trim() || null;
  }

  return {
    id: slug || null,
    internalId: dataTip ? parseInt(dataTip) : null,
    title: title || null,
    titleJp,
    poster: posterUrl,
    episode: { sub: epSub, dub: epDub, total: null },
    type: typeLabel,
    rating,
    duration,
  };
}

function parseFlatScaffItem($, el) {
  const $item = $(el);
  const href = $item.attr('href') || '';
  const posterEl = $item.find('> .poster').first();
  const infoEl = $item.find('> .info').first();

  const img = posterEl.find('img').first();
  const titleEl = infoEl.find('.name.d-title').first();
  const title = titleEl.text().trim() || img.attr('alt') || '';
  const titleJp = titleEl.attr('data-jp') || null;
  const poster = getImgSrc(img);
  const dataTip = posterEl.attr('data-tip') || null;

  const slug = extractSlug(href);
  const posterUrl = poster ? resolveUrl(poster) : null;

  const dots = infoEl.find('.meta > .dot');
  let typeLabel = null, dateText = null;
  let epSub = null, epDub = null;

  dots.each((i, dot) => {
    const $dot = $(dot);
    if ($dot.hasClass('ep-wrap')) {
      epSub = $dot.find('.ep-status.sub span').text().trim() || null;
      epDub = $dot.find('.ep-status.dub span').text().trim() || null;
    } else if (!typeLabel) {
      typeLabel = $dot.text().trim() || null;
    } else {
      dateText = $dot.text().trim() || null;
    }
  });

  return {
    id: slug || null,
    internalId: dataTip ? parseInt(dataTip) : null,
    title: title || null,
    titleJp,
    poster: posterUrl,
    episode: { sub: epSub, dub: epDub, total: null },
    type: typeLabel,
    date: dateText,
  };
}

function parseFeaturedSlider($) {
  const items = [];
  $('.hotest #hotest .swiper-slide.item').each((i, el) => {
    const $el = $(el);
    const infoEl = $el.find('.info');
    const imageEl = $el.find('.image');

    const titleEl = infoEl.find('h2.title.d-title').first();
    const title = titleEl.text().trim();
    if (!title) return;

    const watchUrl = infoEl.find('.actions a.btn.play').first().attr('href') || null;
    const bgStyle = imageEl.find('div').first().attr('style') || '';
    const bgMatch = bgStyle.match(/url\(['"]?(.*?)['"]?\)/);

    items.push({
      id: watchUrl ? extractSlug(watchUrl) : null,
      title,
      titleJp: titleEl.attr('data-jp') || null,
      poster: bgMatch ? bgMatch[1] : null,
      rating: infoEl.find('.meta.icons i.rating').text().trim() || null,
      quality: infoEl.find('.meta.icons i.quality').text().trim() || null,
      date: infoEl.find('.meta.icons i.date').text().trim() || null,
      hasSub: infoEl.find('.meta.icons i.sub').length > 0,
      hasDub: infoEl.find('.meta.icons i.dub').length > 0,
      synopsis: infoEl.find('.synopsis').text().trim() || null,
    });
  });
  return items;
}

function parseSectionAniItems($, sectionIndex) {
  const items = [];
  const $section = $('section').eq(sectionIndex);
  if (!$section.length) return items;

  $section.find('.ani.items .item .ani.poster').each((i, el) => {
    const posterEl = $(el).find('.ani.poster').first();
    if (!posterEl.length) return;
    const parsed = parsePosterItem($, posterEl);
    const nameLink = $(el).find('.info a.name.d-title').first();
    items.push({ ...parsed, titleJp: nameLink.attr('data-jp') || null });
  });
  return items;
}

function parseSectionScaffItems($, sectionIndex) {
  const items = [];
  const $section = $('section').eq(sectionIndex);
  if (!$section.length) return items;

  $section.find('.scaff.items > a.item').each((i, el) => {
    const parsed = parseScaffItem($, el);
    if (parsed.title) items.push(parsed);
  });
  return items;
}

function parseSectionFlatScaffItems($, sectionIndex) {
  const items = [];
  const $section = $('section').eq(sectionIndex);
  if (!$section.length) return items;

  $section.find('.scaff.items > a.item').each((i, el) => {
    const parsed = parseFlatScaffItem($, el);
    if (parsed.title) items.push(parsed);
  });
  return items;
}

function parseSidebarTopAnime($) {
  const groups = [];
  $('.scaff.side.items').each((gIdx, container) => {
    const $container = $(container);
    const items = [];
    $container.find('> a.item').each((i, el) => {
      const parsed = parseScaffItem($, el);
      if (parsed.title) items.push(parsed);
    });
    if (items.length) groups.push(items);
  });
  return groups;
}

async function scrapeHome() {
  const ck = cacheKey('scrapeHome');
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const response = await axios.get(`${BASE_URL}/home`, {
      headers: requestHeaders,
    });
    const $ = cheerio.load(response.data);

    const featured = parseFeaturedSlider($);

    const sectionMap = {};
    $('section').each((i, section) => {
      const $s = $(section);
      const id = $s.attr('id') || '';
      const cls = $s.attr('class') || '';
      const title = $s.find('.head .title').first().text().trim() || '';
      if (title) sectionMap[title] = { index: i, id, class: cls };
    });

    const latestEpisodes = sectionMap['Latest Episode']
      ? parseSectionAniItems($, sectionMap['Latest Episode'].index) : [];

    const upcoming = sectionMap['Upcoming Anime']
      ? parseSectionAniItems($, sectionMap['Upcoming Anime'].index) : [];

    const newRelease = sectionMap['New Release']
      ? parseSectionFlatScaffItems($, sectionMap['New Release'].index) : [];

    const newAdded = sectionMap['New Added']
      ? parseSectionFlatScaffItems($, sectionMap['New Added'].index) : [];

    const justCompleted = sectionMap['Just Completed']
      ? parseSectionFlatScaffItems($, sectionMap['Just Completed'].index) : [];

    const topAnimeSidebar = sectionMap['Top anime']
      ? parseSectionScaffItems($, sectionMap['Top anime'].index) : [];

    const sidebarGroups = parseSidebarTopAnime($);

    const pageTitle = $('title').text().trim();

    const _cr = {
      success: true,
      data: {
    //    title: pageTitle,
        scrapedAt: new Date().toISOString(),
        sections: {
          featured: { title: 'Featured', items: featured, totalCount: featured.length },
          latestEpisodes: { title: 'Latest Episode', items: latestEpisodes, totalCount: latestEpisodes.length },
          upcoming: { title: 'Upcoming Anime', items: upcoming, totalCount: upcoming.length },
          newRelease: { title: 'New Release', items: newRelease, totalCount: newRelease.length },
          newAdded: { title: 'New Added', items: newAdded, totalCount: newAdded.length },
          justCompleted: { title: 'Just Completed', items: justCompleted, totalCount: justCompleted.length },
          topAnime: { title: 'Top Anime', items: topAnimeSidebar, totalCount: topAnimeSidebar.length },
          topAnimeTabs: sidebarGroups.length ? {
            day: sidebarGroups[0] || [],
            week: sidebarGroups[1] || [],
            month: sidebarGroups[2] || [],
          } : null,
        },
        sectionNames: Object.keys(sectionMap),
      },
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
  }
}

async function scrapeAnimeInfo(animeId) {
  const ck = cacheKey('scrapeAnimeInfo', animeId);
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const url = `${BASE_URL}/watch/${animeId}`;
    const response = await axios.get(url, {
      headers: { ...requestHeaders, 'Accept': 'text/html' },
    });
    const $ = cheerio.load(response.data);

    const titleEl = $('.binfo .info h1.title.d-title').first();
    const title = titleEl.text().trim() || $('meta[property="og:title"]').attr('content') || null;
    const titleJp = titleEl.attr('data-jp') || null;
    const poster = resolveUrl(getImgSrc($('.binfo > .poster img').first())) ||
                   $('meta[property="og:image"]').attr('content') || null;

    const synopsis = $('.binfo .info .synopsis .content').first().text().trim() ||
                     $('.binfo .info .synopsis').first().text().trim() || null;

    const rawRating = $('.brating .score .value').first().text().trim() ||
                      $('.binfo .info .meta.icons i.rating').text().trim() || null;
    const rating = rawRating ? rawRating.split(/\s+/)[0] : null;

    const metadata = {};
    $('.bmeta > .meta > div, .bmeta .meta div').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const colonIdx = text.indexOf(':');
      if (colonIdx === -1) return;
      const label = text.substring(0, colonIdx).trim().toLowerCase();
      const value = text.substring(colonIdx + 1).trim();
      if (label && value) metadata[label] = value;
    });

    const genres = [];
    $('.bmeta .meta a[href*="/genre/"]').each((i, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const altTitles = $('.binfo .info .names').first().text().trim() || null;

    const internalId = $('[data-id]').first().attr('data-id') || null;

    let episodes = [];
    let resolvedId = internalId;
    if (!resolvedId) {
      $('script').each((i, el) => {
        const text = $(el).html() || '';
        const m = text.match(/[?&]id[=:](-?\d+)/);
        if (m && !resolvedId) resolvedId = m[1];
      });
    }

    if (resolvedId) {
      try {
        const epRes = await axios.get(`${BASE_URL}/ajax/episode/list/${resolvedId}`, {
          headers: {
            ...requestHeaders,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/html, */*',
            'Referer': `${BASE_URL}/watch/${animeId}`,
          },
        });

        const data = epRes.data;
        if (data && data.status === 200 && data.result) {
          const $ep = cheerio.load(data.result);
          $ep('a[data-num]').each((i, el) => {
            const $el = $ep(el);
            const num = $el.attr('data-num');
            const epTitle = $el.attr('title') || null;
            const sub = $el.attr('data-sub') === '1';
            const dub = $el.attr('data-dub') === '1';

            episodes.push({
              episode: num ? parseInt(num) : null,
              title: epTitle,
              subtitled: sub,
              dubbed: dub,
            });
          });
        }
      } catch (e) {
      }
    }

    episodes.sort((a, b) => (a.episode || 0) - (b.episode || 0));

    const recommended = [];
    $('aside.sidebar .scaff.side.items > a.item, .scaff.side.items > a.item').each((i, el) => {
      const parsed = parseScaffItem($, el);
      if (parsed.title && parsed.id !== animeId) recommended.push(parsed);
    });

    const _cr = {
      success: true,
      data: {
        id: animeId,
        internalId,
        title,
        titleJp,
        synopsis,
        poster,
        rating,
        genres: genres.length ? genres : undefined,
        alternativeTitles: altTitles,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        totalEpisodes: episodes.length,
        episodes: episodes.length ? episodes : undefined,
        recommended: recommended.length ? recommended.slice(0, 20) : undefined,
      },
      timestamp: new Date().toISOString(),
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, id: animeId, timestamp: new Date().toISOString() };
  }
}

async function scrapeSearch(keyword) {
  const ck = cacheKey('scrapeSearch', keyword.toLowerCase());
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const searchUrls = [
      `${BASE_URL}/filter?keyword=${encodeURIComponent(keyword)}`,
      `${BASE_URL}/search?keyword=${encodeURIComponent(keyword)}`,
      `${BASE_URL}/search?q=${encodeURIComponent(keyword)}`,
    ];

    let $ = null;
    for (const url of searchUrls) {
      try {
        const response = await axios.get(url, {
          headers: requestHeaders,
        });
        $ = cheerio.load(response.data);
        const testItems = $('.ani.items .item .ani.poster, .scaff.items > a.item, .items > a.item');
        if (testItems.length > 0) break;
      } catch (e) {
        continue;
      }
    }

    if (!$) {
      return {
        success: true,
        data: { query: keyword, results: [], totalCount: 0, scrapedAt: new Date().toISOString() },
      };
    }

    const results = [];
    const seenSlugs = new Set();

    $('.ani.items .item .ani.poster').each((i, el) => {
      const parsed = parsePosterItem($, el);
      if (parsed.title && !seenSlugs.has(parsed.id)) {
        seenSlugs.add(parsed.id);
        const nameLink = $(el).closest('.item').find('.info a.name.d-title').first();
        results.push({ ...parsed, titleJp: nameLink.attr('data-jp') || null });
      }
    });

    if (results.length === 0) {
      $('.scaff.items > a.item').each((i, el) => {
        const parsed = parseScaffItem($, el);
        if (parsed.title && !seenSlugs.has(parsed.id)) {
          seenSlugs.add(parsed.id);
          results.push(parsed);
        }
      });
    }

    if (results.length === 0) {
      $('.scaff.items > a.item').each((i, el) => {
        const parsed = parseFlatScaffItem($, el);
        if (parsed.title && !seenSlugs.has(parsed.id)) {
          seenSlugs.add(parsed.id);
          results.push(parsed);
        }
      });
    }

    if (results.length === 0) {
      $('.items > a.item, a.item.scaff').each((i, el) => {
        const parsed = parseScaffItem($, el);
        if (parsed.title && !seenSlugs.has(parsed.id)) {
          seenSlugs.add(parsed.id);
          results.push(parsed);
        }
      });
    }

    const _cr = {
      success: true,
      data: {
        query: keyword,
        results,
        totalCount: results.length,
        scrapedAt: new Date().toISOString(),
      },
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, query: keyword, timestamp: new Date().toISOString() };
  }
}

async function scrapeSchedule(dateParam) {
  const ck = cacheKey('scrapeSchedule', dateParam || 'default');
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const apiUrl = `${BASE_URL}/ajax/schedule${dateParam ? '?date=' + encodeURIComponent(dateParam) : ''}`;
    const response = await axios.get(apiUrl, {
      headers: { ...requestHeaders, 'Accept': 'application/json, text/html, */*' },
    });

    const data = response.data;
    if (data && data.status === 200 && data.result) {
      const $ = cheerio.load(data.result);

      const days = [];
      $('.head .days .item, .head .swiper-slide').each((i, el) => {
        const $el = $(el);
        const dateText = $el.find('.date').text().trim();
        const weekday = $el.find('.wday').text().trim();
        const timestamp = $el.attr('data-time') || null;
        if (dateText || timestamp) {
          days.push({
            date: dateText || null,
            weekday: weekday || null,
            timestamp: timestamp ? parseInt(timestamp) : null,
            active: $el.hasClass('active') || false,
          });
        }
      });

      const items = [];
      $('.body .item, .items .item, a.item').each((i, el) => {
        const $el = $(el);
        const href = $el.attr('href') || '';
        const timeText = $el.find('.time').text().trim();
        const epText = $el.find('.ep').text().trim();
        const title = $el.find('.title, .d-title').text().trim();
        if (href && title) {
          const id = extractSlug(href);
          items.push({
            id,
            title,
            time: timeText || null,
            episode: epText || null,
          });
        }
      });

      const _cr = {
        success: true,
        data: { type: 'schedule', date: dateParam || null, days: days.length ? days : undefined, items, totalCount: items.length },
        timestamp: new Date().toISOString(),
      };
      cacheSet(ck, _cr);
      return _cr;
    }

    const fallbackUrl = `${BASE_URL}/schedule${dateParam ? '?date=' + encodeURIComponent(dateParam) : ''}`;
    const fallbackResponse = await axios.get(fallbackUrl, {
      headers: requestHeaders,
    });
    const $ = cheerio.load(fallbackResponse.data);

    const items = [];
    $('.scaff.items > a.item, .ani.items .item').each((i, el) => {
      const parsed = parseScaffItem($, el);
      if (parsed.title) items.push(parsed);
    });

    $('.scaff.items > a.item').each((i, el) => {
      const parsed = parseFlatScaffItem($, el);
      if (parsed.title) items.push(parsed);
    });

    const _cr = {
      success: true,
      data: { type: 'schedule', date: dateParam || null, items, totalCount: items.length },
      timestamp: new Date().toISOString(),
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
  }
}

async function scrapeListing(url) {
  const ck = cacheKey('scrapeListing', url);
  const cached = cacheGet(ck);
  if (cached) return cached;
  if (!url.startsWith('https://anikoto.cz') && !url.startsWith('http://anikoto.cz')) {
    throw new Error('Invalid listing path');
  }

  try {
    const response = await axios.get(url, {
      headers: requestHeaders,
    });
    const $ = cheerio.load(response.data);
    const animeList = [];
    const seenSlugs = new Set();

    $('.ani.items .item .ani.poster').each((i, el) => {
      const item = parsePosterItem($, el);
      if (item.title && !seenSlugs.has(item.id)) {
        seenSlugs.add(item.id);
        const nameLink = $(el).closest('.item').find('.info a.name.d-title').first();
        animeList.push({ ...item, titleJp: nameLink.attr('data-jp') || null });
      }
    });

    if (animeList.length === 0) {
      $('.scaff.items > a.item').each((i, el) => {
        const item = parseScaffItem($, el);
        if (item.title && !seenSlugs.has(item.id)) {
          seenSlugs.add(item.id);
          animeList.push(item);
        }
      });
    }

    if (animeList.length === 0) {
      $('.scaff.items > a.item').each((i, el) => {
        const item = parseFlatScaffItem($, el);
        if (item.title && !seenSlugs.has(item.id)) {
          seenSlugs.add(item.id);
          animeList.push(item);
        }
      });
    }

    const pageTitle = $('title').text().trim() || $('h1').first().text().trim() || '';

    let currentPage = 1;
    let totalPages = 1;
    const activePageEl = $('li.page-item.active a.page-link').first();
    if (activePageEl.length) {
      currentPage = parseInt(activePageEl.text().trim()) || 1;
    }
    const lastPageLink = $('a.page-link[title="Last"], a.page-link[title^="Page "]').last();
    if (lastPageLink.length) {
      const lastTitle = lastPageLink.attr('title') || '';
      const lastHref = lastPageLink.attr('href') || '';
      const pageMatch = lastTitle.match(/Page\s+(\d+)/) || lastTitle.match(/(\d+)/);
      const hrefMatch = lastHref.match(/page=(\d+)/);
      totalPages = parseInt(pageMatch?.[1] || hrefMatch?.[1]) || 1;
    }

    const _cr = {
      success: true,
      data: {
        page: pageTitle,
        animeList,
        totalCount: animeList.length,
        pagination: { currentPage, totalPages },
        scrapedAt: new Date().toISOString(),
      },
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
  }
}

async function getEpisodeList(animeId) {
  const ck = cacheKey('getEpisodeList', animeId);
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const watchRes = await axios.get(`${BASE_URL}/watch/${animeId}`, {
      headers: { ...requestHeaders, 'Accept': 'text/html' },
    });
    const $ = cheerio.load(watchRes.data);
    const internalId = $('[data-id]').first().attr('data-id');

    let resolvedId = internalId;
    if (!resolvedId) {
      $('script').each((i, el) => {
        const text = $(el).html() || '';
        const m = text.match(/[?&]id[=:](-?\d+)/);
        if (m && !resolvedId) resolvedId = m[1];
      });
      if (!resolvedId) throw new Error('Could not resolve internal anime ID');
    }

    const epRes = await axios.get(`${BASE_URL}/ajax/episode/list/${resolvedId}`, {
      headers: {
        ...requestHeaders,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/html, */*',
        'Referer': `${BASE_URL}/watch/${animeId}`,
      },
    });

    const data = epRes.data;
    if (!data || data.status !== 200 || !data.result) {
      throw new Error('Episode list returned invalid response');
    }

    const episodes = [];
    const $ep = cheerio.load(data.result);
    $ep('a[data-num]').each((i, el) => {
      const $el = $ep(el);
      const num = $el.attr('data-num');
      const epTitle = $el.attr('title') || null;
      const ids = $el.attr('data-ids') || null;
      const epId = $el.attr('data-id') || null;
      const slug = $el.attr('data-slug');
      const malId = $el.attr('data-mal') || null;
      const ts = $el.attr('data-timestamp') || null;
      const sub = $el.attr('data-sub') === '1';
      const dub = $el.attr('data-dub') === '1';

      episodes.push({
        episode: num ? parseInt(num) : null,
        title: epTitle,
        dataIds: ids,
        internalEpId: epId ? parseInt(epId) : null,
        malId: malId ? parseInt(malId) : null,
        timestamp: ts ? parseInt(ts) : null,
        subtitled: sub,
        dubbed: dub,
      });
    });

    episodes.sort((a, b) => (a.episode || 0) - (b.episode || 0));

    const _cr = {
      success: true,
      data: {
        animeId,
        internalId,
        totalEpisodes: episodes.length,
        episodes,
      },
      timestamp: new Date().toISOString(),
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, id: animeId, timestamp: new Date().toISOString() };
  }
}

async function getBestVariant(m3u8Url, refererUrl) {
  try {
    if (!m3u8Url) return null;
    const resp = await axios.get(m3u8Url, {
      headers: { ...requestHeaders, 'Referer': refererUrl || m3u8Url },
      timeout: 10000,
    });
    const lines = resp.data.split('\n');
    let bestUrl = null, bestBw = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const bw = bwMatch ? parseInt(bwMatch[1]) : 0;
        const next = lines[i + 1]?.trim();
        if (next && !next.startsWith('#') && bw > bestBw) {
          bestBw = bw;
          bestUrl = next.startsWith('http') ? next : new URL(next, m3u8Url).href;
        }
      }
    }
    return bestUrl || m3u8Url;
  } catch {
    return m3u8Url;
  }
}

async function getStreamUrl(animeId, epNum) {
  const ck = cacheKey('getStreamUrl', animeId, epNum);
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const epList = await getEpisodeList(animeId);
    if (!epList.success) throw new Error(epList.error);

    const targetEp = epList.data.episodes.find(e => e.episode === parseInt(epNum));
    if (!targetEp) throw new Error(`Episode ${epNum} not found`);

    const servers = [];

    const resolveDownloadUrl = async (url) => {
      try {
        if (!url || !url.includes('pahe.nekostream.site')) return url;
        const res = await axios.get(url, {
          headers: { ...requestHeaders, 'Referer': `${BASE_URL}/` },
          timeout: 8000,
        });
        const match = res.data?.match(/href\s*=\s*"([^"]+)"\s*\+\s*id/);
        if (match) {
          const base = match[1].replace(/\/+$/, '');
          const token = url.split('/').filter(Boolean).pop();
          return base + '/' + token;
        }
        return url;
      } catch { return url; }
    };

    const tryResolve = async (linkId) => {
      try {
        const res = await axios.get(`${BASE_URL}/ajax/server?get=${encodeURIComponent(linkId)}`, {
          headers: { ...requestHeaders, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', 'Referer': `${BASE_URL}/watch/${animeId}` },
        });
        if (res.data && res.data.status === 200 && res.data.result) {
          return { url: res.data.result.url || null, skipData: res.data.result.skip_data || null };
        }
        return { url: null, skipData: null };
      } catch { return { url: null, skipData: null }; }
    };

    const resolveServer = async (server) => {
      const resolved = await tryResolve(server.linkId);
      const url = resolved.url;
      if (!url) return { name: server.name, type: server.type, url: null, hlsUrl: null, tracks: [] };
      let hlsUrl = null;
      let tracks = [];
      let downloadUrl = null;
      let intro = null, outro = null;
      if (resolved.skipData) {
        intro = resolved.skipData.intro?.[0] > 0 ? resolved.skipData.intro[0] : null;
        outro = resolved.skipData.outro?.[0] > 0 ? resolved.skipData.outro[0] : null;
      }
      const hls = await extractHlsUrl(url);
      if (hls.success) {
        hlsUrl = hls.data.m3u8;
        tracks = hls.data.tracks || [];
        downloadUrl = await getBestVariant(hlsUrl, url);
        if (!intro) intro = hls.data.intro || null;
        if (!outro) outro = hls.data.outro || null;
      }
      return { name: server.name, type: server.type, url, hlsUrl, tracks, downloadUrl, intro, outro };
    };


    if (targetEp.dataIds) {
      try {
        const serverListRes = await axios.get(`${BASE_URL}/ajax/server/list?servers=${encodeURIComponent(targetEp.dataIds)}`, {
          headers: {
            ...requestHeaders,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json',
            'Referer': `${BASE_URL}/watch/${animeId}`,
          },
        });

        if (serverListRes.data && serverListRes.data.status === 200 && serverListRes.data.result) {
          const $ = cheerio.load(serverListRes.data.result);

          const rawServers = [];
          $('li[data-link-id]').each((i, el) => {
            const $el = $(el);
            rawServers.push({
              name: $el.text().trim(),
              type: $el.closest('.type').attr('data-type') || 'sub',
              linkId: $el.attr('data-link-id'),
            });
          });


          const resolved = await Promise.all(rawServers.map(s => resolveServer(s)));
          servers.push(...resolved);
        }
      } catch (e) {}
    }

    if (targetEp.malId && targetEp.timestamp) {
      try {
        const mapperUrl = `https://mapper.nekostream.site/api/mal/${targetEp.malId}/${targetEp.slug || epNum}/${targetEp.timestamp}`;
        const mapperRes = await axios.get(mapperUrl, {
          headers: {
            ...requestHeaders,
            'Accept': 'application/json',
            'Referer': `${BASE_URL}/watch/${animeId}`,
            'Origin': BASE_URL,
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
          },
        });
        if (mapperRes.data && typeof mapperRes.data === 'object') {
          const downloadMap = {};
          for (const [key, val] of Object.entries(mapperRes.data)) {
            const norm = key.replace(/[-_\s]+$/, '');
            for (const type of ['sub', 'dub']) {
              const dl = val?.[type]?.download;
              if (dl && typeof dl === 'object') {
                const resolved = {};
                for (const [label, dlUrl] of Object.entries(dl)) {
                  resolved[label] = await resolveDownloadUrl(dlUrl);
                }
                downloadMap[norm + ' ' + type] = resolved;
              }
            }
          }
          for (const [key, val] of Object.entries(mapperRes.data)) {
            for (const type of ['sub', 'dub']) {
              const linkId = val?.[type]?.url;
              if (!linkId) continue;
              const resolved = await tryResolve(linkId);
              if (!resolved.url) continue;
              let hlsUrl = null;
              let tracks = [];
              let downloadUrl = null;
              let downloadLinks = null;
              let intro = null, outro = null;
              const norm = key.replace(/[-_\s]+$/, '');
              downloadLinks = downloadMap[norm + ' ' + type] || null;
              if (resolved.skipData) {
                intro = resolved.skipData.intro?.[0] > 0 ? resolved.skipData.intro[0] : null;
                outro = resolved.skipData.outro?.[0] > 0 ? resolved.skipData.outro[0] : null;
              }
              const hls = await extractHlsUrl(resolved.url);
              if (hls.success) {
                hlsUrl = hls.data.m3u8;
                tracks = hls.data.tracks || [];
                downloadUrl = await getBestVariant(hlsUrl, resolved.url);
                if (!intro) intro = hls.data.intro || null;
                if (!outro) outro = hls.data.outro || null;
              }
              servers.push({ name: key + ' ' + type.toUpperCase(), type, url: resolved.url, hlsUrl, tracks, downloadUrl, downloadLinks, intro, outro });
            }
          }
        }
      } catch (e) {}
    }

    const _cr = {
      success: true,
      data: {
        animeId,
        episode: targetEp.episode,
        internalEpId: targetEp.internalEpId,
        dataIds: targetEp.dataIds,
        servers,
      },
      timestamp: new Date().toISOString(),
    };
    cacheSet(ck, _cr);
    return _cr;
  } catch (error) {
    return { success: false, error: error.message, id: animeId, ep: epNum, timestamp: new Date().toISOString() };
  }
}

async function extractHlsUrl(embedUrl) {
  try {
    if (!embedUrl) return { success: false, error: 'No URL provided' };

    // mewcdn.online/player/plyr.php#base64 → direct m3u8 from hash fragment
    if (embedUrl.includes('plyr.php#')) {
      const hash = embedUrl.split('#')[1];
      if (hash) {
        const decoded = Buffer.from(decodeURIComponent(hash), 'base64').toString('utf-8');
        if (decoded) {
          return { success: true, data: { m3u8: decoded, tracks: [], referer: embedUrl, intro: null, outro: null, server: null } };
        }
      }
    }

    // megaplay.buzz / vidtube.site / any /stream/{...} pattern with getSources API
    const domainMatch = embedUrl.match(/https?:\/\/([^\/]+)/);
    const domain = domainMatch ? domainMatch[1] : null;
    if (!domain) return { success: false, error: 'Could not parse domain' };

    const pageResp = await axios.get(embedUrl, {
      headers: { ...requestHeaders, 'Referer': embedUrl },
      validateStatus: s => s < 500,
      timeout: 15000,
    });

    const html = pageResp.data;
    const dataIdMatch = html.match(/data-id="(\d+)"/);
    if (dataIdMatch) {
      const dataId = dataIdMatch[1];
      const sourcesResp = await axios.get(`https://${domain}/stream/getSources?id=${dataId}`, {
        headers: {
          ...requestHeaders,
          'Referer': embedUrl,
          'Origin': `https://${domain}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      const sourcesData = sourcesResp.data;
      if (sourcesData && sourcesData.sources && sourcesData.sources.file) {
        return {
          success: true,
          data: {
            m3u8: sourcesData.sources.file,
            tracks: sourcesData.tracks || [],
            referer: embedUrl,
            intro: sourcesData.intro || null,
            outro: sourcesData.outro || null,
            server: sourcesData.server || null,
          },
        };
      }
    }

    return { success: false, error: 'Could not extract HLS URL' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  scrapeHome,
  scrapeAnimeInfo,
  scrapeListing,
  scrapeSearch,
  scrapeSchedule,
  getEpisodeList,
  getStreamUrl,
  extractHlsUrl,
  BASE_URL,
};
