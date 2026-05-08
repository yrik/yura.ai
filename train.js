// Pre-train the drone hover policy via genetic algorithm.
// Run: node train.js
// Output: paste the printed `const PRETRAINED = [...]` into index.html.

const W = 1280, H = 720;
const GRAVITY = 0.06, THRUST_MAX = 0.085;
const TORQUE_SCALE = 0.012, VEL_DAMP = 0.997, ANG_DAMP = 0.97;
const MAX_V = 6, MAX_OMEGA = 0.4;
const IN = 7, HID = 8, OUT = 2;
const NUM_W = IN * HID + HID + HID * OUT + OUT;

const POP_SIZE = 60;
const ELITE = 4;
const MUT_RATE = 0.10;
const MUT_SCALE = 0.4;
const FRAMES_PER_GEN = 360;
const NUM_GENS = 1200;
const TOURNEY = 4;

function randWeights() {
  const w = new Float32Array(NUM_W);
  for (let i = 0; i < NUM_W; i++) w[i] = (Math.random() * 2 - 1) * 0.7;
  return w;
}

const _hidden = new Float32Array(HID);
const _out = new Float32Array(OUT);
const _inputs = new Float64Array(IN);

function forward(w) {
  let idx = 0;
  for (let j = 0; j < HID; j++) {
    let s = 0;
    for (let i = 0; i < IN; i++) s += _inputs[i] * w[idx++];
    s += w[idx++];
    _hidden[j] = Math.tanh(s);
  }
  for (let k = 0; k < OUT; k++) {
    let s = 0;
    for (let j = 0; j < HID; j++) s += _hidden[j] * w[idx++];
    s += w[idx++];
    _out[k] = Math.tanh(s);
  }
}

function evaluate(w, tx, ty) {
  let x = W * (0.35 + Math.random() * 0.3);
  let y = H * (0.35 + Math.random() * 0.25);
  let vx = (Math.random() - 0.5) * 1.2;
  let vy = (Math.random() - 0.5) * 1.2;
  let theta = (Math.random() - 0.5) * 0.5;
  let omega = (Math.random() - 0.5) * 0.06;
  let fitness = 0;

  for (let f = 0; f < FRAMES_PER_GEN; f++) {
    _inputs[0] = (x - tx) / W;
    _inputs[1] = (y - ty) / H;
    _inputs[2] = vx / MAX_V;
    _inputs[3] = vy / MAX_V;
    _inputs[4] = Math.sin(theta);
    _inputs[5] = Math.cos(theta);
    _inputs[6] = omega / MAX_OMEGA;
    forward(w);
    const left = (_out[0] + 1) * 0.5;
    const right = (_out[1] + 1) * 0.5;

    const upX = Math.sin(theta);
    const upY = -Math.cos(theta);
    const totalT = (left + right) * THRUST_MAX;
    vx = (vx + upX * totalT) * VEL_DAMP;
    vy = (vy + upY * totalT + GRAVITY) * VEL_DAMP;

    omega = (omega + (left - right) * TORQUE_SCALE) * ANG_DAMP;

    const sp = Math.hypot(vx, vy);
    if (sp > MAX_V) { vx *= MAX_V / sp; vy *= MAX_V / sp; }
    if (omega > MAX_OMEGA) omega = MAX_OMEGA;
    else if (omega < -MAX_OMEGA) omega = -MAX_OMEGA;

    x += vx; y += vy; theta += omega;

    if (x < -40 || x > W + 40 || y < -80 || y > H + 40) return fitness;
    if (Math.abs(theta) > Math.PI * 1.2) return fitness;

    const d = Math.hypot(x - tx, y - ty);
    fitness += 0.6 / (1 + d * 0.012)
             + 0.2 / (1 + sp * 0.6)
             + 0.2 * Math.max(0, Math.cos(theta));
  }
  return fitness;
}

let pop = [];
for (let i = 0; i < POP_SIZE; i++) pop.push({ w: randWeights(), fit: 0 });

const t0 = Date.now();
for (let gen = 0; gen < NUM_GENS; gen++) {
  const tx = W * (0.30 + Math.random() * 0.4);
  const ty = H * (0.30 + Math.random() * 0.4);

  for (const ind of pop) ind.fit = evaluate(ind.w, tx, ty);
  pop.sort((a, b) => b.fit - a.fit);

  if (gen % 50 === 0 || gen === NUM_GENS - 1) {
    const avg = pop.reduce((s, p) => s + p.fit, 0) / POP_SIZE;
    console.log(`gen ${String(gen).padStart(4)}: best=${(pop[0].fit / FRAMES_PER_GEN).toFixed(3)} avg=${(avg / FRAMES_PER_GEN).toFixed(3)}`);
  }

  if (gen === NUM_GENS - 1) break;

  const next = [];
  for (let i = 0; i < ELITE; i++) next.push({ w: new Float32Array(pop[i].w), fit: 0 });
  while (next.length < POP_SIZE) {
    const tour = () => {
      let best = pop[Math.floor(Math.random() * POP_SIZE)];
      for (let i = 1; i < TOURNEY; i++) {
        const c = pop[Math.floor(Math.random() * POP_SIZE)];
        if (c.fit > best.fit) best = c;
      }
      return best;
    };
    const a = tour(), b = tour();
    const child = new Float32Array(NUM_W);
    const cut = Math.floor(Math.random() * NUM_W);
    for (let i = 0; i < NUM_W; i++) child[i] = i < cut ? a.w[i] : b.w[i];
    for (let i = 0; i < NUM_W; i++) {
      if (Math.random() < MUT_RATE) child[i] += (Math.random() * 2 - 1) * MUT_SCALE;
    }
    next.push({ w: child, fit: 0 });
  }
  pop = next;
}

console.log(`\ntraining done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('\nrobust eval (60 random targets each, top 20 of final pop):');
const robust = [];
for (let i = 0; i < Math.min(20, POP_SIZE); i++) {
  let total = 0;
  for (let j = 0; j < 60; j++) {
    const tx = W * (0.30 + Math.random() * 0.4);
    const ty = H * (0.30 + Math.random() * 0.4);
    total += evaluate(pop[i].w, tx, ty);
  }
  robust.push({ w: pop[i].w, score: total / 60 });
}
robust.sort((a, b) => b.score - a.score);

for (let i = 0; i < 6; i++) {
  console.log(`  #${i}: ${(robust[i].score / FRAMES_PER_GEN).toFixed(3)}`);
}

const output = robust.slice(0, 6).map(r => Array.from(r.w).map(v => +v.toFixed(4)));
console.log('\n=== PRE-TRAINED WEIGHTS ===');
console.log('const PRETRAINED = ' + JSON.stringify(output) + ';');
