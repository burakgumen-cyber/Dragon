// Avcı Toynaklar - oyun sunucusu
// Çalıştırma: npm install && npm start  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DEFAULT_ROOM = 'toynaklar';   // oda adı verilmezse herkes buraya girer

// ---------- Dünya sabitleri (istemciyle aynı) ----------
const W = 1600, H = 900, GY0 = 392, GY1 = 850;
const TICK = 50;            // ms (20 Hz)
const ROUNDS = [60, 120, 180, 300];   // seçilebilir tur süreleri (sn)
const DEFAULT_ROUND = 120;
const BREAK = 10;           // turlar arası (sn)
const MAXCH = 18;           // aynı anda en fazla tavuk
const TOP_N = 10;           // her süre için saklanan rekor sayısı
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, 'data', 'scores.json');
const MAXP = 8;             // oda başına en fazla avcı
// Silahlar (istemciyle aynı). gap: atışlar arası ms, rm: isabet alanı çarpanı, scare: atışın ürküttüğü yarıçap
const WEAPONS = {
  rifle: { mag: 6, gap: 360, reload: 1800, rm: 1, scare: 280 },     // gürültülü, isabetli, yavaş
  sling: { mag: 10, gap: 340, reload: 900, rm: 0.85, scare: 90 },   // sessiz, hızlı, küçük isabet alanı
};

const COVERS = [
  { x: 560, y: 640, w: 150, h: 110, type: 'hay' },
  { x: 1380, y: 780, w: 170, h: 120, type: 'hay' },
  { x: 880, y: 560, w: 160, h: 90, type: 'bush' },
  { x: 190, y: 790, w: 180, h: 100, type: 'bush' },
  { x: 1090, y: 710, w: 130, h: 120, type: 'well' },
  { x: 760, y: 830, w: 200, h: 110, type: 'cart' },
  { x: 700, y: 455, w: 120, h: 68, type: 'bush' },
  { x: 1010, y: 478, w: 108, h: 78, type: 'hay' },
  { x: 250, y: 525, w: 110, h: 72, type: 'hay' },
];
const SPAWNS = [
  { x: 433, y: 394 }, { x: 1167, y: 394 },              // ahır ve kümes kapısı
  { x: -50, y: 620 }, { x: 1650, y: 700 }, { x: -50, y: 800 }, { x: 1650, y: 540 },
  { x: -50, y: 450 }, { x: 1650, y: 440 },
];
// r: isabet yarıçapı, cy: hedef merkezinin yerden yüksekliği
const TYPES = {
  normal: { pts: 1, spd: 1, r: 32, cy: 28 },
  black: { pts: 2, spd: 1.25, r: 32, cy: 28 },
  golden: { pts: 5, spd: 1.9, r: 32, cy: 28 },
  rabbit: { pts: 10, spd: 1.5, r: 28, cy: 18 },
  fox: { pts: 20, spd: 1, r: 34, cy: 24 },
  cow: { pts: -5, spd: 0.4, r: 46, cy: 36 },    // sarı-lacivert inek: vurma, puan düşer
  dog: { pts: -8, spd: 1.1, r: 30, cy: 20 },    // yeşil köpek: vurma, puan düşer
  crow: { pts: 10, spd: 1, r: 26, cy: 14 },     // mavi karga: hızlı uçar, 10 puan
};
const PREY = new Set(['normal', 'black', 'golden', 'rabbit']);   // tilkinin avı olabilenler
const CHICK = new Set(['normal', 'black', 'golden']);            // uçarken vurulunca +1 alınanlar
const SPAWN_GAP = { cow: () => rnd(30, 45), dog: () => rnd(40, 60), crow: () => rnd(9, 16) };
const MAX_OF = { cow: 1, dog: 1, crow: 2 };
const ST = { walk: 0, run: 1, idle: 2, fly: 3, hide: 4, peek: 5, dead: 6, exit: 7, tohide: 8, stalk: 9, freeze: 10, pounce: 11, carry: 12 };
const TY = { normal: 0, black: 1, golden: 2, rabbit: 3, fox: 4, cow: 5, dog: 6, crow: 7 };
const FOX_RESCUE = 5;       // taşıdığı tavukla yakalanan tilkiyi vurana ek puan
// Dönme dolap (istemciyle aynı): kabinlerdeki ördekler. Açı yalnızca tick'e bağlı, ağdan gönderilmez.
const WHEEL = { x: 830, y: 262, R: 122, n: 6 };
const DUCK = { pts: 3, r: 16, dy: 14 };   // dy: ördek merkezinin kabin askı noktasından aşağıda olması
const wheelAng = tick => { const t = tick * TICK / 1000; return 0.42 * t + 0.28 * Math.sin(0.9 * t); };   // hızı 0.17-0.67 rad/sn arasında değişir
const duckPos = (i, tick) => { const a = wheelAng(tick) + i * 2 * Math.PI / WHEEL.n; return [WHEEL.x + WHEEL.R * Math.cos(a), WHEEL.y + WHEEL.R * Math.sin(a) + DUCK.dy]; };
// ördek durumları: 0 görünür, 1 kabinde eğilmiş, 2 vuruldu (düşüyor), 3 kabin boş
const COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#4895ef', '#9b5de5', '#00bbf9', '#f15bb5', '#80b918'];

