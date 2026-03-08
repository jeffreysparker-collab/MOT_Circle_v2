/**
 * PathRetestEngine — 4 transforms × 4 durations per master block.
 *
 * Each master block:
 *   - One master drawn without replacement (shuffle cycle across all masters)
 *   - One random base rotation, one random target selection
 *   - 4 symmetric transforms × 4 durations = 16 trials
 *
 * The four transforms form the Klein four-group (Z₂×Z₂):
 *   T0: identity              (rotOffset=0,   mirror=false)
 *   T1: rotate 180°           (rotOffset=π,   mirror=false)
 *   T2: mirror                (rotOffset=0,   mirror=true)
 *   T3: rotate 180° + mirror  (rotOffset=π,   mirror=true)
 *
 * 180° rotation and mirror through a central axis both have order 2
 * and commute (180° rotation is a point reflection through the centre,
 * which commutes with any line reflection through the same centre).
 * This guarantees the group is abelian: Z₂×Z₂.
 *
 * All four transforms preserve inter-ball distances and the Bouma
 * crowding ellipse (radially symmetric around fixation at arena centre).
 *
 * Transform order is randomised per block.
 * Duration order is randomised independently per transform.
 * Masters are drawn without replacement across blocks.
 *
 * CSV fields logged: pr_transform_idx (0–3), pr_base_rotation (degrees)
 * Analysis: group by (master_id, pr_base_rotation) → 4×4 matrix
 */

const B          = 20;
const T          = 4;
const S          = 1.0;
const DURATIONS  = [3.0, 2.0, 1.0, 0.5];
const TRANSFORMS = [
  { rotOffset: 0,       isMirrored: false },  // T0: identity
  { rotOffset: Math.PI, isMirrored: false },  // T1: rotate 180°
  { rotOffset: 0,       isMirrored: true  },  // T2: mirror
  { rotOffset: Math.PI, isMirrored: true  },  // T3: rotate 180° + mirror
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class PathRetestEngine {
  constructor() {
    this._masterQueue = [];  // shuffle-cycle, no replacement within cycle
    this._trialQueue  = [];  // 16-trial block queue
  }

  reset() {
    this._masterQueue = [];
    this._trialQueue  = [];
  }

  nextSpec(numMasters) {
    if (this._trialQueue.length > 0) return this._trialQueue.shift();

    // Refill master queue when exhausted (all masters seen before any repeat)
    if (this._masterQueue.length === 0)
      this._masterQueue = shuffle(Array.from({ length: numMasters }, (_, i) => i));

    const masterID   = this._masterQueue.shift();
    const baseRot    = Math.random() * Math.PI * 2;
    const isReversed = Math.random() < 0.5;
    const targetIDs  = shuffle(Array.from({ length: B }, (_, i) => i)).slice(0, T);

    // Build 16 specs: randomise transform order, randomise duration order per transform
    const specs = [];
    for (const ti of shuffle([0, 1, 2, 3])) {
      const { rotOffset, isMirrored } = TRANSFORMS[ti];
      for (const moveDur of shuffle([...DURATIONS])) {
        specs.push({
          masterID,
          rotation:       baseRot + rotOffset,
          isMirrored,
          isReversed,
          numTargets:     T,
          numBalls:       B,
          targetIDs:      [...targetIDs],
          speed:          S,
          moveDur,
          staircaseType:  'path_retest',
          targetLoad:     B,
          staircaseLoad:  B,
          // path_retest specific — logged to CSV
          prTransformIdx: ti,
          prBaseRotation: +(baseRot * 180 / Math.PI).toFixed(1),
        });
      }
    }

    this._trialQueue = specs;
    return this._trialQueue.shift();
  }

  update(_correct) {}  // non-adaptive

  get label() { return 'Path Retest — 4 transforms × 4 durations'; }

  get description() {
    return `Path retest — B=${B}, T=${T}, S=${S} fixed. `
         + `Each master block: same targets, 4 transforms × 4 durations = 16 trials. `
         + `Transforms: 0°, 180°, mirror, 180°+mirror (Klein four-group — preserves crowding geometry). `
         + `Durations: ${DURATIONS.join('s, ')}s. `
         + `Masters drawn without replacement. `
         + `Identifies when slot corruption occurs within a fixed path.`;
  }

  get config() { return { B, T, S, DURATIONS, TRANSFORMS }; }
}
