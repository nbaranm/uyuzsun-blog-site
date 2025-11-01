
// netlify/functions/api.mjs
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'uyuzsun-store-v2';
const POSTS_KEY = 'posts.json';
const ARCHIVE_KEY = 'archive.json';
const REPORTERS_KEY = 'reporters.json'; // postId -> {anonId:1}
const STARRERS_KEY = 'starrers.json';   // postId -> {anonId:1}
const RL_KEY = 'ratelimits.json';       // anonId -> {minuteKey:count}

const PAGE_SIZE_CAP = 50;
const HIDE_THRESHOLD = 10;
const MAX_PER_MINUTE = 20; // rate limit
const ARCHIVE_DAYS = 30;

// keyword lists, easy to extend
const bannedWordGroups = {
  profanity: ["siktir","amk","aq","orospu","pezevenk","piç","sıç","göt","yarrak","amına","sikerim","ibne","salak","aptal","gerizekalı"],
  religion: ["allah","tanrı","din","imam","camii","cami","kilise","haham","müslüman","hristiyan","yahudi","ateist","mezhep","şeriat"],
  politics: ["cumhurbaşkanı","başkan","bakan","milletvekili","parti","chp","akp","mhp","iyi parti","hükümet","seçim","oy","tbmm","belediye başkanı"],
};
const corpMarkers = ["a.ş","aş","a.s","a.s.","a. ş.","anonim","holding","belediyesi","üniversitesi","banka","sigorta","sanayi","ticaret","a. ş","ltd","ltd.","limited","inc","corp","kurum","bakanlık","müdürlüğü"];

function hasBanned(text) {
  const t = ` ${text.toLowerCase()} `;
  for (const group of Object.values(bannedWordGroups)) {
    for (const w of group) {
      if (t.includes(` ${w} `)) return {type:'ban', word:w};
    }
  }
  for (const m of corpMarkers) {
    if (t.includes(m)) return {type:'corp', word:m};
  }
  if (/\b\d{10,}\b/.test(t) || /@/.test(t)) return {type:'dox', word:'kişisel bilgi'};
  return null;
}

function ok(body, status=200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
}
function bad(msg, status=400) {
  return ok({ error: msg }, status);
}

function anonIdFromHeaders(headers) {
  const ua = headers.get('user-agent') || '';
  const ip = headers.get('x-nf-client-connection-ip') || headers.get('x-forwarded-for') || '0.0.0.0';
  const day = new Date().toISOString().slice(0,10);
  return `${ip}|${ua.slice(0,24)}|${day}`; // daily rotate to reduce tracking
}
function minuteKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

async function readJSON(store, key, fallback) {
  const blob = await store.get(key, { type: 'json' });
  return blob ?? fallback;
}
async function writeJSON(store, key, value) {
  await store.set(key, JSON.stringify(value), { contentType: 'application/json' });
}

async function ensureArchive(store) {
  let posts = await readJSON(store, POSTS_KEY, []);
  const cutoff = Date.now() - ARCHIVE_DAYS*24*60*60*1000;
  const recent = [];
  const old = [];
  for (const p of posts) {
    if (p.ts < cutoff) old.push(p); else recent.push(p);
  }
  if (old.length) {
    const archive = await readJSON(store, ARCHIVE_KEY, []);
    await writeJSON(store, ARCHIVE_KEY, archive.concat(old));
    await writeJSON(store, POSTS_KEY, recent);
  }
}

function isAuthorized(req) {
  const token = process.env.ADMIN_TOKEN || '';
  const auth = req.headers.get('authorization') || '';
  if (token && auth.startsWith('Bearer ')) {
    const provided = auth.slice(7).trim();
    if (provided === token) return true;
  }
  return false;
}