const scale = y => 0.45 + (y - GY0) / (GY1 - GY0) * 0.75;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Rekorlar (süreye göre ayrı liste, en yüksek puan en üstte) ----------
// Dosyaya yazılır; ücretsiz barındırmada dosya sıfırlanabilir, bu yüzden oyuncuların tarayıcıları
// kendi rekorlarını katılırken tekrar gönderir ("pb") ve liste kendini toparlar.
let scores = {};
try { scores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')) || {}; } catch (e) { scores = {}; }
function saveScores() {
  try { fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true }); fs.writeFileSync(SCORES_FILE, JSON.stringify(scores)); } catch (e) {}
}
// true: bu oyuncunun rekoru yeni ya da yükseldi
function submitScore(dur, name, score) {
  score = Math.floor(+score);
  if (!ROUNDS.includes(dur) || !(score > 0) || score > dur * 2.5 + 80) return false;   // makul olmayan puanları yok say
  const list = scores[dur] || (scores[dur] = []);
  const ex = list.find(e => e.n === name);
  if (ex && score <= ex.s) return false;
  if (ex) { ex.s = score; ex.t = Date.now(); } else list.push({ n: name, s: score, t: Date.now() });
  list.sort((a, b) => b.s - a.s || a.t - b.t);
  if (list.length > TOP_N) list.length = TOP_N;
  saveScores();
  return list.some(e => e.n === name && e.s === score);
}

// ---------- Statik dosyalar ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/api/scores') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ rounds: ROUNDS, scores }));
  }
  if (p === '/api/rooms') {   // lobide gösterilecek oda doluluğu: yalnızca sayı, isim yok
    const list = [...rooms.values()].map(r => ({ id: r.id, n: r.players.size }));
    if (!rooms.has(DEFAULT_ROOM)) list.unshift({ id: DEFAULT_ROOM, n: 0 });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ def: DEFAULT_ROOM, max: MAXP, rooms: list.map(r => ({ ...r, d: rooms.has(r.id) ? rooms.get(r.id).round : null })) }));
  }
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

// ---------- Oda ----------
const rooms = new Map();

class Room {
  constructor(id, round) {
    this.id = id;
    this.round = ROUNDS.includes(round) ? round : DEFAULT_ROUND;   // tur süresi (sn); oda kurulurken seçilir, turlar arasında değiştirilebilir
    this.players = new Map();
    this.ch = [];
    this.nextId = 1;
    this.nextPid = 1;
    this.tick = 0;
    this.hist = [];
    this.phase = 'play';
    this.timer = this.round;
    this.spawnT = 0;
    this.foxT = rnd(10, 18);
    this.spT = this.newSpT();
    this.ducks = this.newDucks();
    this.iv = setInterval(() => this.step(), TICK);
  }

  newSpT() { return { cow: rnd(6, 12), dog: rnd(14, 22), crow: rnd(4, 8) }; }   // ilk inek, köpek, karga gelişleri (sn)

  newDucks() { return Array.from({ length: WHEEL.n }, (_, i) => ({ st: i % 2, t: rnd(0.5, 4) })); }

