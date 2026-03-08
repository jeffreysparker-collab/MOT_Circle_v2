/**
 * PathRetestEngine — 4 transforms × 4 durations per master block, interleaved.
 *
 * Maintains a pool of POOL_SIZE active master blocks simultaneously.
 * Each trial, one block is picked at random from the pool and its next
 * spec is returned. When a block exhausts all 16 trials it is replaced
 * by a new master (drawn without replacement from the shuffle cycle).
 *
 * This means trials from different masters are interleaved throughout
 * the session — you never see 16 consecutive trials from the same master.
 *
 * The four transforms form the Klein four-group (Z₂×Z₂):
 *   T0: identity              (rotOffset=0,   mirror=false)
 *   T1: rotate 180°           (rotOffset=π,   mirror=false)
 *   T2: mirror                (rotOffset=0,   mirror=true)
 *   T3: rotate 180° + mirror  (rotOffset=π,   mirror=true)
 *
 * Transform order randomised per block.
 * Duration order randomised independently per transform.
 * Masters drawn without replacement across blocks.
 *
 * CSV fields: pr_transform_idx (0–3), pr_base_rotation (always 0)
 * Analysis: group by (master_id, target_ids) → 4×4 matrix
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
const POOL_SIZE = 3;  // active master blocks interleaved simultaneously

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBlock(masterID) {
  const targetIDs = shuffle(Array.from({ length: B }, (_, i) => i)).slice(0, T);
  const specs = [];
  for (const ti of shuffle([0, 1, 2, 3])) {
    const { rotOffset, isMirrored } = TRANSFORMS[ti];
    for (const moveDur of shuffle([...DURATIONS])) {
      specs.push({
        masterID,
        rotation:       rotOffset,
        isMirrored,
        isReversed:     Math.random() < 0.5,  // randomised per spec, not per block
        numTargets:     T,
        numBalls:       B,
        targetIDs:      [...targetIDs],
        speed:          S,
        moveDur,
        staircaseType:  'path_retest',
        targetLoad:     B,
        staircaseLoad:  B,
        prTransformIdx: ti,
        prBaseRotation: 0,
      });
    }
  }
  return specs;
}

export class PathRetestEngine {
  constructor() {
    this._masterQueue = [];
    this._pool        = [];
  }

  reset() {
    this._masterQueue = [];
    this._pool        = [];
  }

  _nextMasterID(numMasters) {
    if (this._masterQueue.length === 0)
      this._masterQueue = shuffle(Array.from({ length: numMasters }, (_, i) => i));
    return this._masterQueue.shift();
  }

  nextSpec(numMasters) {
    // Fill pool to POOL_SIZE on first call or after reset
    while (this._pool.length < POOL_SIZE)
      this._pool.push(buildBlock(this._nextMasterID(numMasters)));

    // Pick a random active block, take its next spec
    const idx  = Math.floor(Math.random() * this._pool.length);
    const spec = this._pool[idx].shift();

    // Replace exhausted block with a fresh one
    if (this._pool[idx].length === 0)
      this._pool[idx] = buildBlock(this._nextMasterID(numMasters));

    return spec;
  }

  update(_correct) {}

  get label() { return 'Path Retest — 4 transforms × 4 durations (interleaved)'; }

  get description() {
    return `Path retest — B=${B}, T=${T}, S=${S} fixed. `
         + `${POOL_SIZE} master blocks active simultaneously, trials interleaved. `
         + `Each block: 4 transforms × 4 durations = 16 trials. `
         + `Rotations always 0° or 180°. Masters drawn without replacement.`;
  }

  get config() { return { B, T, S, DURATIONS, TRANSFORMS, POOL_SIZE }; }
}
