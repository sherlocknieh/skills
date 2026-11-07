#!/usr/bin/env node
/**
 * 程序化配乐：按 BPM 直接合成 WAV，不采样、不联网。
 *   node src/audio.mjs --dur 14 --bpm 120 --out audio.wav
 *
 * 结构：pad 铺底 + 根音贝斯 + 四四拍鼓组 + 琶音，最后一遍响度归一。
 * 所有随机量都带种子，同样的参数永远得到同样的音频。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = { dur: '14', bpm: '120', out: 'out/audio.wav', sr: '48000' };
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  const v = argv[i + 1];
  if (v && !v.startsWith('--')) { opt[k] = v; i++; }
  else opt[k] = 'true';
}

const SR = Number(opt.sr);
const DUR = Number(opt.dur);
const BPM = Number(opt.bpm);
const N = Math.ceil(DUR * SR);

const L = new Float32Array(N);
const R = new Float32Array(N);

/* ---------- 工具 ---------- */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xC0FFEE);

function add(t, v, pan = 0) {
  const i = Math.floor(t * SR);
  if (i < 0 || i >= N) return;
  const gl = Math.sqrt(0.5 * (1 - pan));
  const gr = Math.sqrt(0.5 * (1 + pan));
  L[i] += v * gl;
  R[i] += v * gr;
}

/* ---------- 乐器 ---------- */
function kick(t0, gain = 0.85) {
  const len = 0.30;
  let ph = 0;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR;
    const f = 48 + 110 * Math.exp(-t * 30);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 8.5) * Math.min(1, t * 400);
    add(t0 + t, Math.sin(ph) * env * gain);
  }
}

function hat(t0, gain = 0.12, pan = 0.25) {
  const len = 0.06;
  let prev = 0;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR;
    const white = rnd() * 2 - 1;
    const hp = white - prev; // 一阶高通，做亮一点的金属感
    prev = white;
    add(t0 + t, hp * Math.exp(-t * 90) * gain, pan);
  }
}

function snare(t0, gain = 0.22) {
  const len = 0.18;
  let prev = 0;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR;
    const white = rnd() * 2 - 1;
    const hp = white - prev;
    prev = white;
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 22) * 0.5;
    add(t0 + t, (hp * 0.8 + body) * Math.exp(-t * 16) * gain);
  }
}

function bass(t0, m, dur, gain = 0.32) {
  const f = midi(m);
  let ph = 0;
  for (let k = 0; k < dur * SR; k++) {
    const t = k / SR;
    ph += (2 * Math.PI * f) / SR;
    const env = Math.min(1, t * 120) * Math.exp(-t * 3.2);
    const s = Math.sin(ph) + 0.25 * Math.sin(ph * 2);
    add(t0 + t, s * env * gain);
  }
}

function pluck(t0, m, dur, gain = 0.14, pan = 0) {
  const f = midi(m);
  let ph = 0;
  for (let k = 0; k < dur * SR; k++) {
    const t = k / SR;
    ph += (2 * Math.PI * f) / SR;
    // 三角波近似：奇次谐波叠加
    const s =
      Math.sin(ph) * 1.0 +
      Math.sin(ph * 3) * 0.22 +
      Math.sin(ph * 5) * 0.09;
    const env = Math.min(1, t * 300) * Math.exp(-t * 7.5);
    add(t0 + t, s * env * gain, pan);
  }
}

function pad(t0, notes, dur, gain = 0.055) {
  for (const m of notes) {
    for (const det of [-0.08, 0, 0.08]) {
      const f = midi(m) * (1 + det * 0.0015);
      let ph = 0;
      for (let k = 0; k < dur * SR; k++) {
        const t = k / SR;
        ph += (2 * Math.PI * f) / SR;
        const env =
          Math.min(1, t / 0.35) *
          Math.min(1, Math.max(0, (dur - t) / 0.6));
        add(t0 + t, Math.sin(ph) * env * gain, det * 6);
      }
    }
  }
}

/* ---------- 编曲 ---------- */
const beat = 60 / BPM;
const bar = beat * 4;
const CH = [
  { pad: [57, 60, 64], root: 45 }, // Am
  { pad: [53, 57, 60], root: 41 }, // F
  { pad: [48, 52, 55], root: 36 }, // C
  { pad: [55, 59, 62], root: 43 }, // G
];

const bars = Math.ceil(DUR / bar);
for (let b = 0; b < bars; b++) {
  const t0 = b * bar;
  const c = CH[b % 4];

  pad(t0, c.pad, Math.min(bar + 0.3, DUR - t0), 0.05);
  bass(t0, c.root, Math.min(beat * 1.6, DUR - t0), 0.30);
  bass(t0 + beat * 2, c.root, Math.min(beat * 1.2, DUR - t0 - beat * 2), 0.22);

  for (let q = 0; q < 4; q++) {
    const tb = t0 + q * beat;
    if (tb > DUR) break;
    if (q === 0 || q === 2) kick(tb, 0.8);
    if (q === 2 && b % 2 === 1) snare(tb, 0.18);
    hat(tb + beat * 0.5, 0.10, 0.3);
    if (b > 0) hat(tb, 0.05, -0.25);
  }

  // 琶音：八分音符，和弦音上行
  for (let e = 0; e < 8; e++) {
    const te = t0 + e * beat * 0.5;
    if (te > DUR - 0.1) break;
    const note = c.pad[e % 3] + 12 + (e >= 6 ? 12 : 0);
    pluck(te, note, 0.35, e % 2 ? 0.075 : 0.10, e % 2 ? 0.35 : -0.35);
  }
}

// 收尾：最后 1.6s 的 riser + 终止和弦
const endT = Math.max(0, DUR - 1.6);
for (let k = 0; k < (DUR - endT) * SR; k++) {
  const t = k / SR;
  const p = k / ((DUR - endT) * SR);
  const white = rnd() * 2 - 1;
  const f = 180 + 900 * p * p;
  add(endT + t, (white * 0.10 * p * p + Math.sin(2 * Math.PI * f * t) * 0.05 * p) * (1 - p * 0.2));
}
pad(endT, [45, 57, 60, 64, 69], DUR - endT, 0.06);

/* ---------- 母带：淡入淡出 + 归一 ---------- */
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = peak > 0 ? 0.89 / peak : 1;

const fadeIn = Math.floor(0.08 * SR);
const fadeOut = Math.floor(1.2 * SR);
const out = Buffer.alloc(44 + N * 4);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > N - fadeOut) g *= Math.max(0, (N - i) / fadeOut);
  // 轻微软削波，避免刺耳
  const sh = (x) => Math.tanh(x * 1.15) / Math.tanh(1.15);
  const l = Math.round(clamp(sh(L[i] * norm * g), -1, 1) * 32767);
  const r = Math.round(clamp(sh(R[i] * norm * g), -1, 1) * 32767);
  out.writeInt16LE(l, 44 + i * 4);
  out.writeInt16LE(r, 44 + i * 4 + 2);
}

// WAV 头
out.write('RIFF', 0);
out.writeUInt32LE(36 + N * 4, 4);
out.write('WAVE', 8);
out.write('fmt ', 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);        // PCM
out.writeUInt16LE(2, 22);        // 立体声
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36);
out.writeUInt32LE(N * 4, 40);

const outPath = path.resolve(opt.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(`配乐完成: ${outPath}  (${DUR}s, ${BPM}bpm, peak ${peak.toFixed(3)})`);