  send(p, m) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }
  broadcast(m) { const s = JSON.stringify(m); for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s); }
  board() { return [...this.players.values()].map(p => ({ id: p.id, n: p.name, c: p.color, s: p.score, k: p.kills, sh: p.shots })).sort((a, b) => b.s - a.s); }

  addPlayer(ws, name, weapon) {
    const used = new Set([...this.players.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[0];
    const wp = WEAPONS[weapon] ? weapon : 'rifle';
    const p = { id: this.nextPid++, ws, name, color, score: 0, kills: 0, shots: 0, weapon: wp, ammo: WEAPONS[wp].mag, reloadUntil: 0, lastShot: 0, lastSwitch: 0, aim: { x: W / 2, y: H / 2 } };
    this.players.set(p.id, p);
    this.send(p, { t: 'welcome', id: p.id, color, room: this.id, ph: this.phase, tm: Math.ceil(this.timer), ammo: p.ammo, mag: WEAPONS[wp].mag, round: this.round });
    this.broadcast({ t: 'b', b: this.board(), msg: `${name} odaya katıldı` });
    return p;
  }

  removePlayer(p) {
    this.players.delete(p.id);
    if (this.players.size === 0) { clearInterval(this.iv); rooms.delete(this.id); return; }
    this.broadcast({ t: 'b', b: this.board(), msg: `${p.name} ayrıldı` });
  }

  // ----- Tavuk davranışları -----
  spawn() {
    const sp = SPAWNS[Math.random() * SPAWNS.length | 0];
    const r = Math.random();
    const hasRabbit = this.ch.some(o => o.type === 'rabbit' && o.state !== 'dead');   // aynı anda en fazla bir tavşan
    const type = r < 0.03 && !hasRabbit ? 'rabbit' : r < 0.09 ? 'golden' : r < 0.28 ? 'black' : 'normal';
    const c = { id: this.nextId++, x: sp.x, y: sp.y, z: 0, type, state: 'run', t: 0, dir: 1, tx: 0, ty: 0, cover: -1, fly: null, spd: rnd(70, 105) * TYPES[type].spd };
    this.target(c, rnd(100, W - 100), rnd(GY0 + 20, GY1 - 10));
    this.ch.push(c);
  }
  target(c, x, y) { c.tx = x; c.ty = y; c.dir = x >= c.x ? 1 : -1; }
  walkRand(c) { c.state = 'walk'; this.target(c, rnd(60, W - 60), rnd(GY0 + 10, GY1 - 10)); }
  exit(c) { c.state = 'exit'; this.target(c, c.x < W / 2 ? -80 : W + 80, c.y); }

  goHide(c, nearest) {
    const free = COVERS.map((_, i) => i).filter(i => !this.ch.some(o => o !== c && o.cover === i && o.state !== 'dead'));
    if (!free.length) return false;
    let i;
    if (nearest) {
      const d = k => Math.hypot(COVERS[k].x - c.x, COVERS[k].y - c.y);
      free.sort((a, b) => d(a) - d(b)); i = free[0];
    } else i = free[Math.random() * free.length | 0];
    c.cover = i; c.state = 'tohide';
    this.target(c, COVERS[i].x, COVERS[i].y - 8);
    return true;
  }

  leaveCover(c) {
    const cv = COVERS[c.cover]; c.cover = -1;
    c.x = cv.x + (Math.random() < 0.5 ? -1 : 1) * (cv.w / 2 + 10); c.y = cv.y + 6;
    const r = Math.random();
    if (r < 0.3) this.startFly(c, false); else if (r < 0.45) this.exit(c); else this.walkRand(c);
  }

  startFly(c, exit) {
    if (c.type === 'rabbit') {   // tavşan uçmaz, kaçar
      c.cover = -1; c.state = exit ? 'exit' : 'run';
      if (exit) this.target(c, c.x < W / 2 ? -80 : W + 80, c.y);
      else this.target(c, rnd(80, W - 80), rnd(GY0 + 10, GY1 - 10));
      return;
    }
    const h = rnd(110, 260) * (c.type === 'black' ? 1.3 : 1);
    let x1 = rnd(80, W - 80); const y1 = rnd(GY0 + 10, GY1 - 10);
    if (exit) x1 = c.x < W / 2 ? W + 90 : -90;
    c.state = 'fly'; c.cover = -1;
    c.fly = { x0: c.x, y0: c.y, x1, y1, h, p: 0, dur: rnd(1.4, 2.6) * (exit ? 1.5 : 1), exit };
    c.dir = x1 >= c.x ? 1 : -1;
  }

  decide(c) {
    if (c.type === 'cow') {   // otlar, yavaş dolaşır, bir süre sonra çıkar
      if (c.age > 40) return this.exit(c);
      if (Math.random() < 0.6) this.walkRand(c); else { c.state = 'idle'; c.t = rnd(2.5, 5); }
      return;
    }
    if (c.type === 'dog') {   // koşturur, durur, koklar; tilki görürse kovalar (updDog)
      if (c.age > 30) return this.exit(c);
      const q = Math.random();
      if (q < 0.35) this.walkRand(c); else if (q < 0.8) { c.state = 'run'; this.target(c, rnd(80, W - 80), rnd(GY0 + 20, GY1 - 10)); } else { c.state = 'idle'; c.t = rnd(0.8, 2); }
      return;
    }
    if (c.type === 'crow') return this.startFly(c, true);   // yere konan karga yemini gagalayıp uçar gider
    const r = Math.random();
    const flyP = c.type === 'black' ? 0.3 : 0.17;
    if (r < 0.42) this.walkRand(c);
    else if (r < 0.68) { if (!this.goHide(c, false)) this.walkRand(c); }
    else if (r < 0.68 + flyP) this.startFly(c, false);
    else this.exit(c);
  }

  arrive(c) {
    if (c.state === 'exit') { c.gone = true; return; }
    if (c.state === 'tohide') { const cv = COVERS[c.cover]; c.state = 'hide'; c.x = cv.x; c.y = cv.y - 8; c.t = rnd(2, 5); return; }
    c.state = 'idle'; c.t = rnd(0.4, 2);
  }

  updC(c, dt) {
    if (c.fearT > 0) c.fearT -= dt;
    if (c.type === 'fox') return this.updFox(c, dt);
    if (c.age !== undefined) c.age += dt;
    if (c.type === 'dog' && this.updDog(c, dt)) return;
    c.t -= dt;
    const sp = c.spd * (0.55 + 0.45 * scale(c.y));
    switch (c.state) {
      case 'walk': case 'run': case 'exit': case 'tohide': {
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
        const v = sp * (c.state === 'walk' ? 1 : 1.8);
        if (d < v * dt + 1) { c.x = c.tx; c.y = c.ty; this.arrive(c); }
        else { c.x += dx / d * v * dt; c.y += dy / d * v * dt; if (Math.abs(dx) > 2) c.dir = dx >= 0 ? 1 : -1; }
        break;
      }
      case 'idle': if (c.t <= 0) this.decide(c); break;
      case 'hide':
        if (c.t <= 0) {
          if (Math.random() < 0.55) {
            const cv = COVERS[c.cover]; c.state = 'peek'; const side = Math.random() < 0.5 ? -1 : 1;
            c.x = cv.x + side * (cv.w / 2 + 8); c.y = cv.y + 4; c.dir = side; c.t = rnd(1, 2.2);
          } else this.leaveCover(c);
        }
        break;
      case 'peek':
        if (c.t <= 0) {
          if (Math.random() < 0.5) { const cv = COVERS[c.cover]; c.state = 'hide'; c.x = cv.x; c.y = cv.y - 8; c.t = rnd(1.5, 3.5); }
          else this.leaveCover(c);
        }
        break;
      case 'fly': {
        const f = c.fly; f.p += dt / f.dur; const p = Math.min(1, f.p);
        c.x = f.x0 + (f.x1 - f.x0) * p; c.y = f.y0 + (f.y1 - f.y0) * p; c.z = Math.sin(Math.PI * p) * f.h;
        if (c.type === 'crow') c.z = Math.max(0, c.z + Math.sin(p * 18 + c.id) * 14);   // karga dalgalı uçar: nişan almak zorlaşır
        if (p >= 1) { c.z = 0; if (f.exit) c.gone = true; else { c.state = 'idle'; c.t = c.type === 'crow' ? rnd(1.5, 3) : rnd(0.3, 1); } }
        break;
      }
      case 'dead': c.z = Math.max(0, c.z - 600 * dt); if (c.t <= 0) c.gone = true; break;
    }
  }

  // Atış sesi yakındaki tavukları, tilkiyi ve ördekleri ürkütür. byFox: ürküten tilkidir (tilki ve ördeklere etkisi yok)
  scare(x, y, rad, byFox) {
    for (const c of this.ch) {
      if (c.state === 'dead' || c.state === 'hide' || c.state === 'fly' || c.state === 'tohide') continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (c.type === 'cow' || c.type === 'dog') continue;   // inek ve köpek ateşten ürkmez
      if (c.type === 'crow') { if (!byFox && d < rad) this.startFly(c, true); continue; }   // yere konan karga havalanır
      if (c.type === 'fox') {   // tilki ateş edilen yerden uzaklaşır, sığınır ve bir süre temkinli kalır
        if (!byFox && d < rad + (c.state === 'peek' ? 20 : 0) && c.state !== 'pounce' && c.state !== 'carry') {
          c.wary = 4;
          if (c.state === 'peek') { const cv = COVERS[c.cover]; c.state = 'hide'; c.x = cv.x; c.y = cv.y - 8; c.t = rnd(1.5, 3); }
          else if (!this.foxHide(c)) { const dd = d || 1; c.state = 'run'; this.target(c, clamp(c.x + (c.x - x) / dd * 320, 40, W - 40), clamp(c.y + (c.y - y) / dd * 160, GY0 + 10, GY1 - 10)); }
        }
        continue;
      }
      if (byFox) { if (c.fearT > 0) continue; c.fearT = 2.5; }   // tilkinin korkuttuğu tavuk 2.5 sn içinde yeniden zar atmaz
      if (c.state === 'peek') {
        if (d < rad + 20) { const cv = COVERS[c.cover]; c.state = 'hide'; c.x = cv.x; c.y = cv.y - 8; c.t = rnd(1.5, 3); }
        continue;
      }
      if (d > rad) continue;
      const r = Math.random();
      if (r < 0.3) this.startFly(c, Math.random() < 0.3);
      else if (r < 0.75 && this.goHide(c, true)) { /* saklanmaya koşuyor */ }
      else {
        const dd = d || 1;
        c.state = 'run';
        this.target(c, clamp(c.x + (c.x - x) / dd * 320, 40, W - 40), clamp(c.y + (c.y - y) / dd * 160, GY0 + 10, GY1 - 10));
      }
    }
    if (!byFox) for (let i = 0; i < this.ducks.length; i++) {   // ördekler kabine eğilir
      const dk = this.ducks[i];
      if (dk.st !== 0) continue;
      const [dx, dy] = duckPos(i, this.tick);
      if (Math.hypot(dx - x, dy - y) < rad && Math.random() < 0.7) { dk.st = 1; dk.t = rnd(1.6, 3.2); }
    }
  }

  // ----- Tilki: kurnaz avcı -----
  // Stratejileri: siperden siper atlayarak sinsice yaklaşır; nişangah yakındaysa donup taş gibi durur ve küçülür;
  // yalnızca kimse izlemiyorken (ya da avcılar mermi doldururken) atılır; saklanan tavuğun siperinde pusuya yatar;
  // yalnız kalmış ve değerli avı seçer; ateş edilince siper arar ve temkinli bekler; kaçarken zikzak çizer;
  // 3 denemede yakalayamazsa çekilir. Tavuğu kaparsa kaçar: vurulursa tavuk kurtulur (+bonus).
  watched(x, y, rad) {
    const now = Date.now();
    for (const p of this.players.values()) if (p.ammo > 0 && now >= p.reloadUntil && Math.hypot(p.aim.x - x, p.aim.y - y) < rad) return true;
    return false;
  }
  freeCovers(f) { return COVERS.map((_, i) => i).filter(i => !this.ch.some(o => o !== f && o.cover === i && o.state !== 'dead')); }

  spawnFox() {
    const left = Math.random() < 0.5, y = rnd(GY0 + 60, GY1 - 80);
    const f = { id: this.nextId++, x: left ? -60 : W + 60, y, z: 0, type: 'fox', state: 'stalk', t: 0, dir: left ? 1 : -1, tx: 0, ty: 0, cover: -1, fly: null, spd: 100, age: 0, think: 2.5, sc: 0, wary: 0, fails: 0, fz: 0, prey: null, cr: null, crType: null };
    this.target(f, left ? 140 : W - 140, y);
    this.ch.push(f);
    this.broadcast({ t: 'ev', k: 'fox', msg: '🦊 Tilki çiftliğe sızdı! Tavuklara dikkat!' });
  }

  foxPrey(f) {
    let best = null, bs = 1e9;
    for (const o of this.ch) {
      if (!PREY.has(o.type) || o.gone || o.state === 'dead' || o.state === 'fly' || o.state === 'exit') continue;
      let s = Math.hypot(o.x - f.x, o.y - f.y) + Math.random() * 60;
      if (o.state === 'hide') s += 150;                                                        // saklananı pusuda bekler
      for (const q of this.ch) if (q !== o && PREY.has(q.type) && Math.hypot(q.x - o.x, q.y - o.y) < 130) s += 35;   // kalabalıktan kaçınır
      if (this.watched(o.x, o.y, 170)) s += 120;
      s -= o.type === 'golden' ? 140 : o.type === 'rabbit' ? 60 : o.type === 'black' ? 30 : 0;
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  }

  foxLeave(f) {
    if (f.cover < 0) return;
    const cv = COVERS[f.cover]; f.cover = -1;
    if (f.state === 'hide') { f.x = cv.x + (Math.random() < 0.5 ? -1 : 1) * (cv.w / 2 + 10); f.y = cv.y + 6; }   // siperin arkasından çıkar
  }
  foxGoCover(f, i, state) { this.foxLeave(f); f.cover = i; f.state = state; this.target(f, COVERS[i].x, COVERS[i].y - 8); }
  foxHide(f) {   // en yakın boş sipere koşar
    const free = this.freeCovers(f), d = k => Math.hypot(COVERS[k].x - f.x, COVERS[k].y - f.y);
    if (!free.length) return false;
    free.sort((a, b) => d(a) - d(b)); this.foxGoCover(f, free[0], 'tohide');
    return true;
  }
  foxHold(f, t) {   // olduğu yerde bekler: siperde saklanır, açıkta donar
    if (f.cover >= 0) { const cv = COVERS[f.cover]; f.state = 'hide'; f.x = cv.x; f.y = cv.y - 8; } else { f.state = 'freeze'; f.fz++; }
    f.t = t;
  }
  foxExit(f) { this.foxLeave(f); f.state = 'exit'; this.target(f, f.x < W / 2 ? -90 : W + 90, f.y); }
  foxFlee(f) {
    if (this.foxHide(f)) return;
    f.state = 'run'; this.target(f, rnd(100, W - 100), rnd(GY0 + 30, GY1 - 30));
  }

  foxPlan(f) {
    if (f.age > 55 || f.fails >= 3) return this.foxExit(f);
    const prey = this.foxPrey(f);
    if (!prey) {
      if (f.cover >= 0) this.foxHold(f, rnd(1, 2));
      else { f.state = 'stalk'; this.target(f, rnd(100, W - 100), rnd(GY0 + 30, GY1 - 30)); }
      return;
    }
    f.prey = prey.id;
    const d = Math.hypot(prey.x - f.x, prey.y - f.y);
    if (f.wary > 0 || this.watched(f.x, f.y, 240)) {   // izleniyor: ikinci kez donmaz, siper arar
      if (f.cover < 0 && f.fz >= 2 && this.foxHide(f)) return;
      return this.foxHold(f, rnd(0.9, 1.8));
    }
    if (prey.state === 'hide' && d < 320) return this.foxHold(f, rnd(0.7, 1.4));   // pusu: tavuk kafasını çıkarınca atılır
    if (d < 290 && prey.state !== 'hide') { this.foxLeave(f); f.fz = 0; f.state = 'pounce'; f.t = 1.8; return; }
    // sinsice yaklaşma: avına yakın bir sipere atlar, yoksa düz sürünür
    const hops = this.freeCovers(f).map(i => ({ i, cd: Math.hypot(COVERS[i].x - prey.x, COVERS[i].y - prey.y) })).filter(o => o.cd > 70 && o.cd < d - 60).sort((a, b) => a.cd - b.cd);
    if (hops.length && d > 320) return this.foxGoCover(f, hops[0].i, 'stalk');
    this.foxLeave(f);
    const k = Math.max(0, d - 230) / (d || 1);
    f.state = 'stalk'; this.target(f, f.x + (prey.x - f.x) * k, f.y + (prey.y - f.y) * k);
  }

  foxCatch(f, p) {
    p.gone = true; f.cr = TY[p.type]; f.crType = p.type; f.state = 'carry';
    this.target(f, f.x < W / 2 ? -90 : W + 90, clamp(f.y, GY0 + 10, GY1 - 10));
    this.broadcast({ t: 'ev', k: 'steal', msg: `🦊 Tilki ${p.type === 'rabbit' ? 'tavşanı' : 'bir tavuğu'} kaptı! Vur, kurtar!` });
  }
  foxRelease(f) {   // vurulan tilkinin taşıdığı av kurtulur
    const type = f.crType;
    const c = { id: this.nextId++, x: f.x, y: f.y, z: 0, type, state: 'run', t: 0, dir: 1, tx: 0, ty: 0, cover: -1, fly: null, spd: rnd(70, 105) * TYPES[type].spd, fearT: 3 };
    this.target(c, rnd(100, W - 100), rnd(GY0 + 20, GY1 - 10));
    this.ch.push(c); f.cr = null;
  }

  foxArrive(f) {
    if (f.state === 'exit' || f.state === 'carry') { f.gone = true; return; }
    if ((f.state === 'tohide' || f.state === 'stalk') && f.cover >= 0) { const cv = COVERS[f.cover]; f.state = 'hide'; f.x = cv.x; f.y = cv.y - 8; f.t = rnd(1, 2.4); return; }
    f.state = 'freeze'; f.t = rnd(0.3, 0.9);
  }

  updFox(f, dt) {
    f.age += dt; f.t -= dt; f.think -= dt; f.sc -= dt; f.wary = Math.max(0, f.wary - dt);
    const k = 0.55 + 0.45 * scale(f.y), base = 105 * k;
    if ((f.state === 'stalk' || f.state === 'pounce') && f.cover < 0 && f.sc <= 0) { f.sc = 0.5; this.scare(f.x, f.y, f.state === 'pounce' ? 210 : 110, true); }
    switch (f.state) {
      case 'dead': f.z = Math.max(0, f.z - 600 * dt); if (f.t <= 0) f.gone = true; break;
      case 'freeze': if (f.t <= 0) this.foxPlan(f); break;
      case 'hide':
        if (f.t <= 0) {
          if (Math.random() < 0.45) { const cv = COVERS[f.cover], side = Math.random() < 0.5 ? -1 : 1; f.state = 'peek'; f.x = cv.x + side * (cv.w / 2 + 8); f.y = cv.y + 4; f.dir = side; f.t = rnd(0.7, 1.4); }
          else this.foxPlan(f);
        }
        break;
      case 'peek': if (f.t <= 0) this.foxPlan(f); break;
      case 'pounce': {
        const p = this.ch.find(o => o.id === f.prey);
        if (!p || p.gone || p.state === 'dead' || p.state === 'hide' || p.state === 'fly' || f.t <= 0) { f.fails++; f.wary = 3; this.foxFlee(f); break; }
        const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy) || 1;
        if (d < 30 * k + 12) { this.foxCatch(f, p); break; }
        const v = Math.min(base * 3.4 * dt, d);
        f.x += dx / d * v; f.y += dy / d * v; f.dir = dx >= 0 ? 1 : -1;
        break;
      }
      default: {   // stalk, run, tohide, exit, carry
        if (f.state === 'stalk' && f.cover < 0) {
          if (this.watched(f.x, f.y, 150)) { f.fz++; f.state = 'freeze'; f.t = rnd(0.9, 1.7); break; }   // nişangah yakında: donar
          if (f.think <= 0) { f.think = 1; this.foxPlan(f); if (f.state !== 'stalk') break; }
        }
        const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
        const v = base * (f.state === 'stalk' ? 0.7 : f.state === 'carry' ? 2.3 : f.state === 'exit' ? 1.6 : 2.4);
        if (d < v * dt + 1) { f.x = f.tx; f.y = f.ty; this.foxArrive(f); break; }
        let ux = dx / d, uy = dy / d;
        if ((f.state === 'carry' || f.state === 'run' || f.state === 'tohide') && d > 70) {   // zikzak: nişan almayı zorlaştırır
          const a = Math.sin(f.age * 8) * 0.6, cs = Math.cos(a), sn = Math.sin(a);
          [ux, uy] = [ux * cs - uy * sn, ux * sn + uy * cs];
        }
        f.x += ux * v * dt; f.y = clamp(f.y + uy * v * dt, GY0 + 5, GY1 - 5);
        if (Math.abs(ux) > 0.1) f.dir = ux >= 0 ? 1 : -1;
      }
    }
  }

  // ----- İnek, köpek, karga -----
  spawnAnimal(type) {
    if (type === 'crow') return this.spawnCrow();
    const sp = SPAWNS[2 + (Math.random() * (SPAWNS.length - 2) | 0)];   // yan kenar girişleri
    const c = { id: this.nextId++, x: sp.x, y: sp.y, z: 0, type, state: 'walk', t: 0, dir: sp.x < W / 2 ? 1 : -1, tx: 0, ty: 0, cover: -1, fly: null, spd: rnd(70, 105) * TYPES[type].spd, age: 0 };
    this.target(c, rnd(300, W - 300), rnd(GY0 + 60, GY1 - 40));
    this.ch.push(c);
    const cow = type === 'cow';
    this.broadcast({ t: 'ev', k: type, col: cow ? '#f2c230' : '#6dd36f', msg: cow ? '🐄 Sarı-lacivert inek otlağa geldi! Vurma: -5 puan' : '🐕 Yeşil köpek geldi! Vurma: -8 puan' });
  }
  // karga bir kenardan girer, dalgalı uçarak karşı kenara geçer; bazen yere konup yem gagalar
  spawnCrow() {
    const left = Math.random() < 0.5, y0 = rnd(GY0 + 20, GY1 - 40), land = Math.random() < 0.25;
    const x0 = left ? -80 : W + 80;
    const c = { id: this.nextId++, x: x0, y: y0, z: 0, type: 'crow', state: 'fly', t: 0, dir: left ? 1 : -1, tx: 0, ty: 0, cover: -1, spd: 100 };
    const x1 = land ? rnd(200, W - 200) : left ? W + 90 : -90, y1 = land ? rnd(GY0 + 60, GY1 - 60) : rnd(GY0 + 10, GY1 - 10);
    c.fly = { x0, y0, x1, y1, h: rnd(130, 240), p: 0, dur: land ? rnd(2.5, 3.5) : rnd(4.5, 7), exit: !land };
    c.dir = x1 >= x0 ? 1 : -1;
    this.ch.push(c);
  }
  // köpek tilki görürse kovalar; yakalayınca tilki kaçar. true: bu tick kovalıyor
  updDog(d, dt) {
    const fox = this.ch.find(o => o.type === 'fox' && o.state !== 'dead' && o.state !== 'hide' && o.state !== 'carry' && o.state !== 'exit');
    if (!fox) return false;
    const dx = fox.x - d.x, dy = fox.y - d.y, dist = Math.hypot(dx, dy);
    if (dist > 650) return false;
    if (dist < 110) {
      fox.wary = 5; fox.fails++;
      this.foxExit(fox);
      this.broadcast({ t: 'ev', k: 'dog', col: '#6dd36f', msg: '🐕 Köpek tilkiyi kovaladı!' });
      return false;
    }
    const v = d.spd * (0.55 + 0.45 * scale(d.y)) * 2;
    d.state = 'run'; d.x += dx / dist * v * dt; d.y = clamp(d.y + dy / dist * v * dt, GY0 + 5, GY1 - 5); d.dir = dx >= 0 ? 1 : -1;
    d.tx = d.x; d.ty = d.y;
    return true;
  }

  // ----- Ördekler (dönme dolap kabinlerinde) -----
  updDucks(dt) {
    for (const d of this.ducks) {
      d.t -= dt;
      if (d.t > 0) continue;
      if (d.st === 0) { d.st = 1; d.t = rnd(1.4, 2.8); }          // kabine eğilir
      else if (d.st === 1) { d.st = 0; d.t = rnd(2.6, 5); }       // başını çıkarır
      else if (d.st === 2) { d.st = 3; d.t = rnd(7, 12); }        // düştü; kabin bir süre boş
      else { d.st = 1; d.t = rnd(0.6, 1.4); }                     // yeni ördek kabine biner
    }
  }

  // ----- Atış -----
  shoot(p, m) {
    const now = Date.now(), wp = WEAPONS[p.weapon];
    if (this.phase !== 'play' || now < p.reloadUntil || now - p.lastShot < wp.gap - 40) return;
    if (p.ammo <= 0) { this.reload(p); return; }
    const x = +m.x, y = +m.y;
    if (!isFinite(x) || !isFinite(y)) return;
    p.ammo--; p.lastShot = now; p.shots++;

    // gecikme telafisi: oyuncunun ekranda gördüğü tick'e göre kontrol
    const tick = clamp(m.k | 0, this.tick - 20, this.tick);
    let best = null, bd = 1e9, bestDuck = -1, dd = 1e9;
    for (const h of this.hist) {
      if (Math.abs(h.tick - tick) > 1) continue;
      for (const [id, s] of h.ch) {
        if (!s.hit) continue;
        const T = TYPES[s.ty] || TYPES.normal, sc = scale(s.y), cx = s.x, cy = s.y - s.z - T.cy * sc;
        const d = Math.hypot(x - cx, y - cy);
        if (d < Math.max(22, T.r * wp.rm * sc) * s.hr && d < bd) {   // uzaktaki küçük hayvanlar için en az 22 px isabet alanı; donan tilki küçülür
          const c = this.ch.find(o => o.id === id);
          if (c && c.state !== 'dead' && c.state !== 'hide') { best = c; bd = d; }
        }
      }
      h.d.forEach((vis, i) => {   // ördekler: küçük ve hareketli hedef
        if (!vis || this.ducks[i].st > 1) return;
        const [cx, cy] = duckPos(i, h.tick), d = Math.hypot(x - cx, y - cy);
        if (d < Math.max(12, DUCK.r * wp.rm) && d < dd) { bestDuck = i; dd = d; }
      });
    }
    let hit = null, pts = 0, ty = null, rs = 0;
    if (bestDuck >= 0 && dd < bd) {
      const dk = this.ducks[bestDuck];
      dk.st = 2; dk.t = 1.2;
      pts = DUCK.pts; p.score += pts; p.kills++; hit = 1000 + bestDuck; ty = 'duck';
    } else if (best) {
      pts = TYPES[best.type].pts + (best.z > 40 && CHICK.has(best.type) ? 1 : 0);
      if (best.type === 'fox' && best.cr != null) { pts += FOX_RESCUE; rs = 1; this.foxRelease(best); }   // tavuklu tilkiyi vurmak av da kurtarır
      if (pts < 0) p.score = Math.max(0, p.score + pts);   // inek ve köpek: ceza, puan sıfırın altına inmez
      else { p.score += pts; p.kills++; }
      best.state = 'dead'; best.t = 1.2; best.cover = -1;
      hit = best.id; ty = best.type;
    }
    this.broadcast({ t: 'fx', pid: p.id, x: Math.round(x), y: Math.round(y), hit, pts, ty, rs, w: p.weapon });
    this.send(p, { t: 'ammo', a: p.ammo });
    if (hit) this.broadcast({ t: 'b', b: this.board() });
    this.scare(x, y, wp.scare);
    if (p.ammo === 0) this.reload(p);
  }

  reload(p) {
    const now = Date.now(), wp = WEAPONS[p.weapon];
    if (p.ammo === wp.mag || now < p.reloadUntil) return;
    p.reloadUntil = now + wp.reload; p.ammo = wp.mag;
    this.send(p, { t: 'ammo', a: wp.mag, r: wp.reload });
  }

  // sonraki turun süresi: yalnızca turlar arasında değişir
  setRound(s) {
    if (this.phase !== 'break' || !ROUNDS.includes(s) || s === this.round) return;
    this.round = s;
    this.broadcast({ t: 'round', s });
  }

  setWeapon(p, w) {
    const now = Date.now();
    if (!WEAPONS[w] || w === p.weapon || now - p.lastSwitch < 800) return;
    p.weapon = w; p.lastSwitch = now;
    p.ammo = WEAPONS[w].mag; p.reloadUntil = now + 500;
    this.send(p, { t: 'ammo', a: p.ammo, mag: p.ammo, r: 500 });
  }

  // ----- Ana döngü -----
  step() {
    const dt = TICK / 1000;
    this.tick++;
    if (this.phase === 'play') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'break'; this.timer = BREAK;
        const nr = [];   // bu turda rekor kıran/rekor listesine giren oyuncular
        for (const p of this.players.values()) if (submitScore(this.round, p.name, p.score)) nr.push(p.name);
        this.broadcast({ t: 'end', b: this.board(), tm: BREAK, d: this.round, rec: scores[this.round] || [], nr });
      }
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.ch.filter(c => c.state !== 'dead').length < MAXCH) { this.spawn(); this.spawnT = rnd(0.5, 1.4); }
      this.foxT -= dt;
      if (this.foxT <= 0) {   // aynı anda en fazla bir tilki
        if (!this.ch.some(o => o.type === 'fox') && this.timer > 15 && this.ch.length > 3) this.spawnFox();
        this.foxT = rnd(25, 40);
      }
      for (const k of ['cow', 'dog', 'crow']) {   // inek, köpek en fazla 1, karga en fazla 2
        this.spT[k] -= dt;
        if (this.spT[k] > 0) continue;
        if (this.timer > 8 && this.ch.filter(o => o.type === k && o.state !== 'dead').length < MAX_OF[k]) this.spawnAnimal(k);
        this.spT[k] = SPAWN_GAP[k]();
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'play'; this.timer = this.round; this.ch = []; this.foxT = rnd(10, 18); this.spT = this.newSpT(); this.ducks = this.newDucks();
        for (const p of this.players.values()) { p.score = 0; p.kills = 0; p.shots = 0; p.ammo = WEAPONS[p.weapon].mag; p.reloadUntil = 0; this.send(p, { t: 'ammo', a: p.ammo, mag: p.ammo }); }
        this.broadcast({ t: 'start', b: this.board() });
      }
    }
    for (const c of this.ch) this.updC(c, dt);
    this.ch = this.ch.filter(c => !c.gone);
    this.updDucks(dt);

    this.hist.push({ tick: this.tick, ch: new Map(this.ch.map(c => [c.id, { x: c.x, y: c.y, z: c.z, ty: c.type, hit: c.state !== 'hide' && c.state !== 'dead', hr: c.state === 'freeze' ? 0.6 : c.state === 'stalk' ? 0.8 : 1 }])), d: this.ducks.map(d => d.st === 0) });
    if (this.hist.length > 30) this.hist.shift();

    const msg = { t: 's', k: this.tick, tm: Math.ceil(this.timer), ph: this.phase,
      c: this.ch.map(c => { const a = [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.z), ST[c.state], TY[c.type], c.dir]; if (c.type === 'fox') a.push(c.cr == null ? -1 : c.cr); return a; }),
      d: this.ducks.map(d => d.st) };
    if (this.tick % 2 === 0) msg.p = [...this.players.values()].map(p => [p.id, Math.round(p.aim.x), Math.round(p.aim.y)]);
    if (this.tick % 20 === 0) msg.b = this.board();
    this.broadcast(msg);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const roomId = (q.get('room') || DEFAULT_ROOM).toLowerCase().replace(/[^a-z0-9ğüşıöç_-]/g, '').slice(0, 20) || DEFAULT_ROOM;
  let room = null, p = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!p) {
      if (m.t !== 'join') return;
      room = rooms.get(roomId);
      if (!room) { room = new Room(roomId, +m.r); rooms.set(roomId, room); }
      if (room.players.size >= MAXP) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
      const name = String(m.name || 'Avcı').replace(/[<>&"]/g, '').trim().slice(0, 14) || 'Avcı';
      p = room.addPlayer(ws, name, m.w);
      // oyuncunun tarayıcısında saklı kişisel rekorları: sunucu sıfırlanmışsa liste yeniden kurulur
      if (m.pb && typeof m.pb === 'object') for (const d of ROUNDS) submitScore(d, name, m.pb[d]);
      return;
    }
    if (m.t === 'aim') { p.aim.x = clamp(+m.x || 0, 0, W); p.aim.y = clamp(+m.y || 0, 0, H); }
    else if (m.t === 'shot') room.shoot(p, m);
    else if (m.t === 'reload') room.reload(p);
    else if (m.t === 'weapon') room.setWeapon(p, m.w);
    else if (m.t === 'round') room.setRound(+m.s);
  });
  ws.on('close', () => { if (room && p) room.removePlayer(p); });
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 30000);

server.listen(PORT, () => {
  console.log(`🌾 Avcı Toynaklar sunucusu çalışıyor: http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list || [])
    if (n.family === 'IPv4' && !n.internal) console.log(`   Aynı ağdaki telefonlar için: http://${n.address}:${PORT}`);
});
