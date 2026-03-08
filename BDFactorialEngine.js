/**
 * BDFactorialEngine — B×D factorial.
 * Fixed T=4, S=1.0. 9 cells drawn in shuffle blocks without replacement.
 * Separates survival-only vs engagement-cliff hypotheses.
 * Key cell: B=30, D=0.5s — survival predicts 0.93, cliff predicts 0.13.
 */

const PAIRS = [
  { B:  9, D: 0.5 }, { B:  9, D: 1.0 }, { B:  9, D: 3.0 },
  { B: 20, D: 0.5 }, { B: 20, D: 1.0 }, { B: 20, D: 3.0 },
  { B: 30, D: 0.5 }, { B: 30, D: 1.0 }, { B: 30, D: 3.0 },
];
const T = 4, S = 1.0;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class BDFactorialEngine {
  constructor() { this._queue = []; }

  reset() { this._queue = []; }

  nextSpec(numMasters) {
    if (this._queue.length === 0) this._queue = shuffle([...PAIRS]);
    const { B, D } = this._queue.shift();
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
      staircaseType: 'bd_factorial',
      targetLoad:   B,
      staircaseLoad: B,
    };
  }

  update(_correct) {}  // non-adaptive

  get label() { return 'Engagement Mapping — B×D factorial'; }

  get description() {
    const Bs = [...new Set(PAIRS.map(p => p.B))].join(', ');
    const Ds = [...new Set(PAIRS.map(p => p.D))].join(', ');
    return `B×D factorial — T=${T}, S=${S} fixed. `
         + `9 cells: B ∈ {${Bs}} × D ∈ {${Ds}}. `
         + `Key cell: B=30, D=0.5s — survival predicts 0.93, cliff predicts 0.13.`;
  }

  get pairs() { return PAIRS; }
}
