/* yura.ai music — a stereomood-style mood radio, powered by the open Audius network.
   No API key required: Audius exposes a public, CORS-friendly HTTP API. */

const APP = 'yura.ai-music';

/* Audius gateway + a few discovery-node fallbacks in case one is down. */
const HOSTS = [
  'https://api.audius.co',
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co'
];
let hostIdx = 0;

/* ---------- moods ----------
   Each tile maps to Audius search terms + the platform's own "mood" tags,
   which we use to sort the most fitting tracks to the front. */
const MOODS = [
  { id:'happy',     label:'Happy',      emoji:'😄', sub:'sunny & upbeat',
    grad:'linear-gradient(135deg,#ff9a3c,#ff5e62)', q:['happy upbeat pop','feel good summer'], m:['Upbeat','Excited','Empowering'] },
  { id:'chill',     label:'Chill',      emoji:'🌿', sub:'lofi & easy',
    grad:'linear-gradient(135deg,#43c6ac,#191654)', q:['chill lofi','chillhop relax'], m:['Easygoing','Peaceful','Cool'] },
  { id:'focus',     label:'Focus',      emoji:'🎯', sub:'deep work beats',
    grad:'linear-gradient(135deg,#2b5876,#4e4376)', q:['focus study beats','ambient concentration'], m:['Sophisticated','Serious','Peaceful'] },
  { id:'energetic', label:'Energetic',  emoji:'⚡', sub:'move your body',
    grad:'linear-gradient(135deg,#f7971e,#ff2d55)', q:['workout energy edm','high energy electronic'], m:['Energizing','Rowdy','Aggressive'] },
  { id:'romantic',  label:'Romantic',   emoji:'💗', sub:'warm & tender',
    grad:'linear-gradient(135deg,#ff6a88,#ff99ac)', q:['romantic rnb','love soul slow'], m:['Romantic','Sensual','Tender'] },
  { id:'melancholy',label:'Melancholy', emoji:'🌧️', sub:'rainy & wistful',
    grad:'linear-gradient(135deg,#485563,#29323c)', q:['sad melancholy piano','emotional indie'], m:['Melancholy','Yearning','Sentimental'] },
  { id:'party',     label:'Party',      emoji:'🪩', sub:'turn it up',
    grad:'linear-gradient(135deg,#8e2de2,#e94057)', q:['party dance house','club banger'], m:['Excited','Rowdy','Energizing'] },
  { id:'dreamy',    label:'Dreamy',     emoji:'🌌', sub:'floaty & ambient',
    grad:'linear-gradient(135deg,#5f2c82,#49a09d)', q:['dreamy ambient','ethereal synthwave'], m:['Peaceful','Cool','Sophisticated'] },
  { id:'sleep',     label:'Sleep',      emoji:'🌙', sub:'drift away',
    grad:'linear-gradient(135deg,#0f2027,#203a43)', q:['sleep ambient calm','deep relaxation drone'], m:['Peaceful','Tender'] },
  { id:'adventure', label:'Epic',       emoji:'🚀', sub:'cinematic & bold',
    grad:'linear-gradient(135deg,#c31432,#240b36)', q:['epic cinematic orchestral','adventure trailer'], m:['Stirring','Empowering','Fiery'] },
  { id:'groovy',    label:'Groovy',     emoji:'🕺', sub:'funk & soul',
    grad:'linear-gradient(135deg,#f12711,#f5af19)', q:['funk groove disco','soulful house'], m:['Cool','Easygoing','Upbeat'] },
  { id:'surprise',  label:'Surprise me',emoji:'🎲', sub:'trending now',
    grad:'linear-gradient(135deg,#36d1dc,#5b86e5)', q:[], m:[], trending:true }
];

/* ---------- state ---------- */
let queue = [];
let qi = -1;
let currentMood = null;
const audio = new Audio();
audio.preload = 'auto';
audio.crossOrigin = 'anonymous';

/* ---------- dom ---------- */
const $ = (s) => document.querySelector(s);
const moodGrid = $('#moods');
const player = $('#player');
const elArt = $('#art');
const elTitle = $('#ptitle');
const elArtist = $('#partist');
const elPlay = $('#play');
const elBar = $('#bar');
const elBuf = $('#buf');
const elProg = $('#progress');
const elTime = $('#time');

