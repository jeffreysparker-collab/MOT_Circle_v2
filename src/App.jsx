import { useState, useEffect, useRef, useCallback } from 'react';
import {
  generateMasterScript, samplePosition, applyTransform,
  computeLoad, computeUnifiedLoad,
  ARENA_RADIUS, NUM_MASTERS,
  SIMULATION_HZ, TOTAL_FRAMES,
} from './PhysicsEngine';
import { StaircaseEngine }   from './engines/StaircaseEngine';
import { BLatinEngine }      from './engines/BLatinEngine';
import { BDFactorialEngine } from './engines/BDFactorialEngine';
import { PathRetestEngine }  from './engines/PathRetestEngine';
import {
  saveMasterScript, loadMasterScript, countMasterScripts,
  clearMasterScripts, saveTrialLog, getAllTrialLogs, clearTrialLogs,
} from './db';

// ── Constants ────────────────────────────────────────────────────────────────
const CANVAS_SIZE  = 800;
const CENTER       = CANVAS_SIZE / 2;
const CUE_DURATION = 2.0;
const MAX_MOVE_DUR = 37.0;
const BALL_R       = 18;
const FEEDBACK_MS  = 1500;
const RETEST_RATE  = 0.20;
const RETEST_BANK_MAX = 15;

const CLR = {
  bg: '#0d0d14', arena: '#13131f', border: '#2a2a4a',
  ball: '#4a9eff', target: '#ffcc00', selected: '#ff6b6b',
  correct: '#44ff88', text: '#e0e0f0', dim: '#666688',
  speed: '#ff9944', density: '#44ddff', duration: '#bb44ff',
};

