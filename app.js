(() => {
const C = window.CONTENT;
const $ = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

// Границы кадров на каждой странице, в % от ширины/высоты: [x, y, w, h]
const PANELS = [
  [[0,0,100,31.77],[0,31.77,47.46,34.9],[47.46,31.77,52.54,34.9],[0,66.67,100,33.33]],
  [[0,0,100,31.64],[0,31.64,44.92,35.09],[44.92,31.64,55.08,35.09],[0,66.73,100,33.27]],
  [[0,0,100,27.54],[0,27.54,49.9,32.88],[49.9,27.54,50.1,32.88],[0,60.42,100,39.58]],
  [[0,0,100,25.59],[0,25.59,49.9,25.2],[49.9,25.59,50.1,25.2],[0,50.78,100,49.22]],
  [[0,0,100,25.59],[0,25.59,50,33.59],[50,25.59,50,33.59],[0,59.18,100,40.82]],
  [[0,0,100,31.64],[0,31.64,49.9,33.98],[49.9,31.64,50.1,33.98],[0,65.62,100,34.38]],
  [[0,0,100,31.84],[0,31.84,51.37,36.13],[51.37,31.84,48.63,36.13],[0,67.97,100,32.03]],
  [[0,0,100,33.53],[0,33.53,100,27.41],[0,60.94,100,39.06]]
];
const ASPECT = 1024 / 1536;
const pageSrc = p => `pages/${p + 1}.webp`;

// заполняем статичные тексты
document.querySelectorAll("[data-t]").forEach(el => el.textContent = C[el.dataset.t]);
PANELS.forEach((_, p) => { const i = new Image(); i.src = pageSrc(p); });

/* =================== ЗВЁЗДНОЕ НЕБО =================== */
const sky = $("#sky"), g = sky.getContext("2d");
let stars = [], shooting = [], dpr = 1;
function resizeSky() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  sky.width = innerWidth * dpr; sky.height = innerHeight * dpr;
  const n = Math.round(innerWidth * innerHeight / 2600);
  stars = Array.from({ length: n }, () => ({
    x: Math.random() * sky.width, y: Math.random() * sky.height,
    r: (Math.random() * 1.3 + .3) * dpr, t: Math.random() * 6.28, s: Math.random() * .02 + .005,
    c: Math.random() < .25 ? "203,188,255" : "255,255,255"
  }));
}
function drawSky() {
  const W = sky.width, H = sky.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#07061a"); bg.addColorStop(.6, "#120f38"); bg.addColorStop(1, "#1c1650");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (const s of stars) {
    s.t += s.s;
    g.globalAlpha = .35 + .65 * Math.abs(Math.sin(s.t));
    g.fillStyle = `rgb(${s.c})`; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.28); g.fill();
  }
  if (Math.random() < .004) shooting.push({ x: Math.random() * W, y: Math.random() * H * .4, l: 0 });
  shooting = shooting.filter(m => m.l < 1);
  for (const m of shooting) {
    m.l += .02; const len = 120 * dpr, x = m.x + m.l * 300 * dpr, y = m.y + m.l * 150 * dpr;
    const gr = g.createLinearGradient(x, y, x - len, y - len / 2);
    gr.addColorStop(0, `rgba(255,255,255,${1 - m.l})`); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.globalAlpha = 1; g.strokeStyle = gr; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - len, y - len / 2); g.stroke();
  }
  g.globalAlpha = 1;
  requestAnimationFrame(drawSky);
}
resizeSky(); drawSky();

/* =================== ЗВУК =================== */
let soundOn = true;
const voice = new Audio();
let onVoiceDone = null, voiceTimer = 0;

function playVoice(name, text) {
  voice.pause(); clearTimeout(voiceTimer);
  // если файла нет — «читаем про себя» по длине текста, чтобы автопрокрутка работала
  const fallback = () => { voiceTimer = setTimeout(() => onVoiceDone && onVoiceDone(), 1800 + text.length * 55); };
  if (!soundOn) return fallback();
  voice.src = `audio/voice/${name}.mp3`;
  voice.onended = () => { duck(false); voiceTimer = setTimeout(() => onVoiceDone && onVoiceDone(), 900); };
  voice.onerror = () => { duck(false); fallback(); };
  voice.play().then(() => duck(true)).catch(e => { if (e.name !== "AbortError") fallback(); });
}
function stopVoice() { voice.pause(); clearTimeout(voiceTimer); duck(false); }

