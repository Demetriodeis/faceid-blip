'use strict';

// Gerador pseudo-aleatório determinístico (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Descritor sintético de 128 valores (~ amplitude parecida com a do face-api). */
function fakeFace(seed) {
  const r = rng(seed);
  return Array.from({ length: 128 }, () => (r() - 0.5) * 0.2);
}

/** Mesma "pessoa" com ruído pequeno (outra captura). */
function noisy(desc, seed, amount = 0.01) {
  const r = rng(seed);
  return desc.map((v) => v + (r() - 0.5) * amount);
}

module.exports = { fakeFace, noisy };