// ── Engine registry ──────────────────────────────────────────────────────────
// Each engine: nextSpec(numMasters), update(correct), reset(),
//              get label(), get description()
const ENGINE_MODES = {
  b_latin:      () => new BLatinEngine(),
  bd_factorial: () => new BDFactorialEngine(),
  path_retest:  () => new PathRetestEngine(),
};

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,          setPhase]          = useState('setup');
  const [genProgress,    setGenProgress]    = useState(0);
  const [scriptCount,    setScriptCount]    = useState(0);
  const [trialCount,     setTrialCount]     = useState(0);
  const [trialResult,    setTrialResult]    = useState(null);
  const [expPhase,       setExpPhase]       = useState('idle');
  const [likertState,    setLikertState]    = useState(null); // {targets, ratings, currentIdx}
  const likertRatingsRef = useRef([]);       // accumulates ratings during probe
  const [logs,           setLogs]           = useState([]);
  const [summaries,      setSummaries]      = useState([]);
  const [selectionCount, setSelectionCount] = useState(0);
  const [canvasInfo, setCanvasInfo] = useState('');
  const [settings, setSettings] = useState({
    mode:                'off',
    staircaseRule:       '1up2down',
    initialLoad:         6,
    durationInitialLoad: 5.0,
  });

  // Canvas / loop refs
  const canvasRef     = useRef(null);
  const rafRef        = useRef(null);
  const loopGenRef    = useRef(0);
  const phaseStartRef = useRef(0);
  const trialRef      = useRef(null);
  const dataRef       = useRef(null);
  const expPhaseRef   = useRef('idle');
  const selectedRef   = useRef(new Set());
  const trialIdRef    = useRef(0);

  // Engine refs
  const modeRef       = useRef('off');
  const engineRef     = useRef(null);
  const staircasesRef = useRef([]);
  const activeIdxRef  = useRef(0);
  const retestBankRef = useRef([]);

  useEffect(() => { modeRef.current = settings.mode; }, [settings.mode]);
  useEffect(() => {
    const id = setInterval(() => {
      if (!canvasRef.current) return;
      const r = canvasRef.current.getBoundingClientRect();
      setCanvasInfo(`canvas:${Math.round(r.width)}x${Math.round(r.height)} win:${window.innerWidth}x${window.innerHeight}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    countMasterScripts().then(n => setScriptCount(n));
    getAllTrialLogs().then(rows => setLogs(rows));
  }, []);

  // ── Generate ─────────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setPhase('generating');
    setGenProgress(0);
    await clearMasterScripts();
    for (let id = 0; id < NUM_MASTERS; id++) {
      const data = await new Promise(resolve =>
        setTimeout(() => resolve(
          generateMasterScript(id, 180, (f, total) =>
            setGenProgress(Math.round(((id + f / total) / NUM_MASTERS) * 100))
          )
        ), 0)
      );
      await saveMasterScript(id, data);
    }
    setScriptCount(NUM_MASTERS);
    setGenProgress(100);
    setPhase('setup');
  }, []);

  // ── Draw ─────────────────────────────────────────────────────────────────────
  const drawFrame = useCallback((ctx, trial, ff, curPhase, elapsed, selected, glowFade = 1) => {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = CLR.arena;
    ctx.fill();
    ctx.strokeStyle = CLR.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();

    const pos = Array.from({ length: trial.numBalls }, (_, b) => {
      const p  = samplePosition(dataRef.current, b, ff, trial.isReversed);
      const tp = applyTransform(p.x, p.y, trial.rotation, trial.isMirrored);
      return { cx: CENTER + tp.x, cy: CENTER + tp.y };
    });

    const glowing = b => trial.targetIDs.includes(b) &&
      (curPhase === 'cue' || (curPhase === 'move' && glowFade > 0));

    // Pass 1 — non-glowing balls
    for (let b = 0; b < trial.numBalls; b++) {
      if (glowing(b)) continue;
      const { cx, cy } = pos[b];
      ctx.beginPath();
      ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2);
      ctx.shadowBlur = 0;
      if (curPhase === 'respond' && selected.has(b)) {
        ctx.fillStyle = CLR.selected;
        ctx.shadowColor = CLR.selected;
        ctx.shadowBlur = 12;
      } else {
        ctx.fillStyle = CLR.ball;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (curPhase === 'respond') {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${BALL_R}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b, cx, cy);
      }
    }

    // Pass 2 — glowing targets on top
    for (let b = 0; b < trial.numBalls; b++) {
      if (!glowing(b)) continue;
      const { cx, cy } = pos[b];
      const pulse = curPhase === 'cue' ? 0.5 + 0.5 * Math.sin(elapsed * Math.PI * 4) : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = CLR.target;
      ctx.shadowColor = CLR.target;
      ctx.shadowBlur = (8 + pulse * 14) * glowFade;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
    ctx.fillStyle = CLR.dim;
    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `#${trial.trialId}  T${trial.numTargets}/B${trial.numBalls}/S${trial.speed.toFixed(2)}/D${trial.moveDur.toFixed(1)}s  [${trial.staircaseType}]  ${curPhase}`,
      12, 18
    );
  }, []);

  // ── Render loop ──────────────────────────────────────────────────────────────
  const startRenderLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const myGen = ++loopGenRef.current;

    const tick = now => {
      if (loopGenRef.current !== myGen) return;
      const canvas = canvasRef.current;
      const trial  = trialRef.current;
      if (!canvas || !trial) {
        // canvas not mounted yet — keep waiting
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // First frame after canvas is ready — reset phase timer so elapsed starts from 0
      if (phaseStartRef.current === -1) {
        phaseStartRef.current = now;
      }
      const elapsed  = (now - phaseStartRef.current) / 1000;
      const curPhase = expPhaseRef.current;

      if (curPhase === 'cue' && elapsed >= CUE_DURATION) {
        expPhaseRef.current = 'move';
        setExpPhase('move');
        phaseStartRef.current = now;
        trialRef.current.frameAtMoveStart = trialRef.current.lastFrame ?? 0;
      } else if (curPhase === 'move' && elapsed >= trial.moveDur) {
        expPhaseRef.current = 'respond';
        setExpPhase('respond');
        phaseStartRef.current = now;
      }

      let ff;
      if (expPhaseRef.current === 'move') {
        ff = Math.min(
          (trialRef.current.frameAtMoveStart ?? 0) + elapsed * SIMULATION_HZ * trial.speed,
          TOTAL_FRAMES - 1
        );
        trialRef.current.lastFrame = ff;
      } else {
        ff = trialRef.current?.lastFrame ?? 0;
      }

      const glowFade = expPhaseRef.current === 'move'
        ? Math.max(0, 1 - elapsed / 0.4)
        : expPhaseRef.current === 'cue' ? 1 : 0;

      drawFrame(canvas.getContext('2d'), trial, ff, expPhaseRef.current, elapsed, selectedRef.current, glowFade);
      if (expPhaseRef.current !== 'respond')
        rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [drawFrame]);

  // ── New trial ────────────────────────────────────────────────────────────────
  const startNewTrial = useCallback(async () => {
    const mode = modeRef.current;
    const bank = retestBankRef.current;
    const isRetest = mode === 'off' && bank.length > 0 && Math.random() < RETEST_RATE;

    let spec;

    if (isRetest) {
      const src      = bank[Math.floor(Math.random() * bank.length)];
      const rotDelta = Math.PI / 2;
      spec = { ...src, rotation: src.rotation + rotDelta,
               _retestOfTrialId: src.trialId, _retestRotDelta: rotDelta,
               targetIDs: [...src.targetIDs] };
    } else if (mode === 'off') {
      activeIdxRef.current = Math.floor(Math.random() * staircasesRef.current.length);
      const sc     = staircasesRef.current[activeIdxRef.current];
      const params = sc.pickTrialParams();
      const load   = computeLoad(params.numTargets, params.speed, params.numBalls);
      const dur    = params.duration !== null
        ? Math.min(params.duration, MAX_MOVE_DUR / Math.max(params.speed, 0.1))
        : Math.min(Math.max(3.0 * Math.sqrt(5 / Math.max(load, 0.5)) * (0.8 + Math.random() * 0.4), 1.0),
                   MAX_MOVE_DUR / Math.max(params.speed, 0.1));
      spec = {
        masterID:     Math.floor(Math.random() * NUM_MASTERS),
        rotation:     Math.random() * Math.PI * 2,
        isMirrored:   Math.random() < 0.5,
        isReversed:   Math.random() < 0.5,
        numTargets:   params.numTargets,
        numBalls:     params.numBalls,
        targetIDs:    shuffle(Array.from({ length: params.numBalls }, (_, i) => i)).slice(0, params.numTargets),
        speed:        params.speed,
        moveDur:      dur,
        staircaseType: params.staircaseType,
        targetLoad:   params.targetLoad,
        staircaseLoad: params.staircaseLoad,
      };
    } else {
      spec = engineRef.current.nextSpec(NUM_MASTERS);
    }

    const data = await loadMasterScript(spec.masterID);
    if (!data) { alert('Master scripts missing — please regenerate.'); return; }
    dataRef.current = data;

    trialRef.current = {
      trialId: ++trialIdRef.current,
      ...spec,
      achievedLoad: computeLoad(spec.numTargets, spec.speed, spec.numBalls),
      unifiedLoad:  computeUnifiedLoad(spec.numTargets, spec.speed, spec.numBalls, spec.moveDur),
      isRetest,
      lastFrame: 0,
      frameAtMoveStart: 0,
    };

    selectedRef.current = new Set();
    setSelectionCount(0);
    setTrialResult(null);
    expPhaseRef.current = 'cue';
    setExpPhase('cue');
    phaseStartRef.current = -1; // will be set on first rendered frame
    startRenderLoop();
  }, [startRenderLoop]);

  // ── Start experiment ─────────────────────────────────────────────────────────
  const handleStartExperiment = useCallback(async () => {
    modeRef.current = settings.mode;
    retestBankRef.current = [];
    trialIdRef.current = 0;
    if (settings.mode === 'off') {
      staircasesRef.current = [
        new StaircaseEngine({ type: 'speed',    initialLoad: settings.initialLoad,         rule: settings.staircaseRule }),
        new StaircaseEngine({ type: 'density',  initialLoad: settings.initialLoad,         rule: settings.staircaseRule }),
        new StaircaseEngine({ type: 'duration', initialLoad: settings.durationInitialLoad, rule: settings.staircaseRule }),
      ];
      engineRef.current = null;
    } else {
      staircasesRef.current = [];
      engineRef.current = ENGINE_MODES[settings.mode]();
      engineRef.current.reset();
    }
    setSummaries([]);
    setTrialCount(0);
    setPhase('experiment');
    await startNewTrial();
  }, [settings, startNewTrial]);

  // ── Canvas interaction ───────────────────────────────────────────────────────
  const handleCanvasInteraction = useCallback((clientX, clientY) => {
    if (expPhaseRef.current !== 'respond') return;
    const trial  = trialRef.current;
    const canvas = canvasRef.current;
    if (!trial || !canvas) return;
    const rect  = canvas.getBoundingClientRect();
    const scale = CANVAS_SIZE / rect.width;
    const mx = (clientX - rect.left) * scale;
    const my = (clientY - rect.top)  * scale;
    const ff = trial.lastFrame ?? 0;
    const sel = new Set(selectedRef.current);
    for (let b = 0; b < trial.numBalls; b++) {
      const p  = samplePosition(dataRef.current, b, ff, trial.isReversed);
      const tp = applyTransform(p.x, p.y, trial.rotation, trial.isMirrored);
      if (Math.hypot(mx - (CENTER + tp.x), my - (CENTER + tp.y)) <= BALL_R * 1.4) {
        sel.has(b) ? sel.delete(b) : sel.add(b);
        selectedRef.current = sel;
        setSelectionCount(sel.size);
        drawFrame(canvas.getContext('2d'), trial, ff, 'respond', 0, sel);
        break;
      }
    }
  }, [drawFrame]);

  const handleCanvasClick = useCallback(e => handleCanvasInteraction(e.clientX, e.clientY), [handleCanvasInteraction]);
  const handleCanvasTouch = useCallback(e => {
    e.preventDefault();
    handleCanvasInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }, [handleCanvasInteraction]);

  // ── Save trial log (shared by submit and likert completion) ─────────────────
  const saveAndAdvance = useCallback(async (trial, selected, hits, rawScore, correct, likertRatings = null) => {
    const targets = trial.targetIDs;
    const logRow = {
      trial_id:              trial.trialId,
      timestamp:             new Date().toISOString(),
      staircase_type:        trial.staircaseType,
      master_id:             trial.masterID,
      rotation:              +(trial.rotation * 180 / Math.PI).toFixed(1),
      is_mirrored:           trial.isMirrored ? 1 : 0,
      is_reversed:           trial.isReversed ? 1 : 0,
      playback_speed:        +trial.speed.toFixed(4),
      num_targets:           trial.numTargets,
      num_balls:             trial.numBalls,
      move_dur:              +trial.moveDur.toFixed(4),
      target_load:           +trial.targetLoad.toFixed(4),
      achieved_load:         +trial.achievedLoad.toFixed(4),
      unified_load:          +trial.unifiedLoad.toFixed(4),
      staircase_load:        +trial.staircaseLoad.toFixed(4),
      target_ids:            targets.join(';'),
      selected_ids:          selected.join(';'),
      hits,
      raw_score:             +rawScore.toFixed(4),
      correct:               correct ? 1 : 0,
      is_retest:             trial.isRetest ? 1 : 0,
      retest_of_trial_id:    trial._retestOfTrialId ?? '',
      retest_rotation_delta: trial._retestRotDelta
                               ? +(trial._retestRotDelta * 180 / Math.PI).toFixed(1) : '',
      pr_transform_idx:      trial.prTransformIdx  ?? '',
      pr_base_rotation:      trial.prBaseRotation  ?? '',
      likert_trial:          trial.isLikertTrial ? 1 : 0,
      likert_ratings:        likertRatings ? likertRatings.join(';') : '',
    };
    await saveTrialLog(logRow);

    if (modeRef.current === 'off' && !trial.isRetest) {
      const bank = retestBankRef.current;
      bank.push({
        trialId: trial.trialId, masterID: trial.masterID,
        rotation: trial.rotation, isMirrored: trial.isMirrored,
        isReversed: trial.isReversed, numTargets: trial.numTargets,
        numBalls: trial.numBalls, targetIDs: trial.targetIDs,
        speed: trial.speed, moveDur: trial.moveDur,
        staircaseType: trial.staircaseType,
        targetLoad: trial.targetLoad, staircaseLoad: trial.staircaseLoad,
      });
      if (bank.length > RETEST_BANK_MAX) bank.shift();
    }

    const updatedLogs = await getAllTrialLogs();
    setLogs(updatedLogs);
    setTrialCount(t => t + 1);
    setTrialResult({ rawScore, correct, hits, total: targets.length });
    setSummaries(staircasesRef.current.map(s => s.summary()));
    expPhaseRef.current = 'feedback';
    setExpPhase('feedback');
    setTimeout(() => startNewTrial(), FEEDBACK_MS);
  }, [startNewTrial]);

  // ── Likert rating handler ────────────────────────────────────────────────────
  const handleLikertRating = useCallback(async (rating) => {
    const trial    = trialRef.current;
    const ls       = likertState;
    if (!ls) return;

    const newRatings = [...ls.ratings];
    newRatings[ls.currentIdx] = rating;
    const nextIdx = ls.currentIdx + 1;

    if (nextIdx >= ls.targets.length) {
      // All targets rated — save and advance
      setLikertState(null);
      await saveAndAdvance(
        trial, ls.selected, ls.hits, ls.rawScore, ls.correct,
        ls.targets.map((_, i) => newRatings[i])
      );
    } else {
      // Advance to next target
      setLikertState({ ...ls, ratings: newRatings, currentIdx: nextIdx });
    }
  }, [likertState, saveAndAdvance]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmitResponse = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const trial    = trialRef.current;
    const selected = [...selectedRef.current];
    const targets  = trial.targetIDs;
    const hits     = selected.filter(id => targets.includes(id)).length;
    const rawScore = hits / targets.length;
    const correct  = rawScore === 1.0;

    if (modeRef.current === 'off')
      staircasesRef.current[activeIdxRef.current].update(correct);
    else
      engineRef.current.update(correct);

    // Shuffle target order for Likert to avoid order bias
    const shuffledTargets = shuffle([...targets]);

    if (trial.isLikertTrial) {
      // Enter Likert phase — show per-target confidence probe
      expPhaseRef.current = 'likert';
      setExpPhase('likert');
      setLikertState({
        targets:    shuffledTargets,
        ratings:    new Array(shuffledTargets.length).fill(null),
        currentIdx: 0,
        selected,
        hits,
        rawScore,
        correct,
      });
    } else {
      await saveAndAdvance(trial, selected, hits, rawScore, correct, null);
    }
  }, [saveAndAdvance]);

  // ── Export ───────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const rows = await getAllTrialLogs();
    if (!rows.length) { alert('No data to export.'); return; }
    const cols = Object.keys(rows[0]);
    const csv  = [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n');
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `mot_results_${Date.now()}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: CLR.bg, color: CLR.text, fontFamily: 'monospace', padding: 20 }}>
      <h1 style={{ textAlign: 'center', color: CLR.target, letterSpacing: 3, marginBottom: 4, fontSize: 22 }}>
        MOT Research
      </h1>
      <p style={{ textAlign: 'center', color: CLR.dim, margin: '0 0 24px', fontSize: 13 }}>
        Multiple Object Tracking — Psychophysics Platform
      </p>

      {phase === 'setup' && (
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <Panel title="Stimulus Library">
            <Row label="Scripts in DB">{scriptCount} / {NUM_MASTERS}</Row>
            <div style={{ marginTop: 10 }}>
              <Btn onClick={handleGenerate} accent={scriptCount < NUM_MASTERS}>
                {scriptCount < NUM_MASTERS ? `Generate ${NUM_MASTERS} Master Scripts` : 'Regenerate Scripts'}
              </Btn>
            </div>
          </Panel>

          <Panel title="Experiment Mode">
            <label style={LS.lbl}>
              Mode
              <select value={settings.mode} style={LS.sel}
                onChange={e => setSettings(s => ({ ...s, mode: e.target.value }))}>
                <option value="off">Adaptive Staircase (threshold)</option>
                <option value="b_latin">Engagement Mapping — B latin square</option>
                <option value="bd_factorial">Engagement Mapping — B×D factorial</option>
                <option value="path_retest">Path Retest — 4 transforms × 5 durations</option>
              </select>
            </label>
            <ModeDescription mode={settings.mode} />
            {settings.mode === 'off' && (
              <>
                <label style={LS.lbl}>
                  Rule
                  <select value={settings.staircaseRule} style={LS.sel}
                    onChange={e => setSettings(s => ({ ...s, staircaseRule: e.target.value }))}>
                    <option value="1up2down">1-up / 2-down (~70.7%)</option>
                    <option value="1up3down">1-up / 3-down (~79.4%)</option>
                  </select>
                </label>
                <label style={LS.lbl}>
                  Initial Load (Speed / Density)
                  <input type="number" min={1} max={40} step={0.1} value={settings.initialLoad} style={LS.inp}
                    onChange={e => setSettings(s => ({ ...s, initialLoad: +e.target.value }))} />
                </label>
                <label style={LS.lbl}>
                  Initial Load (Duration, seconds)
                  <input type="number" min={1} max={30} step={0.1} value={settings.durationInitialLoad} style={LS.inp}
                    onChange={e => setSettings(s => ({ ...s, durationInitialLoad: +e.target.value }))} />
                </label>
              </>
            )}
          </Panel>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Btn onClick={handleStartExperiment} disabled={scriptCount < NUM_MASTERS} accent>
              Start Experiment
            </Btn>
            {logs.length > 0 && <>
              <Btn onClick={handleExport}>Export CSV ({logs.length} trials)</Btn>
              <Btn onClick={async () => { await clearTrialLogs(); setLogs([]); }}>Clear Logs</Btn>
            </>}
          </div>
        </div>
      )}

      {phase === 'generating' && (
        <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <div style={{ color: CLR.target, marginBottom: 14 }}>Generating Master Scripts…</div>
          <ProgressBar value={genProgress} />
          <div style={{ color: CLR.dim, fontSize: 12, marginTop: 8 }}>{genProgress}%</div>
        </div>
      )}

      {phase === 'experiment' && (
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE}
              onClick={handleCanvasClick}
              onTouchEnd={handleCanvasTouch}
              style={{
                display: 'block', maxWidth: '100%', borderRadius: '50%',
                cursor: expPhase === 'respond' ? 'crosshair' : 'default',
                border: `2px solid ${CLR.border}`, touchAction: 'none',
              }}
            />
            <div style={{ minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
              {expPhase === 'feedback' && trialResult && <FeedbackBadge result={trialResult} />}
              {expPhase === 'likert'   && likertState  && (
                <LikertBadge
                  ballId={likertState.targets[likertState.currentIdx]}
                  currentIdx={likertState.currentIdx}
                  total={likertState.targets.length}
                />
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 4 }}>
              {expPhase === 'respond' && (
                <Btn
                  onClick={handleSubmitResponse}
                  accent={selectionCount === trialRef.current?.numTargets}
                  disabled={selectionCount !== trialRef.current?.numTargets}
                >
                  Submit ({selectionCount} / {trialRef.current?.numTargets})
                </Btn>
              )}
              {expPhase === 'likert' && likertState && (
                <LikertButtons onRate={handleLikertRating} />
              )}
              <Btn onClick={async () => {
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                setLogs(await getAllTrialLogs());
                setPhase('setup');
              }}>End Session</Btn>
            </div>
          </div>

          <Sidebar
            trialCount={trialCount}
            summaries={summaries}
            expPhase={expPhase}
            numTargets={trialRef.current?.numTargets}
            selectionCount={selectionCount}
          />
        </div>
      )}
      {canvasInfo && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, background: 'rgba(0,0,0,0.85)', color: '#0f0', fontSize: 13, padding: '4px 8px', zIndex: 9999, fontFamily: 'monospace' }}>
          {canvasInfo}
        </div>
      )}
    </div>
  );
}

// ── Mode description ─────────────────────────────────────────────────────────
function ModeDescription({ mode }) {
  if (mode === 'off') {
    return (
      <Callout>
        Three interleaved staircases:&nbsp;
        <span style={{ color: '#ff9944' }}>■ Speed</span>&nbsp;
        <span style={{ color: '#44ddff' }}>■ Density</span>&nbsp;
        <span style={{ color: '#bb44ff' }}>■ Duration</span>
      </Callout>
    );
  }
  return <Callout>{ENGINE_MODES[mode]().description}</Callout>;
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ trialCount, summaries, expPhase, numTargets, selectionCount }) {
  return (
    <div style={{ minWidth: 240, background: '#11111e', borderRadius: 8, padding: 18, fontSize: 13 }}>
      <div style={{ color: '#ffcc00', fontWeight: 'bold', marginBottom: 12 }}>Session</div>
      <Row label="Trial">{trialCount}</Row>
      {summaries.map(s => (
        <div key={s.type} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1a1a2e' }}>
          <div style={{
            color: s.type === 'speed' ? '#ff9944' : s.type === 'density' ? '#44ddff' : '#bb44ff',
            fontWeight: 'bold', marginBottom: 4, fontSize: 11,
          }}>{s.type.toUpperCase()} STAIRCASE</div>
          <Row label={s.type === 'duration' ? 'Duration' : 'Load'}>
            {s.type === 'duration' ? `${s.currentLoad}s` : s.currentLoad}
          </Row>
          <Row label="Threshold">
            {s.reversals >= 2 ? (s.type === 'duration' ? `${s.threshold}s` : s.threshold) : '—'}
          </Row>
          <Row label="Reversals">{s.reversals}</Row>
          <Row label="Trials">{s.trials}</Row>
        </div>
      ))}
      <div style={{ marginTop: 16, borderTop: '1px solid #222', paddingTop: 12 }}>
        {expPhase === 'cue'     && <Hint>Memorise the glowing balls!</Hint>}
        {expPhase === 'move'    && <Hint>Track the targets…</Hint>}
        {expPhase === 'respond' && <Hint>Select {numTargets} balls — {selectionCount} chosen</Hint>}
        {expPhase === 'likert'  && <Hint>Rate your confidence for each target</Hint>}
      </div>
    </div>
  );
}

// ── UI primitives ────────────────────────────────────────────────────────────
const LS = {
  lbl: { display: 'block', marginBottom: 10, fontSize: 13, color: '#e0e0f0' },
  sel: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace', marginLeft: 12 },
  inp: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace', width: 70, marginLeft: 12 },
};

function Panel({ title, children }) {
  return (
    <div style={{ background: '#11111e', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ color: '#4a9eff', fontWeight: 'bold', marginBottom: 10, fontSize: 12, letterSpacing: 1 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
      <span style={{ color: '#666688' }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Btn({ children, onClick, accent, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 18px', borderRadius: 6, border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? '#2a2a2a' : accent ? '#4a9eff' : '#2a2a4a',
      color: disabled ? '#555' : '#fff',
      fontFamily: 'monospace', fontSize: 13,
    }}>{children}</button>
  );
}

function Hint({ children }) {
  return (
    <div style={{
      padding: '8px 10px', background: '#1a1a2e', borderRadius: 6,
      borderLeft: '3px solid #4a9eff', color: '#c0c0e0', fontSize: 12,
    }}>{children}</div>
  );
}

function Callout({ children }) {
  return (
    <div style={{
      margin: '8px 0', padding: '8px 10px', background: '#0d0d20',
      borderRadius: 6, border: '1px solid #2a2a4a',
      color: '#666688', fontSize: 12, lineHeight: 1.6,
    }}>{children}</div>
  );
}

function ProgressBar({ value }) {
  return (
    <div style={{ background: '#222', borderRadius: 6, height: 12, overflow: 'hidden' }}>
      <div style={{ background: '#4a9eff', width: `${value}%`, height: '100%', transition: 'width 0.3s' }} />
    </div>
  );
}

function LikertBadge({ ballId, currentIdx, total }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color: '#ffcc00', fontSize: 15, fontWeight: 'bold' }}>
        Ball {ballId}
      </span>
      <span style={{ color: '#666688', fontSize: 12 }}>
        {currentIdx + 1} / {total} — how confident?
      </span>
    </div>
  );
}

const LIKERT_LABELS = [
  { value: 1, label: 'Lost',        color: '#ff4444' },
  { value: 2, label: 'Unsure',      color: '#ff9944' },
  { value: 3, label: 'Fairly sure', color: '#44aaff' },
  { value: 4, label: 'Certain',     color: '#44ff88' },
];

function LikertButtons({ onRate }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {LIKERT_LABELS.map(({ value, label, color }) => (
        <button key={value} onClick={() => onRate(value)} style={{
          padding: '10px 14px', borderRadius: 8, border: `2px solid ${color}`,
          background: 'transparent', color, fontFamily: 'monospace',
          fontSize: 13, cursor: 'pointer', fontWeight: 'bold',
          minWidth: 72, touchAction: 'manipulation',
        }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function FeedbackBadge({ result }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        color: result.correct ? '#44ff88' : '#ff6b6b',
        fontSize: 22, fontWeight: 'bold', letterSpacing: 1,
      }}>
        {result.correct ? '✓ Correct' : '✗ Missed'}
      </span>
      <span style={{ color: '#666688', fontSize: 13 }}>{result.hits} / {result.total}</span>
    </div>
  );
}