/* ---------- МУЗЫКА: один трек, разбитый на части по главам ----------
   Части и привязка к страницам — в content.js (music). Если глава длиннее части,
   часть плавно начинается заново; если читатель ушёл дальше — плавный переход
   на следующую часть. Всё через Web Audio, чтобы наложения работали и на iPhone. */
const MUSIC_VOL = .4, DUCK = .4, XF = 3.5;            // громкость, приглушение под голос, длина наложения (сек)
const toSec = t => t == null ? null : typeof t === "number" ? t : t.split(":").reduce((m, x) => m * 60 + +x, 0);
const PARTS = (C.music && C.music.parts || []).map(([a, b]) => [toSec(a), toSec(b)]);
let actx = null, master = null, players = [], active = 0, curPart = -1, ducked = false, swapAt = 0;

function initMusic() {               // вызывается по первому нажатию — это требование браузеров
  if (actx || !C.music) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  master = actx.createGain(); master.gain.value = soundOn ? MUSIC_VOL : 0; master.connect(actx.destination);
  players = [0, 1].map(() => {
    const el = new Audio(C.music.file); el.preload = "auto";
    const gain = actx.createGain(); gain.gain.value = 0;
    actx.createMediaElementSource(el).connect(gain); gain.connect(master);
    el.play().then(() => { if (!el._wanted) el.pause(); }).catch(() => {});   // «разблокировать» оба плеера сразу
    return { el, gain };
  });
  setInterval(musicTick, 250);
}
function ramp(param, to, sec) {
  const t = actx.currentTime; param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(to, t + sec);
}
function partEnd(i, el) { return PARTS[i][1] ?? (el.duration || 1e9); }
function crossTo(i) {
  if (!actx || !PARTS[i]) return;
  const from = players[active], to = players[1 - active];
  active = 1 - active; swapAt = performance.now();
  const go = () => {
    to.el._wanted = true; to.el.currentTime = PARTS[i][0];
    to.el.play().catch(() => {});
    ramp(to.gain.gain, 1, XF);
  };
  to.el.readyState >= 1 ? go() : to.el.addEventListener("loadedmetadata", go, { once: true });
  from.el._wanted = false; ramp(from.gain.gain, 0, XF);
  setTimeout(() => { if (players[active] !== from) from.el.pause(); }, XF * 1000 + 200);
}
function musicTick() {               // часть подходит к концу, а глава ещё идёт — начинаем её заново
  if (curPart < 0 || performance.now() - swapAt < XF * 1000 + 500) return;
  const el = players[active].el;
  if (!el.paused && el.currentTime >= partEnd(curPart, el) - XF) crossTo(curPart);
}
function setMusic(part) {
  initMusic();
  if (part === curPart) return;
  curPart = part; crossTo(part);
}
function musicLevel() { return soundOn ? MUSIC_VOL * (ducked ? DUCK : 1) : 0; }
function duck(on) { ducked = on; if (master) ramp(master.gain, musicLevel(), .6); }
const chapter = p => C.music ? C.music.pages[p] : 0;

$("#soundBtn").onclick = e => {
  e.stopPropagation();
  soundOn = !soundOn; e.currentTarget.classList.toggle("on", soundOn);
  toast(soundOn ? "Звук включён" : "Звук выключен");
  if (!soundOn) voice.pause();
  if (master) ramp(master.gain, musicLevel(), .4);
};

/* =================== ЭКРАНЫ =================== */
function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

/* ---------- обложка ---------- */
$(".moon").onclick = e => burst(document.body, e.clientX, e.clientY, 18);
$("#openBtn").onclick = () => { setMusic(0); startPrologue(); };

/* ---------- пролог ---------- */
let prologueReady = false;
function startPrologue() {
  show("prologue");
  const box = $("#prologueText");
  box.innerHTML = C.intro.split(" ").map(w => `<span class="w">${w}</span>`).join(" ");
  const words = [...box.querySelectorAll(".w")];
  prologueReady = false;
  words.forEach((w, i) => setTimeout(() => w.classList.add("in"), 700 + i * 140));
  setTimeout(() => prologueReady = true, 700 + words.length * 140);
  onVoiceDone = null;
  playVoice("intro", C.intro);
}
$("#prologue").onclick = () => {
  if (!$("#prologue").classList.contains("active")) return;
  if (!prologueReady) { document.querySelectorAll("#prologueText .w").forEach(w => w.classList.add("in")); prologueReady = true; return; }
  stopVoice(); startReader(0);
};

