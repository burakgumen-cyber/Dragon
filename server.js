// Avcı Toynaklar - oyun sunucusu
// Çalıştırma: npm install && npm start  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

// ---------- Dünya sabitleri (istemciyle aynı) ----------
const W = 1600, H = 900, GY0 = 490, GY1 = 850;
const TICK = 50;            // ms (20 Hz)
const ROUND = 120;          // tur süresi (sn)
const BREAK = 10;           // turlar arası (sn)
const MAXCH = 14;           // aynı anda en fazla tavuk
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
];
const SPAWNS = [
  { x: 330, y: 495 }, { x: 1270, y: 495 },              // ahır ve kümes kapısı
  { x: -50, y: 620 }, { x: 1650, y: 700 }, { x: -50, y: 800 }, { x: 1650, y: 540 },
];
// r: isabet yarıçapı, cy: hedef merkezinin yerden yüksekliği
const TYPES = {
  normal: { pts: 1, spd: 1, r: 32, cy: 28 },
  black: { pts: 2, spd: 1.25, r: 32, cy: 28 },
  golden: { pts: 5, spd: 1.9, r: 32, cy: 28 },
  rabbit: { pts: 10, spd: 1.5, r: 28, cy: 18 },
};
const ST = { walk: 0, run: 1, idle: 2, fly: 3, hide: 4, peek: 5, dead: 6, exit: 7, tohide: 8 };
const TY = { normal: 0, black: 1, golden: 2, rabbit: 3 };
const COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#4895ef', '#9b5de5', '#00bbf9', '#f15bb5', '#80b918'];

const scale = y => 0.55 + (y - GY0) / (GY1 - GY0) * 0.65;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Statik dosyalar ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
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
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.ch = [];
    this.nextId = 1;
    this.nextPid = 1;
    this.tick = 0;
    this.hist = [];
    this.phase = 'play';
    this.timer = ROUND;
    this.spawnT = 0;
    this.iv = setInterval(() => this.step(), TICK);
  }

  send(p, m) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }
  broadcast(m) { const s = JSON.stringify(m); for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s); }
  board() { return [...this.players.values()].map(p => ({ id: p.id, n: p.name, c: p.color, s: p.score, k: p.kills, sh: p.shots })).sort((a, b) => b.s - a.s); }

  addPlayer(ws, name, weapon) {
    const used = new Set([...this.players.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[0];
    const wp = WEAPONS[weapon] ? weapon : 'rifle';
    const p = { id: this.nextPid++, ws, name, color, score: 0, kills: 0, shots: 0, weapon: wp, ammo: WEAPONS[wp].mag, reloadUntil: 0, lastShot: 0, lastSwitch: 0, aim: { x: W / 2, y: H / 2 } };
    this.players.set(p.id, p);
    this.send(p, { t: 'welcome', id: p.id, color, room: this.id, ph: this.phase, tm: Math.ceil(this.timer), ammo: p.ammo, mag: WEAPONS[wp].mag });
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
        if (p >= 1) { c.z = 0; if (f.exit) c.gone = true; else { c.state = 'idle'; c.t = rnd(0.3, 1); } }
        break;
      }
      case 'dead': c.z = Math.max(0, c.z - 600 * dt); if (c.t <= 0) c.gone = true; break;
    }
  }

  // Atış sesi yakındaki tavukları ürkütür
  scare(x, y, rad) {
    for (const c of this.ch) {
      if (c.state === 'dead' || c.state === 'hide' || c.state === 'fly' || c.state === 'tohide') continue;
      const d = Math.hypot(c.x - x, c.y - y);
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
    let best = null, bd = 1e9;
    for (const h of this.hist) {
      if (Math.abs(h.tick - tick) > 1) continue;
      for (const [id, s] of h.ch) {
        if (!s.hit) continue;
        const T = TYPES[s.ty] || TYPES.normal, sc = scale(s.y), cx = s.x, cy = s.y - s.z - T.cy * sc;
        const d = Math.hypot(x - cx, y - cy);
        if (d < T.r * wp.rm * sc && d < bd) {
          const c = this.ch.find(o => o.id === id);
          if (c && c.state !== 'dead' && c.state !== 'hide') { best = c; bd = d; }
        }
      }
    }
    let hit = null, pts = 0;
    if (best) {
      pts = TYPES[best.type].pts + (best.z > 40 ? 1 : 0);
      p.score += pts; p.kills++;
      best.state = 'dead'; best.t = 1.2; best.cover = -1;
      hit = best.id;
    }
    this.broadcast({ t: 'fx', pid: p.id, x: Math.round(x), y: Math.round(y), hit, pts, ty: best ? best.type : null, w: p.weapon });
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
        this.broadcast({ t: 'end', b: this.board(), tm: BREAK });
      }
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.ch.filter(c => c.state !== 'dead').length < MAXCH) { this.spawn(); this.spawnT = rnd(0.5, 1.4); }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'play'; this.timer = ROUND; this.ch = [];
        for (const p of this.players.values()) { p.score = 0; p.kills = 0; p.shots = 0; p.ammo = WEAPONS[p.weapon].mag; p.reloadUntil = 0; this.send(p, { t: 'ammo', a: p.ammo, mag: p.ammo }); }
        this.broadcast({ t: 'start', b: this.board() });
      }
    }
    for (const c of this.ch) this.updC(c, dt);
    this.ch = this.ch.filter(c => !c.gone);

    this.hist.push({ tick: this.tick, ch: new Map(this.ch.map(c => [c.id, { x: c.x, y: c.y, z: c.z, ty: c.type, hit: c.state !== 'hide' && c.state !== 'dead' }])) });
    if (this.hist.length > 30) this.hist.shift();

    const msg = { t: 's', k: this.tick, tm: Math.ceil(this.timer), ph: this.phase,
      c: this.ch.map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.z), ST[c.state], TY[c.type], c.dir]) };
    if (this.tick % 2 === 0) msg.p = [...this.players.values()].map(p => [p.id, Math.round(p.aim.x), Math.round(p.aim.y)]);
    if (this.tick % 20 === 0) msg.b = this.board();
    this.broadcast(msg);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const roomId = (q.get('room') || 'ciftlik').toLowerCase().replace(/[^a-z0-9ğüşıöç_-]/g, '').slice(0, 20) || 'ciftlik';
  let room = null, p = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!p) {
      if (m.t !== 'join') return;
      room = rooms.get(roomId);
      if (!room) { room = new Room(roomId); rooms.set(roomId, room); }
      if (room.players.size >= MAXP) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
      const name = String(m.name || 'Avcı').replace(/[<>&"]/g, '').trim().slice(0, 14) || 'Avcı';
      p = room.addPlayer(ws, name, m.w);
      return;
    }
    if (m.t === 'aim') { p.aim.x = clamp(+m.x || 0, 0, W); p.aim.y = clamp(+m.y || 0, 0, H); }
    else if (m.t === 'shot') room.shoot(p, m);
    else if (m.t === 'reload') room.reload(p);
    else if (m.t === 'weapon') room.setWeapon(p, m.w);
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