export default async (req) => {
  const url = new URL(req.url);
  const op = url.searchParams.get('op') || 'list';
  const store = getStore(STORE_NAME);

  // housekeeping (archive old posts)
  await ensureArchive(store);

  let posts = await readJSON(store, POSTS_KEY, []);
  let reporters = await readJSON(store, REPORTERS_KEY, {});
  let starrers = await readJSON(store, STARRERS_KEY, {});
  let rl = await readJSON(store, RL_KEY, {});

  const anon = anonIdFromHeaders(req.headers);

  // Rate limit
  const mk = minuteKey();
  rl[anon] = rl[anon] || {};
  rl[anon][mk] = (rl[anon][mk] || 0) + 1;
  if (rl[anon][mk] > MAX_PER_MINUTE) {
    await writeJSON(store, RL_KEY, rl);
    return bad('Çok hızlısın. Biraz yavaşla.', 429);
  }
  await writeJSON(store, RL_KEY, rl);

  if (op === 'create' && req.method === 'POST') {
    const { text, consent } = await req.json().catch(()=>({}));
    if (!text || String(text).trim().length < 8) return bad('Biraz daha detay yaz (en az 8 karakter).');
    // Consent: require for first post of the day from this anon
    const firstToday = !(starrers.__consent && starrers.__consent[anon]);
    if (firstToday && !consent) return bad('İlk paylaşım için kuralları kabul etmelisin.');
    const badInfo = hasBanned(String(text));
    if (badInfo) {
      if (badInfo.type === 'ban') return bad('Küfür/din/siyaset içeriği yasak. Metni sadeleştir.');
      if (badInfo.type === 'corp') return bad('Kurum/marka isimleri yasak. Kişiyi/olayı genel anlat.');
      if (badInfo.type === 'dox') return bad('Telefon/e-posta gibi kişisel bilgiler paylaşma.');
    }
    const id = crypto.randomUUID();
    const ts = Date.now();
    const post = { id, ts, text: String(text).trim(), reports:0, stars:0, hidden:false };
    posts.push(post);
    // mark consent for this anon (reuse starrers map for simplicity)
    starrers.__consent = starrers.__consent || {};
    starrers.__consent[anon] = 1;

    await writeJSON(store, POSTS_KEY, posts);
    await writeJSON(store, STARRERS_KEY, starrers);
    return ok({ id });
  }

  if (op === 'report' && req.method === 'POST') {
    const { id } = await req.json().catch(()=>({}));
    if (!id) return bad('Eksik id');
    reporters[id] = reporters[id] || {};
    if (reporters[id][anon]) return ok({ status:'ok' }); // already reported this minute/day
    reporters[id][anon] = 1;

    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return bad('Bulunamadı', 404);
    posts[idx].reports = (posts[idx].reports || 0) + 1;
    if (posts[idx].reports >= HIDE_THRESHOLD) posts[idx].hidden = true;

    await writeJSON(store, POSTS_KEY, posts);
    await writeJSON(store, REPORTERS_KEY, reporters);
    return ok({ status:'ok', reports: posts[idx].reports, hidden: posts[idx].hidden });
  }

  if (op === 'star' && req.method === 'POST') {
    const { id } = await req.json().catch(()=>({}));
    if (!id) return bad('Eksik id');
    starrers[id] = starrers[id] || {};
    if (starrers[id][anon]) return ok({ status:'ok' }); // already starred in the period
    starrers[id][anon] = 1;

    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return bad('Bulunamadı', 404);
    posts[idx].stars = (posts[idx].stars || 0) + 1;

    await writeJSON(store, POSTS_KEY, posts);
    await writeJSON(store, STARRERS_KEY, starrers);
    return ok({ status:'ok', stars: posts[idx].stars });
  }

  if (op === 'highlights') {
    const days = Math.max(1, Math.min(31, Number(url.searchParams.get('days') || 7)));
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 5)));
    const since = Date.now() - days*24*60*60*1000;
    const items = posts
      .filter(p => !p.hidden && p.ts >= since)
      .sort((a,b) => (b.stars||0) - (a.stars||0) || b.ts - a.ts)
      .slice(0, limit);
    return ok({ items });
  }

  if (op === 'admin_list') {
    if (!isAuthorized(req)) return bad('Yetkisiz', 401);
    const items = posts.sort((a,b)=>b.ts-a.ts);
    return ok({ items });
  }
  if (op === 'admin_toggle' && req.method === 'POST') {
    if (!isAuthorized(req)) return bad('Yetkisiz', 401);
    const { id } = await req.json().catch(()=>({}));
    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return bad('Bulunamadı', 404);
    posts[idx].hidden = !posts[idx].hidden;
    await writeJSON(store, POSTS_KEY, posts);
    return ok({ hidden: posts[idx].hidden });
  }
  if (op === 'admin_delete' && req.method === 'POST') {
    if (!isAuthorized(req)) return bad('Yetkisiz', 401);
    const { id } = await req.json().catch(()=>({}));
    const next = posts.filter(p => p.id !== id);
    await writeJSON(store, POSTS_KEY, next);
    return ok({ status:'ok' });
  }
  if (op === 'archive_run') {
    if (!isAuthorized(req)) return bad('Yetkisiz', 401);
    await ensureArchive(store);
    return ok({ status:'ok' });
  }

  // default: list (exclude archived by design)
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const size = Math.max(1, Math.min(PAGE_SIZE_CAP, Number(url.searchParams.get('size') || 20)));
  const visible = posts
    .sort((a,b) => b.ts - a.ts)
    .map(p => ({...p}));
  const total = visible.length;
  const pages = Math.max(1, Math.ceil(total/size));
  const start = (page-1)*size;
  const items = visible.slice(start, start+size);

  return ok({ page, pages, total, items });
}