/* =================== ЧИТАЛКА =================== */
let zoomOn = true, autoOn = false;
let steps = [], cur = -1, curPage = -1, busy = false;
const stage = $("#stage"), cam = $("#cam"), pageEl = $("#page"), img = $("#pageImg"), coversEl = $("#covers"), cap = $("#captionText");
let covers = [], pageW = 0, pageH = 0;

function buildSteps() {
  steps = [];
  PANELS.forEach((pp, p) => {
    pp.forEach((_, k) => steps.push({ p, k }));
    if (zoomOn) steps.push({ p, k: -1 }); // общий план страницы
  });
}
buildSteps();

$("#progress").innerHTML = PANELS.map(() => "<i></i>").join("");

function layout() {
  const W = stage.clientWidth, H = stage.clientHeight;
  pageW = Math.min(W * .96, H * .96 * ASPECT); pageH = pageW / ASPECT;
  pageEl.style.width = pageW + "px"; pageEl.style.height = pageH + "px";
}
function camTo(k, instant) {
  const W = stage.clientWidth, H = stage.clientHeight;
  let s = 1, tx = (W - pageW) / 2, ty = (H - pageH) / 2;
  if (zoomOn && k >= 0) {
    const [x, y, w, h] = PANELS[curPage][k].map((v, i) => v / 100 * (i % 2 ? pageH : pageW));
    s = Math.max(1, Math.min(W * .96 / w, H * .96 / h, 3));
    tx = W / 2 - (x + w / 2) * s; ty = H / 2 - (y + h / 2) * s;
  }
  if (instant) { cam.style.transition = "none"; requestAnimationFrame(() => requestAnimationFrame(() => cam.style.transition = "")); }
  cam.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
}
addEventListener("resize", () => {
  resizeSky();
  if (cur >= 0) { layout(); camTo(steps[cur].k, true); }
});

function makeCovers(p) {
  coversEl.innerHTML = "";
  covers = PANELS[p].map(([x, y, w, h]) => {
    const d = document.createElement("div");
    d.className = "cover instant";
    // небольшой запас, чтобы не было щелей на стыках
    Object.assign(d.style, { left: x - .3 + "%", top: y - .3 + "%", width: w + .6 + "%", height: h + .6 + "%" });
    coversEl.appendChild(d);
    return d;
  });
  requestAnimationFrame(() => covers.forEach(c => c.classList.remove("instant")));
}

async function goto(i) {
  if (busy || i < 0) return;
  try { await gotoInner(i); } catch (e) { console.error(e); } finally { busy = false; }
}
async function gotoInner(i) {
  stopVoice();
  if (i >= steps.length) return startEpilogue();
  busy = true;
  const st = steps[i];
  if (st.p !== curPage) {
    if (curPage >= 0) { pageEl.classList.add("fade"); await wait(900); }
    curPage = st.p; img.src = pageSrc(st.p);
    try { await img.decode(); } catch (e) {}
    layout(); makeCovers(st.p);
    // если идём назад — открываем все кадры до текущего без анимации
    const openTo = st.k < 0 ? covers.length - 1 : st.k;
    covers.forEach((c, k) => { if (k < openTo || (i < cur && k <= openTo)) c.classList.add("open", "instant"); });
    camTo(-1, true);
    pageEl.classList.remove("fade");
    document.querySelectorAll("#progress i").forEach((d, k) => d.classList.toggle("done", k <= st.p));
    setMusic(chapter(st.p));
    await wait(i < cur ? 200 : 700);
  }
  cur = i;
  // открытие кадров
  covers.forEach((c, k) => {
    const shouldOpen = st.k < 0 || k <= st.k;
    if (shouldOpen && !c.classList.contains("open")) { c.classList.add("open"); sparksIn(k); }
    if (!shouldOpen && c.classList.contains("open")) { c.classList.remove("open", "instant"); }
  });
  camTo(st.k);
  // подпись и голос
  cap.classList.remove("in");
  await wait(250);
  if (st.k >= 0) {
    const text = C.pages[st.p][st.k];
    cap.textContent = text; cap.classList.add("in");
    onVoiceDone = () => autoOn && next();
    setTimeout(() => playVoice(`${st.p + 1}-${st.k + 1}`, text), 500);
  } else {
    cap.textContent = ""; stopVoice();
    onVoiceDone = null;
    if (autoOn) voiceTimer = setTimeout(() => autoOn && next(), 3500);
  }
  busy = false;
}
const next = () => goto(cur + 1);
const prev = () => goto(cur - 1);

