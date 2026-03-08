/**
 * BLatinEngine — B-only latin square.
 * Fixed T=4, S=1.0, D=3s. Cycles B in shuffle blocks without replacement.
 * Maps P(correct | B) — estimates engagement cliff shape.
 */

const B_LEVELS = [9, 13, 17, 20, 25, 30];
const T = 4, S = 1.0, D = 3.0;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class BLatinEngine {
  constructor() { this._queue = []; }

  reset() { this._queue = []; }

  nextSpec(numMasters) {
    if (this._queue.length === 0) this._queue = shuffle([...B_LEVELS]);
    const B = this._queue.shift();
    return {
      masterID:     Math.floor(Math.random() * numMasters),
      rotation:     Math.random() * Math.PI * 2,
      isMirrored:   Math.random() < 0.5,
      isReversed:   Math.random() < 0.5,
      numTargets:   T,
      numBalls:     B,
      targetIDs:    shuffle(Array.from({ length: B }, (_, i) => i)).slice(0, T),
      speed:        S,
      moveDur:      D,
      staircaseType: 'b_latin',
      targetLoad:   B,
      staircaseLoad: B,
    };
  }

  update(_correct) {}  // non-adaptive

  get label() { return 'Engagement Mapping — B latin square'; }

  get description() {
    return `B latin square — T=${T}, S=${S}, D=${D}s fixed. `
         + `Cycles B ∈ {${B_LEVELS.join(', ')}} in random blocks. `
         + `Maps P(correct|B).`;
  }
}
