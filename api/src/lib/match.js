'use strict';

const DESCRIPTOR_SIZE = 128;

function isDescriptor(v) {
  return (
    Array.isArray(v) &&
    v.length === DESCRIPTOR_SIZE &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < DESCRIPTOR_SIZE; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Média de várias capturas do mesmo rosto (reduz ruído de pose/luz). */
function averageDescriptors(list) {
  const out = new Array(DESCRIPTOR_SIZE).fill(0);
  for (const d of list) {
    for (let i = 0; i < DESCRIPTOR_SIZE; i++) out[i] += d[i];
  }
  return out.map((v) => Number((v / list.length).toFixed(5)));
}

/**
 * Procura o rosto mais próximo na base.
 * Retorna { match, person, distance } — `distance` é a menor encontrada
 * (mesmo quando não há match), útil para calibrar o limiar.
 */
function findBestMatch(descriptor, people, threshold) {
  let best = null;
  let bestDistance = Infinity;
  for (const person of people) {
    if (!isDescriptor(person.descriptor)) continue;
    const d = euclidean(descriptor, person.descriptor);
    if (d < bestDistance) {
      bestDistance = d;
      best = person;
    }
  }
  if (best && bestDistance < threshold) {
    return { match: true, person: best, distance: bestDistance };
  }
  return {
    match: false,
    person: null,
    distance: Number.isFinite(bestDistance) ? bestDistance : null,
  };
}

module.exports = { DESCRIPTOR_SIZE, isDescriptor, euclidean, averageDescriptors, findBestMatch };