function sparksIn(k) {
  const [x, y, w, h] = PANELS[curPage][k];
  const cx = (x + w / 2) / 100 * pageW, cy = (y + h / 2) / 100 * pageH;
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    const a = Math.random() * 6.28, d = 40 + Math.random() * Math.max(w / 100 * pageW, h / 100 * pageH) * .6;
    s.style.left = cx + "px"; s.style.top = cy + "px";
    s.style.setProperty("--dx", Math.cos(a) * d + "px"); s.style.setProperty("--dy", Math.sin(a) * d + "px");
    s.style.animationDelay = Math.random() * .4 + "s";
    coversEl.appendChild(s); setTimeout(() => s.remove(), 2000);
  }
}

function startReader(i) {
  if ($("#reader").classList.contains("active")) return;
  show("reader"); curPage = -1; cur = -1;
  requestAnimationFrame(() => { layout(); goto(i); });
  if (!sessionStorage.hinted) { sessionStorage.hinted = 1; toast("Касайся экрана, чтобы открывать кадры.\nСлева – шаг назад."); }
}

// управление: тап справа/по центру — дальше, по левой трети — назад, свайпы, клавиши
let touchX = null, swiped = false;
const reader = $("#reader");
reader.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; swiped = false; }, { passive: true });
reader.addEventListener("touchend", e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  if (Math.abs(dx) > 50) { swiped = true; dx < 0 ? next() : prev(); }
});
reader.addEventListener("click", e => {
  if (swiped) { swiped = false; return; }
  if (e.target.closest(".controls")) return;
  e.clientX < innerWidth * .3 ? prev() : next();
});
addEventListener("keydown", e => {
  if (!$("#reader").classList.contains("active")) return;
  if (["ArrowRight", " ", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
  if (e.key === "ArrowLeft") prev();
});

$("#autoBtn").onclick = e => {
  e.stopPropagation(); autoOn = !autoOn;
  e.currentTarget.classList.toggle("on", autoOn); e.currentTarget.textContent = autoOn ? "❚❚" : "▶";
  toast(autoOn ? "Автопрокрутка: сказка листается сама" : "Автопрокрутка выключена");
  if (autoOn && !busy && voice.paused) next();
};
$("#zoomBtn").onclick = e => {
  e.stopPropagation(); const st = steps[cur];
  if (!st || busy) return;
  zoomOn = !zoomOn; e.currentTarget.classList.toggle("on", zoomOn);
  buildSteps();
  cur = steps.findIndex(s => s.p === st.p && s.k === (st.k < 0 ? PANELS[st.p].length - 1 : st.k));
  camTo(steps[cur].k);
  toast(zoomOn ? "Кадры приближаются" : "Вся страница целиком");
};

/* =================== ЭПИЛОГ =================== */
let epiIdx = -1;
function startEpilogue() {
  stopVoice(); show("epilogue"); setMusic(C.music ? C.music.epilogue : 0);
  const box = $("#epilogueLines");
  box.innerHTML = C.epilogue.map(t => `<p>${t}</p>`).join("");
  $("#toFinale").classList.add("hidden");
  epiIdx = -1; setTimeout(epiNext, 1200);
}
function epiNext() {
  const lines = document.querySelectorAll("#epilogueLines p");
  epiIdx++;
  if (epiIdx >= lines.length) { onVoiceDone = null; $("#toFinale").classList.remove("hidden"); return; }
  lines[epiIdx].classList.add("in");
  onVoiceDone = epiNext;
  playVoice(`epilogue-${epiIdx + 1}`, C.epilogue[epiIdx]);
}
$("#epilogue").onclick = e => { if (e.target.id !== "toFinale" && epiIdx < C.epilogue.length) { stopVoice(); epiNext(); } };
$("#toFinale").onclick = e => { e.stopPropagation(); startFinale(); };

/* =================== ФИНАЛ =================== */
function startFinale() {
  show("finale"); $("#finale").scrollTop = 0;
  burst(document.body, innerWidth / 2, innerHeight * .2, 40);
}

// письмо: последний пункт — подпись
const gr = C.greeting;
$("#letter").innerHTML = gr.slice(0, -1).map(t => `<p>${t}</p>`).join("") + `<p class="sign">${gr[gr.length - 1]}</p>`;

// торт
const candles = [...document.querySelectorAll(".candle")];
candles.forEach(c => c.onclick = () => {
  if (c.classList.contains("out")) return;
  c.classList.add("out");
  const r = c.getBoundingClientRect(); burst(document.body, r.left + r.width / 2, r.top, 8);
  if (candles.every(x => x.classList.contains("out"))) {
    $("#cakeHint").textContent = "Желание загадано ✨ Оно обязательно сбудется";
    const cr = $("#cake").getBoundingClientRect(); burst(document.body, cr.left + cr.width / 2, cr.top + 40, 60);
  }
});

// игра с бабочками
const BFLY = `<svg viewBox="-22 -19 44 38"><g class="wl"><path d="M0 0 C-8 -18,-24 -20,-20 -6 C-18 2,-8 2,0 0 Z" fill="rgba(230,220,255,.85)" stroke="#fff" stroke-width=".8"/><path d="M0 0 C-10 4,-18 14,-10 16 C-4 17,-1 8,0 0 Z" fill="rgba(200,185,255,.8)" stroke="#fff" stroke-width=".8"/></g><g class="wr"><path d="M0 0 C8 -18,24 -20,20 -6 C18 2,8 2,0 0 Z" fill="rgba(230,220,255,.85)" stroke="#fff" stroke-width=".8"/><path d="M0 0 C10 4,18 14,10 16 C4 17,1 8,0 0 Z" fill="rgba(200,185,255,.8)" stroke="#fff" stroke-width=".8"/></g><ellipse rx="1.6" ry="9" fill="#fff"/></svg>`;
const meadow = $("#meadow"); let caught = 0, gameOn = false;
$("#need").textContent = C.gameCount;
function spawnBfly() {
  const b = document.createElement("div"); b.className = "bfly"; b.innerHTML = BFLY;
  const move = () => { b.style.left = Math.random() * (meadow.clientWidth - 44) + "px"; b.style.top = Math.random() * (meadow.clientHeight - 38) + "px"; };
  move(); meadow.appendChild(b);
  const iv = setInterval(move, 2200 + Math.random() * 1500);
  b.onclick = e => {
    if (b.classList.contains("caught")) return;
    clearInterval(iv); b.classList.add("caught"); burst(document.body, e.clientX, e.clientY, 12);
    setTimeout(() => b.remove(), 700);
    caught++; $("#caught").textContent = caught;
    if (caught >= C.gameCount) { setTimeout(() => modal(C.secret), 700); }
    else spawnBfly();
  };
}
new IntersectionObserver(es => {
  if (es[0].isIntersecting && !gameOn) { gameOn = true; for (let i = 0; i < 3; i++) setTimeout(spawnBfly, i * 400); }
}).observe(meadow);

$("#reread").onclick = () => { setMusic(0); startReader(0); };

/* =================== МЕЛОЧИ =================== */
function burst(parent, x, y, n) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span"); s.className = "spark";
    const a = Math.random() * 6.28, d = 30 + Math.random() * 90;
    Object.assign(s.style, { position: "fixed", left: x + "px", top: y + "px", zIndex: 30 });
    s.style.setProperty("--dx", Math.cos(a) * d + "px"); s.style.setProperty("--dy", Math.sin(a) * d + "px");
    parent.appendChild(s); setTimeout(() => s.remove(), 1500);
  }
}
function modal(text) { $("#modalText").textContent = text; $("#modal").classList.remove("hidden"); }
$("#modalClose").onclick = () => $("#modal").classList.add("hidden");
let toastEl;
function toast(t) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = t; toastEl.classList.add("in");
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("in"), 2800);
}
})();
