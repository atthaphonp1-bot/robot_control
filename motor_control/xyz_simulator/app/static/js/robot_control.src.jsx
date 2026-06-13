const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ============================================
   Robot model — internal units are PULSE
   X = across the bridge (left-right).        Home = 0 = LEFTMOST
   Y = along long rails (in-out, depth).      Home = 0 = OUT (front, near viewer)
   Z = vertical.                              Home = 0 = UP (retracted)
   G = gripper (opens along X direction).     Home = 0 = CLOSED
   ============================================ */
// Stroke ranges sourced from db/csos_beta_robot_static.db · motor table:
//   X (Bridge,    csos_motor_x) : stroke_max 116,000  (axis_no 2)
//   Y (Long rail, csos_motor_y) : stroke_max  50,000  (axis_no 1)
//   Z (Vertical,  csos_updown)  : stroke_max  26,000  (axis_no 3)
//   G (Gripper,   csos_gripper) : stroke_max   7,000  (axis_no 4)
// Stroke ranges default to the values above, but are overridden per-axis by the
// live DB data the server injects (window.SERVER_AXES) when present.
const RANGE = (function () {
  const base = {
    X: { min: 0, max: 116000, home: 0, label: 'Bridge'      },
    Y: { min: 0, max:  50000, home: 0, label: 'Long rail'   },
    Z: { min: 0, max:  26000, home: 0, label: 'Vertical'    },
    G: { min: 0, max:   7000, home: 0, label: 'Gripper'     },
  };
  const src = (window.SERVER_AXES && typeof window.SERVER_AXES === 'object') ? window.SERVER_AXES : {};
  Object.keys(base).forEach(a => {
    const row = src[a];
    if (!row) return;
    if (row.stroke_max !== null && row.stroke_max !== undefined) base[a].max = row.stroke_max;
    if (row.stroke_min !== null && row.stroke_min !== undefined) base[a].min = row.stroke_min;
  });
  return base;
})();
const AXES = ['X','Y','Z','G'];

/* ============================================
   3D camera — right-handed orbit projection (SolidWorks-style).
      az  yaw   (rotation around world +Z)
      el  pitch (camera elevation above horizon)
   Replaces the old fixed cabinet iso — used inside RobotSvg via project(x,y,z).
   World axes (operator's frame):
      +X →  RIGHT  (left-right along the bridge)         · Home X=0 at LEFT
      +Y →  IN     (away from viewer, deeper into machine) · Home Y=0 at OUT/FRONT
      +Z →  UP     (vertical)                             · Home Z=0 at UP / retracted
      +G →  CLOSE  (fingers squeeze together)             · Home G=0 at fully OPEN
   ============================================ */
function makeProjector(view) {
  const ca = Math.cos(view.az), sa = Math.sin(view.az);
  const ce = Math.cos(view.el), se = Math.sin(view.el);
  // camera-right  = ( ca,  sa, 0)
  // camera-up     = (-sa*se,  ca*se,  ce)
  // camera-forward (into scene) = (-ca*?, ...). We only need to know which side of
  // each axis-aligned plane the camera is on; that's the sign of look·axis:
  const look = [-ce*sa,  ce*ca, -se];   // direction from camera toward origin
  const project = (x, y, z) => [
     x*ca + y*sa,
    -(-x*sa*se + y*ca*se + z*ce),
  ];
  return { project, look };
}
const VIEW_PRESETS = {
  iso:   { az:  35 * Math.PI/180, el:  25 * Math.PI/180 },
  top:   { az:   0,               el:  Math.PI/2 - 0.001 },
  front: { az:   0,               el:   2 * Math.PI/180 },
  right: { az:  Math.PI/2,        el:   2 * Math.PI/180 },
  back:  { az:  Math.PI,          el:   2 * Math.PI/180 },
};
// Draw scale per axis (pulse → SVG draw units, where 1 draw unit ≈ 1 mm).
// Physical workspace stays roughly 400 × 500 × 90 mm; pulse counts come
// from the DB so the SCALE adjusts to match.
//   X (Bridge, W)    : 116000 pulse → 400 mm
//   Y (Long rail, D) :  50000 pulse → 500 mm
//   Z (Vertical, H)  :  26000 pulse →  90 mm
//   G (Gripper)      :   7000 pulse →  ~9 mm per side
// Derive draw scale from the (possibly DB-driven) stroke ranges so the 3D view
// stays proportional to the configured physical workspace.
const SCALE = { X: 400/RANGE.X.max, Y: 500/RANGE.Y.max, Z: 90/RANGE.Z.max, G: 9/RANGE.G.max };

/* ============================================
   App
   ============================================ */