/* ---------- helpers ---------- */
const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
function toast(msg, ms = 2600) {
  let t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const artOf = (t) => (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'] || t.artwork['1000x1000'])) || '';
const streamUrl = (t) => `${HOSTS[hostIdx]}/v1/tracks/${t.id}/stream?app_name=${APP}`;

/* fetch with host rotation on failure */
async function api(path) {
  let lastErr;
  for (let attempt = 0; attempt < HOSTS.length; attempt++) {
    const base = HOSTS[hostIdx];
    try {
      const sep = path.includes('?') ? '&' : '?';
      const res = await fetch(`${base}${path}${sep}app_name=${APP}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      hostIdx = (hostIdx + 1) % HOSTS.length; // try next node
    }
  }
  throw lastErr;
}

function usable(t) {
  return t && t.id && t.is_streamable !== false && !t.is_delete && (t.duration || 0) > 30;
}

/* Build a playlist for a mood. */
async function buildQueue(mood) {
  let tracks = [];
  if (mood.trending) {
    const genres = ['Electronic', 'Hip-Hop/Rap', 'Pop', 'Alternative'];
    const g = genres[(Math.random() * genres.length) | 0];
    const r = await api(`/v1/tracks/trending?genre=${encodeURIComponent(g)}&limit=40`);
    tracks = (r.data || []).filter(usable);
  } else {
    const results = await Promise.allSettled(
      mood.q.map((q) => api(`/v1/tracks/search?query=${encodeURIComponent(q)}&limit=30`))
    );
    const seen = new Set();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const t of (r.value.data || [])) {
        if (usable(t) && !seen.has(t.id)) { seen.add(t.id); tracks.push(t); }
      }
    }
    // float tracks whose Audius mood matches this tile to the front
    const set = new Set(mood.m);
    tracks.sort((a, b) => (set.has(b.mood) ? 1 : 0) - (set.has(a.mood) ? 1 : 0));
    const top = tracks.filter((t) => set.has(t.mood));
    const rest = shuffle(tracks.filter((t) => !set.has(t.mood)));
    tracks = [...shuffle(top), ...rest];
  }
  return tracks.slice(0, 40);
}

/* ---------- playback ---------- */
async function playMood(mood, tile) {
  currentMood = mood;
  document.querySelectorAll('.mood').forEach((m) => m.classList.remove('playing'));
  tile.classList.add('playing');
  player.classList.add('up');
  elTitle.innerHTML = `<span class="spin"></span>Finding ${mood.label.toLowerCase()} tracks…`;
  elArtist.textContent = 'from the Audius network';
  elArt.style.backgroundImage = 'none';

  try {
    queue = await buildQueue(mood);
  } catch (e) {
    elTitle.textContent = 'Network hiccup';
    elArtist.textContent = 'Could not reach Audius — try again';
    toast('⚠️ Could not load tracks. Check your connection.');
    return;
  }
  if (!queue.length) {
    elTitle.textContent = 'Nothing found';
    elArtist.textContent = 'Try another mood';
    return;
  }
  qi = -1;
  next();
}

function load(track) {
  elArt.style.backgroundImage = artOf(track) ? `url("${artOf(track)}")` : 'none';
  elTitle.textContent = track.title || 'Untitled';
  const moodTag = track.mood ? ` · <span class="badge">${track.mood}</span>` : '';
  elArtist.innerHTML = `${(track.user && track.user.name) || 'Unknown artist'}${moodTag}`;
  audio.src = streamUrl(track);
  audio.play().catch(() => {});
  updateMediaSession(track);
  document.title = `${track.title} — yura.ai music`;
}

function next() {
  if (!queue.length) return;
  qi = (qi + 1) % queue.length;
  if (qi === 0 && queue.length > 1) shuffle(queue); // reshuffle on loop
  load(queue[qi]);
}
function prev() {
  if (!queue.length) return;
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  qi = (qi - 1 + queue.length) % queue.length;
  load(queue[qi]);
}
function toggle() {
  if (!queue.length) {
    // nothing chosen yet → pick a random mood
    const m = MOODS[(Math.random() * (MOODS.length - 1)) | 0];
    playMood(m, document.querySelector(`.mood[data-id="${m.id}"]`));
    return;
  }
  if (audio.paused) audio.play(); else audio.pause();
}

/* ---------- media session (lock screen / hardware keys) ---------- */
function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  const art = artOf(track);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || 'Untitled',
    artist: (track.user && track.user.name) || 'Audius',
    album: currentMood ? `yura.ai music · ${currentMood.label}` : 'yura.ai music',
    artwork: art ? [
      { src: art, sizes: '480x480', type: 'image/jpeg' },
      { src: art, sizes: '150x150', type: 'image/jpeg' }
    ] : []
  });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', next);
  navigator.mediaSession.setActionHandler('previoustrack', prev);
}

/* ---------- audio events ---------- */
audio.addEventListener('play', () => { elPlay.innerHTML = ICON.pause; });
audio.addEventListener('pause', () => { elPlay.innerHTML = ICON.play; });
audio.addEventListener('ended', next);
audio.addEventListener('error', () => { if (queue.length) { toast('Skipping unplayable track…', 1500); next(); } });
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  elBar.style.width = d ? (audio.currentTime / d) * 100 + '%' : '0%';
  elTime.textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
});
audio.addEventListener('progress', () => {
  if (audio.buffered.length && audio.duration) {
    elBuf.style.width = (audio.buffered.end(audio.buffered.length - 1) / audio.duration) * 100 + '%';
  }
});

/* ---------- icons ---------- */
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>'
};

/* ---------- build UI ---------- */
function render() {
  moodGrid.innerHTML = '';
  for (const m of MOODS) {
    const el = document.createElement('button');
    el.className = 'mood';
    el.dataset.id = m.id;
    el.style.setProperty('--grad', m.grad);
    el.setAttribute('aria-label', `Play ${m.label} mood`);
    el.innerHTML = `
      <div class="eq"><span></span><span></span><span></span><span></span></div>
      <div class="emoji">${m.emoji}</div>
      <div class="label">${m.label}</div>
      <div class="sub">${m.sub}</div>`;
    el.addEventListener('click', () => playMood(m, el));
    moodGrid.appendChild(el);
  }
  elPlay.innerHTML = ICON.play;
  $('#prev').innerHTML = ICON.prev;
  $('#next').innerHTML = ICON.next;
}

/* control wiring */
elPlay.addEventListener('click', toggle);
$('#next').addEventListener('click', next);
$('#prev').addEventListener('click', prev);
elProg.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const r = elProg.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
});
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'ArrowRight') next();
  else if (e.code === 'ArrowLeft') prev();
});

/* ---------- PWA: install prompt + service worker ---------- */
let deferredPrompt = null;
const installBtn = $('#installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'inline-flex';
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = 'none';
});
window.addEventListener('appinstalled', () => {
  installBtn.style.display = 'none';
  toast('✅ Installed! Launch yura.ai music from your home screen.');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

render();