function App() {
  // `pos` = last known/reported position (PULSE) — drives the UI (3D view,
  // meters, readouts). Like the real controller, this is NOT pushed live; it
  // only changes via Get Position / Get All (or a direct drag on the 3D view).
  const [pos, setPos] = useState({ X: RANGE.X.home, Y: RANGE.Y.home, Z: RANGE.Z.home, G: RANGE.G.home });
  const [tgt, setTgt] = useState({ X: RANGE.X.home, Y: RANGE.Y.home, Z: RANGE.Z.home, G: RANGE.G.home });
  // The robot's actual simulated position, animating toward `tgt` in the
  // background. Get Position / Get All sample this into `pos`.
  const simPosRef = useRef({ X: RANGE.X.home, Y: RANGE.Y.home, Z: RANGE.Z.home, G: RANGE.G.home });
  // Timestamp of the last successful position read, per axis (null = never read).
  const [lastRead, setLastRead] = useState({ X: null, Y: null, Z: null, G: null });
  const [activeAxis, setActiveAxis] = useState('X');
  const [moving, setMoving] = useState(false);
  // Per-axis draft input value for the inline target editor.
  // Bound to the input element; commits to `tgt` on Enter / blur / +-/ explicit Move.
  const [draft, setDraft] = useState({ X: RANGE.X.home, Y: RANGE.Y.home, Z: RANGE.Z.home, G: RANGE.G.home });
  // Per-axis motor enable state (UI-local; in real integration this would
  // round-trip through API/MQTT).
  const [motorEnabled, setMotorEnabled] = useState({ X: false, Y: false, Z: false, G: false });
  // Sequence Move: ordered list of {id, motor, pulse, speed, acc}. Persisted in localStorage.
  const SEQ_KEY = 'robot-sequence';
  const [sequence, setSequence] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SEQ_KEY) || '[]');
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return [
      { id: 1, motor: 'X', pulse: 10000, speed: 8000, acc: 200 },
      { id: 2, motor: 'Y', pulse: 5000,  speed: 8000, acc: 200 },
    ];
  });
  const [activeStepId, setActiveStepId] = useState(null);
  const [seqRunning, setSeqRunning] = useState(false);
  useEffect(() => { localStorage.setItem(SEQ_KEY, JSON.stringify(sequence)); }, [sequence]);
  const draggingRef = useRef(false);
  // 3D view (orbit/pan/zoom around the gantry)
  const [view, setView] = useState(() => ({ ...VIEW_PRESETS.iso, zoom: 1, panX: 0, panY: 0, follow: false }));
  const goPreset = (k) => {
    if (k === 'follow') {
      // Toggle follow mode on/off, keep current orientation. When turning ON,
      // zoom in so the gripper is comfortable to see.
      setView(v => ({ ...v, follow: !v.follow, panX: 0, panY: 0, zoom: v.follow ? 1 : 2.4 }));
      return;
    }
    setView(v => ({ ...VIEW_PRESETS[k], zoom: 1, panX: 0, panY: 0, follow: false }));
  };

  // Settings
  const [conn, setConn] = useState({
    apiUrl: 'http://192.168.1.42:8080/api/v1',
    mqttHost: '192.168.1.42',
    mqttPort: 1883,
    mqttTopic: 'robot/gantry-01',
    mqttUser: 'operator',
  });
  // Motor profile — speed/accel in <unit>/s and <unit>/s²
  const [motor, setMotor] = useState({
    speed: 8000,    // pulse/s
    accel: 40000,   // pulse/s²
    unit: 'Pulse',  // 'Pulse' | 'µm'
  });

  const [connected, setConnected] = useState({ api: true, mqtt: true });

  // Log
  const [log, setLog] = useState(() => seedLog());
  const [logFilter, setLogFilter] = useState('all');
  const logRef = useRef(null);
  const pushLog = useCallback((entry) => {
    setLog(l => [...l.slice(-200), { t: nowStamp(), ...entry }]);
  }, []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Animate the robot's actual position toward `tgt` in the background
  // (jog/goto/home). Drives `simPosRef` (sampled by Get Position / Get All)
  // and the `moving` status — does NOT touch `pos`, since the real
  // controller doesn't report position in real time either.
  useEffect(() => {
    if (draggingRef.current) return;       // never animate while dragging
    const diff = AXES.some(a => Math.abs(simPosRef.current[a] - tgt[a]) > 1);
    if (!diff) { if (moving) setMoving(false); return; }
    setMoving(true);
    let raf;
    const start = { ...simPosRef.current };
    const t0 = performance.now();
    const dist = Math.max(...AXES.map(a => Math.abs(tgt[a] - start[a])));
    const dur = Math.max(220, (dist / motor.speed) * 1000);
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = easeInOut(k);
      simPosRef.current = {
        X: start.X + (tgt.X - start.X) * e,
        Y: start.Y + (tgt.Y - start.Y) * e,
        Z: start.Z + (tgt.Z - start.Z) * e,
        G: start.G + (tgt.G - start.G) * e,
      };
      if (k < 1) raf = requestAnimationFrame(tick);
      else { simPosRef.current = { ...tgt }; setMoving(false); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [tgt.X, tgt.Y, tgt.Z, tgt.G]);

  // Sync the inline target editor with `tgt` whenever it changes externally
  // (jog, home, drag, sync-from-current, etc.) so the input never falls behind.
  useEffect(() => { setDraft({X:tgt.X, Y:tgt.Y, Z:tgt.Z, G:tgt.G}); }, [tgt.X, tgt.Y, tgt.Z, tgt.G]);

  // Jog (per-axis step from window.AXIS_PARAMS — set via the inline Step input in each card)
  const jog = useCallback((axis, dir) => {
    const r = RANGE[axis];
    const axisStep = (window.AXIS_PARAMS?.[axis]?.step) || 1;
    const next = clamp((tgt[axis] ?? pos[axis]) + dir * axisStep, r.min, r.max);
    if (next === tgt[axis]) return;
    setTgt(t => ({ ...t, [axis]: next }));
    pushLog({
      kind: 'mqtt', dir: 'PUB', target: conn.mqttTopic + '/cmd/jog',
      msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span>, <span className="k">"delta"</span>:<span className="n">{dir*axisStep}</span>, <span className="k">"unit"</span>:<span className="s">"{motor.unit}"</span>, <span className="k">"v"</span>:<span className="n">{motor.speed}</span>, <span className="k">"a"</span>:<span className="n">{motor.accel}</span> {'}'}</>,
    });
  }, [tgt, pos, conn.mqttTopic, motor, pushLog]);

  // Drag (mouse on robot SVG)
  const onDragStart = useCallback((axis) => {
    draggingRef.current = true;
    setActiveAxis(axis);
    pushLog({ kind:'mqtt', dir:'PUB', target: conn.mqttTopic + '/cmd/jog/start',
      msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span>, <span className="k">"mode"</span>:<span className="s">"drag"</span> {'}'}</> });
  }, [conn.mqttTopic, pushLog]);

  const onDrag = useCallback((axis, value) => {
    const v = Math.round(clamp(value, RANGE[axis].min, RANGE[axis].max));
    simPosRef.current = { ...simPosRef.current, [axis]: v };
    setPos(p => ({ ...p, [axis]: v }));
    setTgt(t => ({ ...t, [axis]: v }));
  }, []);

  const onDragEnd = useCallback((axis, finalVal) => {
    draggingRef.current = false;
    pushLog({ kind:'evt', dir:'TX', target: conn.mqttTopic + '/state',
      msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span>, <span className="k">"pos"</span>:<span className="n">{Math.round(finalVal)}</span>, <span className="k">"unit"</span>:<span className="s">"{motor.unit}"</span> {'}'}</> });
  }, [conn.mqttTopic, motor.unit, pushLog]);

  // Keyboard jog
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const map = { ArrowUp:['Y',+1], ArrowDown:['Y',-1], ArrowLeft:['X',-1], ArrowRight:['X',+1], PageUp:['Z',+1], PageDown:['Z',-1] };
      const k = map[e.key];
      if (k) { e.preventDefault(); setActiveAxis(k[0]); jog(k[0], k[1]); return; }
      const A = e.key.toUpperCase();
      if (A === 'X' || A === 'Y' || A === 'Z' || A === 'G') setActiveAxis(A);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jog]);

  // Goto target (numeric)
  const gotoTarget = (nx) => {
    const safe = {};
    AXES.forEach(a => { safe[a] = Math.round(clamp(nx[a], RANGE[a].min, RANGE[a].max)); });
    setTgt(safe);
    pushLog({
      kind: 'api', dir: 'POST', target: conn.apiUrl + '/move',
      msg: <>{'{ '}<span className="k">"target"</span>:{'{ '}<span className="k">"x"</span>:<span className="n">{safe.X}</span>,<span className="k">"y"</span>:<span className="n">{safe.Y}</span>,<span className="k">"z"</span>:<span className="n">{safe.Z}</span>,<span className="k">"g"</span>:<span className="n">{safe.G}</span> {'}, '}<span className="k">"v"</span>:<span className="n">{motor.speed}</span>, <span className="k">"a"</span>:<span className="n">{motor.accel}</span>, <span className="k">"unit"</span>:<span className="s">"{motor.unit}"</span> {'}'}</>,
    });
  };

  // Home a single axis: send only that axis to its home position.
  const homeAxis = (axis) => {
    setTgt(t => ({ ...t, [axis]: RANGE[axis].home }));
    pushLog({ kind:'api', dir:'POST', target: conn.apiUrl + '/home',
      msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span> {'}'}</>});
  };

  // Move a single axis to its configured origin position
  // (window.AXIS_PARAMS[axis].origin_pos — set via the parameter editor).
  const originAxis = (axis) => {
    const r = RANGE[axis];
    const raw = (window.AXIS_PARAMS?.[axis]?.origin_pos) ?? r.home;
    const target = Math.round(clamp(raw, r.min, r.max));
    setTgt(t => ({ ...t, [axis]: target }));
    pushLog({ kind:'api', dir:'POST', target: conn.apiUrl + '/origin',
      msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span>, <span className="k">"pos"</span>:<span className="n">{target}</span> {'}'}</>});
  };

  // Toggle motor enable for a single axis (UI-local toggle for now).
  const toggleMotor = (axis) => {
    setMotorEnabled(s => {
      const next = { ...s, [axis]: !s[axis] };
      pushLog({ kind:'api', dir:'POST', target: conn.apiUrl + '/motor/enable',
        msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span>, <span className="k">"enabled"</span>:<span className="s">{String(next[axis])}</span> {'}'}</>});
      return next;
    });
  };

  // Read the robot's actual position. The real controller doesn't push
  // position updates, so `pos` only changes here — sampling the in-progress
  // simulated motion held in `simPosRef`.
  const getPosition = useCallback((axis) => {
    const val = Math.round(simPosRef.current[axis]);
    setPos(p => ({ ...p, [axis]: val }));
    setLastRead(r => ({ ...r, [axis]: nowStamp() }));
    pushLog({ kind:'api', dir:'GET', target: conn.apiUrl + '/position',
      msg: <>{'{ '}<span className="k">"axis"</span>:<span className="s">"{axis}"</span>, <span className="k">"pos"</span>:<span className="n">{val}</span>, <span className="k">"unit"</span>:<span className="s">"{motor.unit}"</span> {'}'}</>});
  }, [conn.apiUrl, motor.unit, pushLog]);

  const getAllPositions = useCallback(() => {
    const snap = {
      X: Math.round(simPosRef.current.X), Y: Math.round(simPosRef.current.Y),
      Z: Math.round(simPosRef.current.Z), G: Math.round(simPosRef.current.G),
    };
    setPos(snap);
    const stamp = nowStamp();
    setLastRead({ X: stamp, Y: stamp, Z: stamp, G: stamp });
    pushLog({ kind:'api', dir:'GET', target: conn.apiUrl + '/position',
      msg: <>{'{ '}<span className="k">"x"</span>:<span className="n">{snap.X}</span>, <span className="k">"y"</span>:<span className="n">{snap.Y}</span>, <span className="k">"z"</span>:<span className="n">{snap.Z}</span>, <span className="k">"g"</span>:<span className="n">{snap.G}</span>, <span className="k">"unit"</span>:<span className="s">"{motor.unit}"</span> {'}'}</>});
  }, [conn.apiUrl, motor.unit, pushLog]);

  // Generic move queue. Each item: { axis, target, label?, stepId? }.
  // Used by Home-all (G → Z → Y → X) and by Sequence Move.
  const moveQueueRef = useRef([]);
  const wasMovingRef = useRef(false);
  const seqRunningRef = useRef(false);

  // Pop the next move from the queue and dispatch it. If the next target
  // matches the robot's actual position (no-op), skip it and try the one
  // after, since otherwise the animation useEffect won't fire and the queue
  // stalls.
  const drainNext = () => {
    while (moveQueueRef.current.length > 0) {
      const next = moveQueueRef.current.shift();
      if (next.stepId != null) setActiveStepId(next.stepId);
      pushLog({ kind:'api', dir:'POST', target: conn.apiUrl + (next.label || '/move'),
        msg: <>{next.label || 'queue'}: <span className="s">"{next.axis}"</span> → <span className="n">{Math.round(next.target)}</span></>});
      const cur = simPosRef.current[next.axis];
      if (Math.abs(cur - next.target) > 1) {
        // Real move — kick the animation, then wait for `moving` to settle.
        setTgt(t => ({ ...t, [next.axis]: next.target }));
        return;
      }
      // No-op step: loop and try the next one immediately.
    }
    // Queue empty.
    if (seqRunningRef.current) {
      seqRunningRef.current = false;
      setSeqRunning(false);
      setActiveStepId(null);
      pushLog({ kind:'evt', dir:'EVT', target: '/sequence', msg: <>sequence complete</>});
    }
  };

  useEffect(() => {
    if (wasMovingRef.current && !moving) drainNext();
    wasMovingRef.current = moving;
    // eslint-disable-next-line
  }, [moving]);

  // Freeze the robot at its actual current (simulated) position — cancels any
  // pending target so the animation stops right where the robot is.
  const holdHere = () => {
    const here = {
      X: Math.round(simPosRef.current.X), Y: Math.round(simPosRef.current.Y),
      Z: Math.round(simPosRef.current.Z), G: Math.round(simPosRef.current.G),
    };
    simPosRef.current = here;
    setTgt(here);
  };

  const home = () => {
    pushLog({ kind:'api', dir:'POST', target: conn.apiUrl + '/home',
      msg: <>Home all · sequence G → Z → Y → X</>});
    moveQueueRef.current = [
      { axis: 'G', target: RANGE.G.home, label: '/home' },
      { axis: 'Z', target: RANGE.Z.home, label: '/home' },
      { axis: 'Y', target: RANGE.Y.home, label: '/home' },
      { axis: 'X', target: RANGE.X.home, label: '/home' },
    ];
    drainNext();
  };

  // ===== Sequence Move handlers =====
  const nextStepId = () => (sequence.reduce((m, s) => Math.max(m, s.id), 0) + 1);
  const blankStep = () => ({ id: nextStepId(), motor: 'X', pulse: 0, speed: 8000, acc: 200 });

  const seqAdd = () => setSequence(s => [...s, blankStep()]);
  const seqInsertAfter = (idx) => setSequence(s => {
    const arr = [...s];
    arr.splice(idx + 1, 0, { ...blankStep() });
    return arr;
  });
  const seqDelete = (idx) => setSequence(s => s.filter((_, i) => i !== idx));
  const seqMoveUp = (idx) => setSequence(s => {
    if (idx === 0) return s;
    const arr = [...s]; [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; return arr;
  });
  const seqMoveDown = (idx) => setSequence(s => {
    if (idx === s.length - 1) return s;
    const arr = [...s]; [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; return arr;
  });
  const seqUpdate = (idx, patch) => setSequence(s => s.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const seqClear = () => {
    if (!confirm('Clear all sequence steps?')) return;
    setSequence([]);
  };

  const seqRun = () => {
    if (sequence.length === 0 || seqRunningRef.current) return;
    pushLog({ kind:'api', dir:'POST', target: conn.apiUrl + '/sequence',
      msg: <>running <span className="n">{sequence.length}</span> step(s)</>});
    moveQueueRef.current = sequence.map(s => {
      const r = RANGE[s.motor];
      return {
        axis: s.motor,
        target: clamp(Number(s.pulse) || 0, r.min, r.max),
        label: '/sequence',
        stepId: s.id,
      };
    });
    seqRunningRef.current = true;
    setSeqRunning(true);
    drainNext();
  };

  const seqStop = () => {
    moveQueueRef.current = [];
    seqRunningRef.current = false;
    setSeqRunning(false);
    setActiveStepId(null);
    holdHere();
    pushLog({ kind:'err', dir:'EVT', target: '/sequence', msg: <>sequence stopped</>});
  };
  const estop = () => {
    holdHere();
    draggingRef.current = false;
    pushLog({ kind:'err', dir:'EVT', target: conn.mqttTopic + '/estop', msg: <>EMERGENCY STOP latched — all axes halted</>});
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark"></span>
          GANTRY · CTL <small>v2.4 / gantry-01</small>
        </div>
        <div className="pills">
          <span className={`pill ${connected.api ? 'ok':'bad'}`}><span className="dot"></span>API · {connected.api ? '200 OK' : 'DOWN'}</span>
          <span className={`pill ${connected.mqtt ? 'ok':'bad'}`}><span className="dot"></span>MQTT · {connected.mqtt ? 'CONNECTED' : 'OFFLINE'}</span>
          <span className={`pill ${moving ? 'warn':'ok'}`}><span className="dot"></span>{moving ? 'MOVING' : 'IDLE'}</span>
          <button className="estop" onClick={estop}>E-STOP</button>
        </div>
      </header>

      <div className="main">
        {/* ===== Sequence Move pane ===== */}
        <aside className="pane">
          <div className="pane-head">
            <h2>Sequence Move</h2>
            <span className="tag">/sequence</span>
          </div>

          <div className="seq-toolbar">
            {seqRunning ? (
              <button className="danger-text" onClick={seqStop}>■ Stop</button>
            ) : (
              <button className="primary" onClick={seqRun} disabled={sequence.length === 0}>▶ Run All</button>
            )}
            <button onClick={seqAdd}>+ Add Step</button>
            <button onClick={seqClear} disabled={sequence.length === 0} title="Clear all steps">↺</button>
          </div>

          <div className="seq-list">
            {sequence.length === 0 ? (
              <div className="seq-empty">No steps yet.<br/>Click <b>+ Add Step</b> to start.</div>
            ) : sequence.map((s, idx) => (
              <div
                key={s.id}
                className={`seq-step ${activeStepId === s.id ? 'active' : ''}`}
                onClick={() => setActiveAxis(s.motor)}
              >
                <div className="seq-step-head">
                  <span className="seq-num">#{idx + 1}</span>
                  <select
                    className="seq-motor"
                    value={s.motor}
                    onChange={e => { seqUpdate(idx, { motor: e.target.value }); setActiveAxis(e.target.value); }}
                    onClick={e => e.stopPropagation()}
                  >
                    {AXES.map(a => <option key={a} value={a}>{a} · {RANGE[a].label}</option>)}
                  </select>
                  <div className="seq-actions" onClick={e => e.stopPropagation()}>
                    <button title="Move up" onClick={() => seqMoveUp(idx)} disabled={idx === 0}>↑</button>
                    <button title="Move down" onClick={() => seqMoveDown(idx)} disabled={idx === sequence.length - 1}>↓</button>
                    <button title="Insert step below" onClick={() => seqInsertAfter(idx)}>⊕</button>
                    <button title="Delete step" className="del" onClick={() => seqDelete(idx)}>×</button>
                  </div>
                </div>
                <div className="seq-step-body" onClick={e => e.stopPropagation()}>
                  <div className="seq-cell">
                    <label title="Target position (pulse)">Pulse</label>
                    <input type="number" value={s.pulse}
                           onChange={e => seqUpdate(idx, { pulse: e.target.value === '' ? 0 : +e.target.value })} />
                  </div>
                  <div className="seq-cell">
                    <label title="Speed (pulse / second)">Spd p/s</label>
                    <input type="number" value={s.speed}
                           onChange={e => seqUpdate(idx, { speed: e.target.value === '' ? 0 : +e.target.value })} />
                  </div>
                  <div className="seq-cell">
                    <label title="Acceleration & deceleration slope time (milliseconds)">Acc ms</label>
                    <input type="number" value={s.acc}
                           onChange={e => seqUpdate(idx, { acc: e.target.value === '' ? 0 : +e.target.value })} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="seq-footer">
            <span>Steps: <b>{sequence.length}</b></span>
            <span>{seqRunning ? <>running step <b>{sequence.findIndex(s => s.id === activeStepId) + 1}</b>/{sequence.length}</> : 'idle'}</span>
          </div>
        </aside>

        {/* ===== Movement pane ===== */}
        <section className="pane" style={{padding:0}}>
          <div className="pane-head">
            <h2>Robot Movement</h2>
            <span className="tag">click-axis → drag, step, or type a target</span>
          </div>

          <div className="move-body">
              <div className="stage">
                <div className="stage-tools">
                  <div className="badge">FRAME: <b>WORLD</b></div>
                  <div className="badge">ACTIVE: <span className="accent">{activeAxis}</span></div>
                </div>
                <div className="view-tools">
                  <div className="view-group">
                    <button title="Isometric" onClick={()=>goPreset('iso')}>ISO</button>
                    <button title="Top view" onClick={()=>goPreset('top')}>TOP</button>
                    <button title="Front view" onClick={()=>goPreset('front')}>FRONT</button>
                    <button title="Right view" onClick={()=>goPreset('right')}>RIGHT</button>
                    <button title="Back view" onClick={()=>goPreset('back')}>BACK</button>
                    <button
                      title="Follow gripper (camera tracks tool tip)"
                      onClick={()=>goPreset('follow')}
                      style={view.follow ? {background:'var(--accent-soft)', color:'var(--accent-ink)'} : null}
                    >FOLLOW</button>
                  </div>
                  <div className="view-readout" title={`Drag: orbit  ·  Shift+Drag: pan  ·  Wheel: zoom`}>
                    AZ {Math.round(view.az*180/Math.PI)}° · EL {Math.round(view.el*180/Math.PI)}° · {Math.round(view.zoom*100)}%
                  </div>
                </div>
                <div className="stage-axisinfo">
                  <div className="lbl">Position · {activeAxis} · {RANGE[activeAxis].label}</div>
                  <div className={`val ${moving ? 'stale' : ''}`}>{Math.round(pos[activeAxis]).toLocaleString()}<span className="u-suffix">{motor.unit}</span></div>
                  <div style={{marginTop:2, fontSize:9.5, color:'#9aa0a6'}}>
                    {lastRead[activeAxis] ? `read ${lastRead[activeAxis]}` : 'not read yet — click ⟲ Get Pos'}
                  </div>
                  <div style={{marginTop:8, fontSize:10, color:'#9aa0a6', display:'flex', justifyContent:'space-between'}}>
                    <span>min {RANGE[activeAxis].min.toLocaleString()}</span><span>max {RANGE[activeAxis].max.toLocaleString()}</span>
                  </div>
                </div>

                <RobotSvg
                  pos={pos}
                  active={activeAxis}
                  range={RANGE}
                  onPick={setActiveAxis}
                  onDragStart={onDragStart}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                  onArrowJog={jog}
                  view={view}
                  setView={setView}
                />

                <div className="stage-hint">
                  <b>Drag</b> empty area: orbit · <b>Shift+Drag</b>: pan · <b>Wheel</b>: zoom · click a part to jog
                </div>
              </div>

              <div className="jog">
                <div className="jog-topbar">
                  <button className="btn" onClick={home} title="Home sequence: G → Z → Y → X">Home all</button>
                  <button className="btn" onClick={holdHere} title="Cancel pending target — hold at current position">Hold</button>
                  <button className="btn" onClick={getAllPositions} title="Read the actual position of every axis (X, Y, Z, G)">⟲ Get All</button>
                </div>
                {AXES.map(a => {
                  const r = RANGE[a];
                  const draftVal = Number.isFinite(draft[a]) ? draft[a] : 0;
                  const isDirty = Math.round(draftVal) !== Math.round(tgt[a]);
                  const commit = (raw) => {
                    const v = Math.round(clamp(Number(raw)||0, r.min, r.max));
                    setDraft(d => ({...d, [a]: v}));
                    if (v !== tgt[a]) gotoTarget({...tgt, [a]: v});
                  };
                  const nudge = (dir) => {
                    const base = Number.isFinite(draftVal) ? draftVal : tgt[a];
                    const axisStep = (window.AXIS_PARAMS?.[a]?.step) || 1;
                    commit(base + dir * axisStep);
                  };
                  const axisStepDisplay = (window.AXIS_PARAMS?.[a]?.step) || 1;
                  return (
                  <div key={a} className={`axis-card ${activeAxis===a?'active':''}`} onClick={()=>setActiveAxis(a)}>
                    <div className="row">
                      <div className="axis-name">
                        <span className="axis-tag">{a}</span>
                        {RANGE[a].label}
                      </div>
                      <div className="right">
                        <div className="axis-pos-wrap">
                          <div className={`axis-pos ${moving ? 'stale' : ''}`} title={lastRead[a] ? `Last read ${lastRead[a]}` : 'Not read yet — click ⟲ to read the actual position'}>
                            {Math.round(pos[a]).toLocaleString()}<span className="u">{motor.unit}</span>
                          </div>
                          <div className="axis-pos-stamp">{lastRead[a] ? `read ${lastRead[a]}` : 'not read'}</div>
                        </div>
                        <button
                          className="axis-getpos"
                          title={`Get actual ${a} position from controller`}
                          onClick={(e) => { e.stopPropagation(); getPosition(a); }}
                        >⟲</button>
                        <button
                          className="axis-gear"
                          title="Edit axis parameters"
                          onClick={(e) => { e.stopPropagation(); window.openAxisParam(a); }}
                        >⚙</button>
                      </div>
                    </div>
                    <div className="meter">
                      <div className="fill" style={{width: ((pos[a]-r.min)/(r.max-r.min)*100)+'%'}}></div>
                    </div>
                    <div className={`target-row ${isDirty?'dirty':''}`} onClick={(e)=>e.stopPropagation()}>
                      <button title={`−${axisStepDisplay.toLocaleString()} ${motor.unit}`} onClick={()=>nudge(-1)}>−</button>
                      <input
                        type="number"
                        step="1"
                        value={draftVal}
                        onFocus={()=>setActiveAxis(a)}
                        onChange={e => setDraft(d => ({...d, [a]: e.target.value === '' ? '' : +e.target.value}))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                        onBlur={e => commit(e.target.value)}
                      />
                      <span className="u">{motor.unit}</span>
                      <button title={`+${axisStepDisplay.toLocaleString()} ${motor.unit}`} onClick={()=>nudge(+1)}>+</button>
                    </div>
                    <div className="axis-range">
                      <span>min {r.min.toLocaleString()}</span>
                      <span>max {r.max.toLocaleString()}</span>
                    </div>
                    <div className="param-trio" onClick={(e)=>e.stopPropagation()}>
                      <div className="pf">
                        <label title="Speed (pulse / second)">Spd p/s</label>
                        <input type="number" defaultValue={window.getAxisParam(a, 'default_speed')}
                               onChange={e => window.setAxisParam(a, 'default_speed', +e.target.value || 0)} />
                      </div>
                      <div className="pf">
                        <label title="Acceleration & deceleration slope time (milliseconds)">Acc ms</label>
                        <input type="number" defaultValue={window.getAxisParam(a, 'default_acc')}
                               onChange={e => window.setAxisParam(a, 'default_acc', +e.target.value || 0)} />
                      </div>
                      <div className="pf">
                        <label title="Step (jog increment, pulse)">Step</label>
                        <input type="number" defaultValue={window.getAxisParam(a, 'step')}
                               onChange={e => window.setAxisParam(a, 'step', +e.target.value || 0)} />
                      </div>
                    </div>
                    <div className="card-actions" onClick={(e)=>e.stopPropagation()}>
                      <button
                        className={`enable-btn ${motorEnabled[a] ? 'on' : ''}`}
                        title={motorEnabled[a] ? `Disable ${a} motor` : `Enable ${a} motor`}
                        onClick={() => { setActiveAxis(a); toggleMotor(a); }}
                      >
                        <span className="icon">{motorEnabled[a] ? '⏼' : '⏻'}</span>
                        <span>{motorEnabled[a] ? 'On' : 'Enable'}</span>
                      </button>
                      <button
                        className="origin-btn"
                        title={`Move ${a} to origin_pos (${(window.AXIS_PARAMS?.[a]?.origin_pos) ?? 0})`}
                        onClick={() => { setActiveAxis(a); originAxis(a); }}
                      >
                        <span className="icon">⊕</span>
                        <span>Origin</span>
                      </button>
                      <button
                        className="home-btn"
                        title={`Home ${a} to ${RANGE[a].home}`}
                        onClick={() => { setActiveAxis(a); homeAxis(a); }}
                      >
                        <span className="icon">⌂</span>
                        <span>Home</span>
                      </button>
                    </div>
                  </div>
                  );
                })}

              </div>
            </div>
        </section>
      </div>

      <footer className="log">
        <div className="log-head">
          <span>Live telemetry</span>
          <span style={{color:'#5e6268'}}>·</span>
          <span>{conn.mqttHost}:{conn.mqttPort}</span>
          <div className="chips">
            {['all','mqtt','api','evt','err'].map(f => (
              <span key={f} className={`log-chip ${logFilter===f?'on':''}`} onClick={()=>setLogFilter(f)}>{f}</span>
            ))}
            <span className="log-chip" onClick={()=>setLog([])}>clear</span>
          </div>
        </div>
        <div className="log-body" ref={logRef}>
          {log.filter(l=>logFilter==='all'||l.kind===logFilter).map((l, i) => (
            <div className="log-line" key={i}>
              <span className="t">{l.t}</span>
              <span className={'tag-' + l.kind}>{l.dir}</span>
              <span className="target">{l.target}</span>
              <span className="msg">{l.msg}</span>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

/* ============================================
   Numeric "Goto" panel
   ============================================ */
function NumericPanel({ pos, tgt, unit, speed, onGo, onHome }) {
  const [val, setVal] = useState({ X: tgt.X, Y: tgt.Y, Z: tgt.Z, G: tgt.G });
  useEffect(()=>{ setVal({X:tgt.X,Y:tgt.Y,Z:tgt.Z,G:tgt.G}); }, [tgt.X, tgt.Y, tgt.Z, tgt.G]);

  const setAxis = (a, v) => setVal(s => ({...s, [a]: Math.round(v)}));
  const nudge = (a, d) => setVal(s => ({...s, [a]: Math.round(clamp(s[a] + d, RANGE[a].min, RANGE[a].max))}));

  const axisColor = {
    X: 'oklch(0.62 0.18 245)',
    Y: 'oklch(0.62 0.14 150)',
    Z: 'oklch(0.72 0.14 70)',
    G: 'oklch(0.58 0.20 25)',
  };

  return (
    <div style={{flex:1, display:'flex', flexDirection:'column'}}>
      <div className="num-form">
        {AXES.map(a => (
          <div className="num-block" key={a}>
            <div className="axis-head">
              <span style={{
                background: axisColor[a],
                width:22,height:22,borderRadius:4,display:'inline-grid',placeItems:'center',
                color:'#fff',fontFamily:'var(--mono)',fontWeight:600,fontSize:12
              }}>{a}</span>
              <span className="axis-name">{a} · {RANGE[a].label}<span className="sub"> · absolute</span></span>
            </div>
            <div className="num-input">
              <button onClick={()=>nudge(a, -100)}>−</button>
              <input type="number" step="1"
                value={Number.isFinite(val[a])?val[a]:0}
                onChange={e=>setAxis(a, +e.target.value)} />
              <span className="u">{unit}</span>
              <button onClick={()=>nudge(a, +100)}>+</button>
            </div>
            <div className="current">
              Current <b>{Math.round(pos[a]).toLocaleString()}</b> {unit}<br/>
              Range <b>{RANGE[a].min.toLocaleString()}</b>–<b>{RANGE[a].max.toLocaleString()}</b>
            </div>
          </div>
        ))}

        <div className="num-actions">
          <button className="btn" onClick={onHome}>Home all</button>
          <button className="btn" onClick={()=>setVal({X:Math.round(pos.X),Y:Math.round(pos.Y),Z:Math.round(pos.Z),G:Math.round(pos.G)})}>Sync from current</button>
          <span className="grow"></span>
          <button className="btn ghost" onClick={()=>setVal({X:0,Y:0,Z:0,G:0})}>Zero</button>
          <button className="btn accent" onClick={()=>onGo(val)}>▶ Move to target</button>
        </div>
      </div>

      <div style={{
        borderTop:'1px solid var(--line)',
        padding:'10px 16px',
        background:'var(--panel-2)',
        display:'flex', gap:18, fontFamily:'var(--mono)', fontSize:11.5, color:'var(--muted)',
        fontVariantNumeric:'tabular-nums',
      }}>
        <div>Δ <span style={{color:'var(--ink)'}}>X {(val.X - pos.X).toLocaleString()}</span></div>
        <div><span style={{color:'var(--ink)'}}>Y {(val.Y - pos.Y).toLocaleString()}</span></div>
        <div><span style={{color:'var(--ink)'}}>Z {(val.Z - pos.Z).toLocaleString()}</span></div>
        <div><span style={{color:'var(--ink)'}}>G {(val.G - pos.G).toLocaleString()}</span></div>
        <div style={{marginLeft:'auto'}}>est. duration ≈ <span style={{color:'var(--ink)'}}>
          {(Math.max(Math.abs(val.X-pos.X),Math.abs(val.Y-pos.Y),Math.abs(val.Z-pos.Z),Math.abs(val.G-pos.G)) / Math.max(1, speed)).toFixed(2)} s
        </span></div>
      </div>
    </div>
  );
}

/* ============================================
   Interactive isometric robot
   - X home = leftmost  (x=0 at LEFT edge of bridge)
   - Y home = backmost  (y=0 deepest INTO the machine, away from viewer)
   - Z home = retracted (z=0 → rod fully UP)
   - Mouse drag: click on a part to grab + drag that axis
   ============================================ */
function RobotSvg({ pos, active, range, onPick, onDragStart, onDrag, onDragEnd, onArrowJog, view, setView }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const viewDragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  // pulse → draw units (Z and G are direct; X and Y are inset below so the
  // moving carriage / bridge stay inside the inner rail edges).
  const pz = pos.Z * SCALE.Z;
  const pg = pos.G * SCALE.G;
  const Lx = range.X.max * SCALE.X;
  const Ly = range.Y.max * SCALE.Y;
  const Lz = range.Z.max * SCALE.Z;
  const Lg = range.G.max * SCALE.G;

  // ----- Geometry (draw units) -----
  const RAIL_W   = 26;        // rail profile width
  const RAIL_H   = 14;        // rail profile height
  const LEG_H    = 120;       // bridge legs (tall enough for full 90mm Z travel + gripper)
  const LEG_W    = RAIL_W + 4;
  const LEG_D    = 30;
  const BRIDGE_H = 22;        // bridge thickness (Z)
  const BRIDGE_D = 30;        // bridge depth (Y)
  const CAR_W    = 42;        // X carriage width (along X)
  const CAR_D    = 44;        // X carriage depth (along Y)
  const CAR_H    = 12;        // X carriage height
  const TOWER_W  = 24;        // Z motor housing width
  const TOWER_D  = 24;
  const TOWER_H  = 22;        // short housing on top of carriage
  const ROD_W    = 14;
  const ROD_D    = 14;
  const GRIP_W   = 30;        // gripper body width  (along X)
  const GRIP_D   = 18;        // gripper body depth  (along Y)
  const GRIP_H   = 10;
  const FING_W   = 4;         // finger thickness (X)
  const FING_D   = 12;        // finger depth     (Y)
  const FING_H   = 12;
  const FING_BASE_OFFSET = 4; // half-distance between fingers when fully closed

  // Linear remap so the carriage / bridge centers stay inset by half their own
  // footprint from each rail. At pos.X = 0 the carriage's left edge sits
  // exactly on the left rail; at pos.X = max the right edge sits on the right
  // rail. Same for Y / bridge. Drag math below uses the same scale so jogging
  // by hand still matches the visual motion.
  const SCALE_EFF_X = Math.max(1, Lx - CAR_W) / range.X.max;
  const SCALE_EFF_Y = Math.max(1, Ly - BRIDGE_D) / range.Y.max;
  const px = (CAR_W / 2) + pos.X * SCALE_EFF_X;
  const py = pos.Y * SCALE_EFF_Y;

  const railTopZ   = RAIL_H;
  const bridgeBotZ = railTopZ + LEG_H;
  const bridgeTopZ = bridgeBotZ + BRIDGE_H;
  const carBotZ    = bridgeTopZ;
  const carTopZ    = carBotZ + CAR_H;
  const towerBotZ  = carTopZ;
  const towerTopZ  = towerBotZ + TOWER_H;

  // Z rod extends down from below the bridge
  const rodTopZ_visible = bridgeBotZ;
  const rodBotZ         = rodTopZ_visible - pz;

  // Gripper finger offset along X (Lg-pg so G=0 = fully OPEN, G=Lg = fully CLOSED)
  const fingerOffset = FING_BASE_OFFSET + (Lg - pg);

  // ----- Projection (orbit camera) -----
  // When `view.follow` is on, re-center on the gripper tip every frame so the
  // camera tracks the tool as it moves. Otherwise center on the workspace.
  const gripperCenter = {
    cx: px,
    cy: py + BRIDGE_D / 2,
    cz: rodBotZ - GRIP_H / 2,
  };
  const center = useMemo(() => (
    view.follow
      ? gripperCenter
      : {
          cx: Lx / 2,
          cy: Ly / 2,
          cz: (railTopZ + bridgeBotZ + BRIDGE_H/2) / 2,
        }
  ), [view.follow, gripperCenter.cx, gripperCenter.cy, gripperCenter.cz, Lx, Ly, bridgeBotZ]);
  const { project, look } = useMemo(() => makeProjector(view), [view.az, view.el]);
  const p = useCallback((x, y, z) =>
    project(x - center.cx, y - center.cy, z - center.cz),
    [project, center.cx, center.cy, center.cz]);
  const poly = (...pts) => pts.map(([x,y,z]) => p(x,y,z).join(',')).join(' ');
  // Screen-space direction unit vector per PULSE axis (drag math uses these)
  const axisU = useMemo(() => {
    const o = project(0, 0, 0);
    const dir = (vx, vy, vz) => {
      const t = project(vx, vy, vz);
      return [t[0]-o[0], t[1]-o[1]];
    };
    return {
      X: dir( 1, 0, 0),
      Y: dir( 0, 1, 0),
      Z: dir( 0, 0,-1),   // +Z pulse → rod extends DOWN (-world Z)
      G: dir( 1, 0, 0),   // gripper grip direction along X
    };
  }, [project]);

  // ----- helpers -----
  // 3-face box that picks the camera-facing faces based on view (look vector)
  const Box = ({ x0,y0,z0, x1,y1,z1, top='#ebedef', front='#c5c8cc', right='#a3a7ac', stroke='#6e7176', sw=0.5, opacity=1 }) => {
    const xF = look[0] < 0 ? x1 : x0;
    const yF = look[1] < 0 ? y1 : y0;
    const zF = look[2] < 0 ? z1 : z0;
    return (
      <g style={{opacity}}>
        <polygon points={poly([xF,y0,z0],[xF,y1,z0],[xF,y1,z1],[xF,y0,z1])} fill={right} stroke={stroke} strokeWidth={sw}/>
        <polygon points={poly([x0,yF,z0],[x1,yF,z0],[x1,yF,z1],[x0,yF,z1])} fill={front} stroke={stroke} strokeWidth={sw}/>
        <polygon points={poly([x0,y0,zF],[x1,y0,zF],[x1,y1,zF],[x0,y1,zF])} fill={top}   stroke={stroke} strokeWidth={sw}/>
      </g>
    );
  };

  // ----- bounds (workspace BBox in world units, used for static viewBox) -----
  const HALF = useMemo(() => {
    // Worst-case radius of any scene point from the workspace center.
    const rXY = Math.hypot(Math.max(center.cx, Lx-center.cx) + 40, Math.max(center.cy, Ly-center.cy) + 40);
    const rZ  = Math.max(center.cz, towerTopZ - center.cz, center.cz + 40) + 40;
    return Math.max(rXY, rZ);
  }, [Lx, Ly, center.cx, center.cy, center.cz, towerTopZ]);
  const vbHalf = HALF;
  const vb = `${-vbHalf} ${-vbHalf} ${vbHalf*2} ${vbHalf*2}`;

  // ----- pointer / drag -----
  const toSvg = (clientX, clientY) => {
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM().inverse();
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(ctm);
  };
  const handleAxisDown = (axis) => (e) => {
    e.stopPropagation(); e.preventDefault();
    const start = toSvg(e.clientX, e.clientY);
    dragRef.current = { axis, sx: start.x, sy: start.y, startVal: pos[axis], moved: false };
    setIsDragging(true);
    onPick(axis);
    onDragStart(axis);
    try { svgRef.current.setPointerCapture(e.pointerId); } catch {}
  };
  // Empty-canvas pointer: start a VIEW drag (orbit / pan)
  const handleSvgDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest('.robot-axis')) return;
    if (e.target.closest('.axis-arrow')) return;
    e.preventDefault();
    const isPan = e.shiftKey || e.button === 1;
    viewDragRef.current = {
      type: isPan ? 'pan' : 'orbit',
      sx: e.clientX, sy: e.clientY,
      az0: view.az, el0: view.el,
      panX0: view.panX, panY0: view.panY,
    };
    setIsDragging(true);
    try { svgRef.current.setPointerCapture(e.pointerId); } catch {}
  };
  const handleMove = (e) => {
    if (dragRef.current) {
      const cur = toSvg(e.clientX, e.clientY);
      const dx = cur.x - dragRef.current.sx;
      const dy = cur.y - dragRef.current.sy;
      const a  = dragRef.current.axis;
      const u  = axisU[a];
      const denom = u[0]*u[0] + u[1]*u[1];
      if (denom < 1e-6) return;
      const proj  = (dx*u[0] + dy*u[1]) / denom;   // projection on axis (draw units)
      if (Math.abs(proj) > 0.05) dragRef.current.moved = true;
      // Use the inset scale for X / Y so drag matches the visual carriage
      // motion (which is also inset). Z and G still use the raw SCALE.
      const scaleA = a === 'X' ? SCALE_EFF_X : a === 'Y' ? SCALE_EFF_Y : SCALE[a];
      const delta_pulse = proj / scaleA;              // → pulse
      onDrag(a, dragRef.current.startVal + delta_pulse);
      return;
    }
    if (viewDragRef.current) {
      const d = viewDragRef.current;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (d.type === 'orbit') {
        const sens = 0.007;
        setView(v => ({
          ...v,
          az: d.az0 + dx * sens,
          el: clamp(d.el0 - dy * sens, -Math.PI/12, Math.PI/2 - 0.05),
        }));
      } else {
        const svg = svgRef.current;
        const rect = svg.getBoundingClientRect();
        const k = (vbHalf*2) / Math.max(rect.width, rect.height);
        setView(v => ({ ...v, panX: d.panX0 + dx * k, panY: d.panY0 + dy * k }));
      }
      return;
    }
  };
  const handleUp = (e) => {
    if (dragRef.current) {
      const a = dragRef.current.axis;
      onDragEnd(a, pos[a]);
      dragRef.current = null;
    }
    if (viewDragRef.current) {
      viewDragRef.current = null;
    }
    setIsDragging(false);
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch {}
  };
  const handleWheel = (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView(v => ({ ...v, zoom: clamp(v.zoom * factor, 0.35, 5) }));
  };

  // arrow positions (relative to current pose)
  const arrows = useMemo(() => {
    if (active === 'X') {
      const yMid = py + BRIDGE_D/2;
      const z    = bridgeTopZ + CAR_H + 12;
      return [
        { p: p(Lx + 26, yMid, z), dir:+1, axis:'X', rot: 0 },
        { p: p(-26,    yMid, z), dir:-1, axis:'X', rot: 180 },
      ];
    }
    if (active === 'Y') {
      const x = px + 0;
      const z = bridgeTopZ + 6;
      const rotForward = Math.atan2(axisU.Y[1], axisU.Y[0]) * 180 / Math.PI;
      return [
        { p: p(x, Ly + 28, z), dir:+1, axis:'Y', rot: rotForward },
        { p: p(x, -28,     z), dir:-1, axis:'Y', rot: rotForward + 180 },
      ];
    }
    if (active === 'Z') {
      const x = px, y = py + BRIDGE_D/2;
      return [
        // +Z = rod extends DOWN  → arrow at the bottom of gripper, pointing down
        { p: p(x, y, rodBotZ - GRIP_H - FING_H - 22), dir:+1, axis:'Z', rot: 90 },
        // -Z = rod retracts UP   → arrow above the tower, pointing up
        { p: p(x, y, towerTopZ + 22),                   dir:-1, axis:'Z', rot: -90 },
      ];
    }
    // 'G' — gripper open / close, along X
    const gx = px;
    const gy = py + BRIDGE_D/2;
    const gz = rodBotZ - GRIP_H - FING_H/2 - 2;
    return [
      { p: p(gx + fingerOffset + 16, gy, gz), dir:+1, axis:'G', rot: 0 },
      { p: p(gx - fingerOffset - 16, gy, gz), dir:-1, axis:'G', rot: 180 },
    ];
  }, [active, px, py, pz, pg, fingerOffset, Lx, Ly, axisU.Y[0], axisU.Y[1], view.az, view.el]);

  // ----- render -----
  const isXActive = active === 'X';
  const isYActive = active === 'Y';
  const isZActive = active === 'Z';
  const isGActive = active === 'G';
  const dimX = !isXActive ? 'dim' : '';
  const dimY = !isYActive ? 'dim' : '';
  const dimZ = !isZActive ? 'dim' : '';
  const dimG = !isGActive ? 'dim' : '';

  const accent = 'oklch(0.62 0.18 245)';
  const accentDk = 'oklch(0.50 0.18 245)';
  const accentLt = 'oklch(0.78 0.16 245)';

  return (
    <svg ref={svgRef}
         viewBox={vb}
         preserveAspectRatio="xMidYMid meet"
         className={isDragging ? 'dragging' : ''}
         onPointerDown={handleSvgDown}
         onPointerMove={handleMove}
         onPointerUp={handleUp}
         onPointerCancel={handleUp}
         onPointerLeave={handleUp}
         onWheel={handleWheel}>
      <defs>
        <linearGradient id="floorGrd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0.10"/>
          <stop offset="100%" stopColor="#000" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>

      {/* ===== Floor with grid + home markers ===== */}
      <g>
        {/* floor outline */}
        <polygon
          points={poly([0,0,0],[Lx,0,0],[Lx,Ly,0],[0,Ly,0])}
          fill="#dfe1e3" stroke="#a8abb0" strokeWidth="0.6" opacity="0.55"/>
        {/* grid lines along X */}
        {Array.from({length: 7}).map((_,i) => {
          const x = (Lx/6)*i;
          const a = p(x,0,0), b = p(x,Ly,0);
          return <line key={'gx'+i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="floor-tick"/>;
        })}
        {/* grid lines along Y */}
        {Array.from({length: 5}).map((_,i) => {
          const y = (Ly/4)*i;
          const a = p(0,y,0), b = p(Lx,y,0);
          return <line key={'gy'+i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="floor-tick"/>;
        })}
        {/* HOME marker at (0,0) front-left corner (Y=0 = OUT/front, X=0 = LEFT) */}
        {(() => {
          const hp = p(0, 0, 0);
          return (
            <g transform={`translate(${hp[0]}, ${hp[1]})`}>
              <circle r="4.5" fill="#fff" stroke="oklch(0.62 0.14 150)" strokeWidth="1.5"/>
              <circle r="2" className="home-marker"/>
              <text x="-44" y="14" className="home-text">HOME · X0 Y0</text>
            </g>
          );
        })()}
        {/* shadow under the bridge/carriage */}
        <ellipse
          cx={p(px, py+BRIDGE_D/2, 0)[0]}
          cy={p(px, py+BRIDGE_D/2, 0)[1]+8}
          rx={70} ry={20}
          fill="url(#floorGrd)"/>
      </g>

      {/* ===== X axis group — the BRIDGE (X = across) ===== */}
      <g className={`robot-axis ${isXActive?'active':dimX}`} onPointerDown={handleAxisDown('X')}>
        {/* Bridge beam (spans full X) */}
        <Box x0={0} y0={py} z0={bridgeBotZ}
             x1={Lx} y1={py + BRIDGE_D} z1={bridgeTopZ}
             top={isXActive ? accentLt : '#dfe2e6'}
             front={isXActive ? accent : '#a8acb1'}
             right={isXActive ? accentDk : '#8a8e93'}
             stroke="#5b5f64"/>
        {/* T-slot grooves on bridge top */}
        {[1,2,3].map(i => {
          const t = i/4;
          const a = p(0, py + BRIDGE_D*t, bridgeTopZ+0.2);
          const b = p(Lx, py + BRIDGE_D*t, bridgeTopZ+0.2);
          return <line key={'bt'+i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#6a6d72" strokeWidth="0.55"/>;
        })}
        {/* X carriage (rides along bridge) */}
        <Box x0={px - CAR_W/2} y0={py - 6} z0={carBotZ}
             x1={px + CAR_W/2} y1={py + BRIDGE_D + 6} z1={carTopZ}
             top={isXActive ? '#fff' : '#cfd2d6'}
             front={isXActive ? accent : '#5e6268'}
             right={isXActive ? accentDk : '#4a4e54'}
             stroke="#2d3034"/>
        {/* hit zone for grabbing the X axis (whole bridge top is grabbable, but Box already handles it) */}
        {/* axis label */}
        {(() => {
          const lp = p(Lx + 16, py + BRIDGE_D/2, bridgeTopZ + 4);
          return (
            <g style={{pointerEvents:'none'}}>
              <rect x={lp[0]-9} y={lp[1]-9} width="18" height="18" fill={isXActive?accent:'#1d2024'} rx="3"/>
              <text x={lp[0]} y={lp[1]+4} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="#fff" fontWeight="700">X</text>
            </g>
          );
        })()}
      </g>

      {/* ===== Y axis group — the LONG RAILS (Y = depth, home at FRONT/out closest to viewer) ===== */}
      <g className={`robot-axis ${isYActive?'active':dimY}`} onPointerDown={handleAxisDown('Y')}>
        {/* rail A — left edge (x near 0) */}
        <Box x0={0} y0={0} z0={0}
             x1={RAIL_W} y1={Ly} z1={railTopZ}
             top={isYActive ? accentLt : '#dfe2e6'}
             front={isYActive ? accent : '#a8acb1'}
             right={isYActive ? accentDk : '#8a8e93'}
             stroke="#5b5f64"/>
        {/* rail B — right edge (x near Lx) */}
        <Box x0={Lx - RAIL_W} y0={0} z0={0}
             x1={Lx} y1={Ly} z1={railTopZ}
             top={isYActive ? accentLt : '#dfe2e6'}
             front={isYActive ? accent : '#a8acb1'}
             right={isYActive ? accentDk : '#8a8e93'}
             stroke="#5b5f64"/>
        {/* T-slot grooves on rails */}
        {[1,2].map(i => {
          const t = i/3;
          const aL = p(RAIL_W*t, 0, railTopZ+0.2);
          const bL = p(RAIL_W*t, Ly, railTopZ+0.2);
          const aR = p(Lx - RAIL_W + RAIL_W*t, 0, railTopZ+0.2);
          const bR = p(Lx - RAIL_W + RAIL_W*t, Ly, railTopZ+0.2);
          return (
            <g key={'rg'+i}>
              <line x1={aL[0]} y1={aL[1]} x2={bL[0]} y2={bL[1]} stroke="#6a6d72" strokeWidth="0.55"/>
              <line x1={aR[0]} y1={aR[1]} x2={bR[0]} y2={bR[1]} stroke="#6a6d72" strokeWidth="0.55"/>
            </g>
          );
        })}
        {/* end caps */}
        {[0, Ly].map(y => (
          <g key={'cap'+y}>
            <polygon points={poly([RAIL_W,y,0],[RAIL_W,y,railTopZ],[0,y,railTopZ],[0,y,0])}
              fill={isYActive?accentDk:'#5b6168'}/>
            <polygon points={poly([Lx,y,0],[Lx,y,railTopZ],[Lx-RAIL_W,y,railTopZ],[Lx-RAIL_W,y,0])}
              fill={isYActive?accentDk:'#5b6168'}/>
          </g>
        ))}
        {/* Bridge end-block / leg riding on left rail */}
        <Box x0={-3} y0={py + BRIDGE_D/2 - LEG_D/2} z0={railTopZ-1}
             x1={RAIL_W+3} y1={py + BRIDGE_D/2 + LEG_D/2} z1={bridgeBotZ+2}
             top={isYActive ? '#fff' : '#cfd2d6'}
             front={isYActive ? accent : '#5e6268'}
             right={isYActive ? accentDk : '#4a4e54'}
             stroke="#2d3034"/>
        {/* Bridge end-block / leg riding on right rail */}
        <Box x0={Lx-RAIL_W-3} y0={py + BRIDGE_D/2 - LEG_D/2} z0={railTopZ-1}
             x1={Lx+3} y1={py + BRIDGE_D/2 + LEG_D/2} z1={bridgeBotZ+2}
             top={isYActive ? '#fff' : '#cfd2d6'}
             front={isYActive ? accent : '#5e6268'}
             right={isYActive ? accentDk : '#4a4e54'}
             stroke="#2d3034"/>
        {/* axis label — placed at the IN/back end of the long rails to indicate +Y direction */}
        {(() => {
          const lp = p(Lx + 26, Ly, railTopZ + 6);
          return (
            <g style={{pointerEvents:'none'}}>
              <rect x={lp[0]-9} y={lp[1]-9} width="18" height="18" fill={isYActive?accent:'#1d2024'} rx="3"/>
              <text x={lp[0]} y={lp[1]+4} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="#fff" fontWeight="700">Y</text>
            </g>
          );
        })()}
      </g>

      {/* ===== Z axis group — the TOWER + ROD ===== */}
      <g className={`robot-axis ${isZActive?'active':dimZ}`} onPointerDown={handleAxisDown('Z')}>
        {/* Tower (motor housing on top of carriage) */}
        <Box x0={px - TOWER_W/2} y0={py + BRIDGE_D/2 - TOWER_D/2} z0={towerBotZ}
             x1={px + TOWER_W/2} y1={py + BRIDGE_D/2 + TOWER_D/2} z1={towerTopZ}
             top={isZActive ? accentLt : '#dfe2e6'}
             front={isZActive ? accent : '#7c8086'}
             right={isZActive ? accentDk : '#5e6268'}
             stroke="#3a3d42"/>
        {/* Z rod (exposed part below the carriage), only if pz > 0 */}
        {pz > 0.01 && (
          <Box x0={px - ROD_W/2} y0={py + BRIDGE_D/2 - ROD_D/2} z0={rodBotZ}
               x1={px + ROD_W/2} y1={py + BRIDGE_D/2 + ROD_D/2} z1={rodTopZ_visible}
               top={isZActive ? accentLt : '#c5c8cc'}
               front={isZActive ? accent : '#9aa0a6'}
               right={isZActive ? accentDk : '#787c80'}
               stroke="#3a3d42"/>
        )}
        {/* Z label */}
        {(() => {
          const lp = p(px, py + BRIDGE_D/2, towerTopZ + 10);
          return (
            <g style={{pointerEvents:'none'}}>
              <rect x={lp[0]-9} y={lp[1]-9} width="18" height="18" fill={isZActive?accent:'#1d2024'} rx="3"/>
              <text x={lp[0]} y={lp[1]+4} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="#fff" fontWeight="700">Z</text>
            </g>
          );
        })()}
      </g>

      {/* ===== Gripper (G) axis group — body + sliding fingers along X ===== */}
      <g className={`robot-axis ${isGActive?'active':dimG}`} onPointerDown={handleAxisDown('G')}>
        {/* Gripper body (fixed, sits below rod) */}
        <Box x0={px - GRIP_W/2} y0={py + BRIDGE_D/2 - GRIP_D/2} z0={rodBotZ - GRIP_H}
             x1={px + GRIP_W/2} y1={py + BRIDGE_D/2 + GRIP_D/2} z1={rodBotZ}
             top={isGActive ? accentLt : '#5e6268'}
             front={isGActive ? accent : '#3a3d42'}
             right={isGActive ? accentDk : '#2a2d31'}
             stroke="#15171a"/>
        {/* Two fingers — spread along X by fingerOffset (driven by G pulse) */}
        {[-1, 1].map(s => {
          const fx = px + s * fingerOffset;
          return (
            <Box key={'fg'+s}
                 x0={fx - FING_W/2} y0={py + BRIDGE_D/2 - FING_D/2}
                 z0={rodBotZ - GRIP_H - FING_H}
                 x1={fx + FING_W/2} y1={py + BRIDGE_D/2 + FING_D/2}
                 z1={rodBotZ - GRIP_H}
                 top={isGActive ? accentLt : '#3a3d42'}
                 front={isGActive ? accent : '#1d2024'}
                 right={isGActive ? accentDk : '#0f1012'}
                 stroke="#000"/>
          );
        })}
        {/* G label */}
        {(() => {
          const lp = p(px + fingerOffset + 18, py + BRIDGE_D/2, rodBotZ - GRIP_H - FING_H/2);
          return (
            <g style={{pointerEvents:'none'}}>
              <rect x={lp[0]-9} y={lp[1]-9} width="18" height="18" fill={isGActive?accent:'#1d2024'} rx="3"/>
              <text x={lp[0]} y={lp[1]+4} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="#fff" fontWeight="700">G</text>
            </g>
          );
        })()}
      </g>

      {/* ===== Direction arrows for active axis ===== */}
      <g>
        {arrows.map((a, i) => (
          <g key={i} className="axis-arrow"
             transform={`translate(${a.p[0]}, ${a.p[1]})`}
             onPointerDown={(e)=>{ e.stopPropagation(); }}
             onClick={(e)=>{ e.stopPropagation(); onArrowJog(a.axis, a.dir); }}>
            <circle r="12"/>
            <g transform={`rotate(${a.rot})`}>
              <path d="M -6 0 L 6 0 M 2 -4 L 6 0 L 2 4"/>
            </g>
          </g>
        ))}
      </g>
      </g>{/* end pan/zoom transform group */}
    </svg>
  );
}

/* ============================================
   UI helpers
   ============================================ */
function Section({ title, children }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}
function UnitInput({ value, unit, onChange }) {
  return (
    <div className="input-wrap">
      <input className="input with-unit" type="number" value={value} onChange={e=>onChange(+e.target.value)}/>
      <span className="unit">{unit}</span>
    </div>
  );
}

/* ============================================
   Utils
   ============================================ */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function easeInOut(t) { return t<0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
function nowStamp() {
  const d = new Date();
  const pad = (n,k=2) => String(n).padStart(k,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}
function seedLog() {
  const t = (s) => {
    const d = new Date(Date.now() - s*1000);
    const pad = (n,k=2) => String(n).padStart(k,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
  };
  return [
    { t:t(28), kind:'api',  dir:'GET',  target:'/api/v1/status',          msg: <>{'{ '}<span className="k">"state"</span>:<span className="s">"idle"</span>, <span className="k">"firmware"</span>:<span className="s">"2.4.1"</span> {'}'}</>},
    { t:t(26), kind:'mqtt', dir:'CONN', target:'mqtt://192.168.1.42:1883', msg: <>broker handshake ok · clientId=gantry-ui-31a9</>},
    { t:t(24), kind:'mqtt', dir:'SUB',  target:'robot/gantry-01/state',   msg: <>subscribed · qos=1</>},
    { t:t(18), kind:'evt',  dir:'RX',   target:'robot/gantry-01/state',   msg: <>{'{ '}<span className="k">"x"</span>:<span className="n">0</span>, <span className="k">"y"</span>:<span className="n">0</span>, <span className="k">"z"</span>:<span className="n">0</span>, <span className="k">"homed"</span>:<span className="s">true</span>, <span className="k">"unit"</span>:<span className="s">"µm"</span> {'}'}</>},
    { t:t(12), kind:'api',  dir:'POST', target:'/api/v1/limits',          msg: <>OK · soft limits applied</>},
    { t:t(4),  kind:'evt',  dir:'RX',   target:'robot/gantry-01/state',   msg: <>state=ready · servos enabled · door=closed</>},
  ];
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
