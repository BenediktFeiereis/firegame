import React, { useEffect, useMemo, useRef, useState } from "react";

// Feuerwehr-Einsatzleiter — Single-File-React-Game
// Steuerung:
// 1) Klicke auf Einsätze in der Liste.
// 2) Weise passende Einheiten zu (Buttons auf dem Einsatz-Card).
// 3) Wenn Anforderungen erfüllt sind, arbeitet der Einsatz ab und gibt die Kräfte frei.
// 4) Sammle Punkte für schnelle Bearbeitung. Verspätungen kosten Punkte.
// 5) Start/Pause jederzeit möglich. Viel Spaß, Bene!

// --- Spiel-Parameter (leicht veränderbar) ---
const GAME_CONFIG = {
  spawnEveryMs: 5500, // neue Einsatzmeldung alle X ms
  baseResolveMs: 8000, // Grunddauer zur Abarbeitung (wenn alle Kräfte da sind)
  travelMs: 3500, // An- und Abfahrtszeit (je Richtung vereinfacht)
  deadlineGraceMs: 10000, // Toleranz bis Strafpunkte
  maxOpenIncidents: 6,
  points: { onTime: 120, slowPenalty: -80, missedPenalty: -150, assign: 5 },
};

// Einheiten-Typen im Spiel
const UNIT_TYPES = [
  { key: "LF", name: "LF (Löschfahrzeug)" },
  { key: "DLK", name: "DLK (Drehleiter)" },
  { key: "RW", name: "RW (Rüstwagen)" },
  { key: "ELW", name: "ELW (Einsatzleitung)" },
  { key: "RTW", name: "RTW (Rettungsdienst)" },
];

// Start-Bestand der Wache
const START_UNITS = [
  { id: "LF-1", type: "LF" },
  { id: "LF-2", type: "LF" },
  { id: "DLK-1", type: "DLK" },
  { id: "RW-1", type: "RW" },
  { id: "ELW-1", type: "ELW" },
  { id: "RTW-1", type: "RTW" },
  { id: "RTW-2", type: "RTW" },
];

// Vorlagen für Einsatzarten
const INCIDENT_TEMPLATES = [
  {
    name: "Wohnungsbrand",
    requirements: { LF: 2, DLK: 1, ELW: 1 },
    emoji: "🔥",
    color: "from-red-500/90 to-rose-500/90",
  },
  {
    name: "VU eingeklemmt",
    requirements: { LF: 1, RW: 1, RTW: 1, ELW: 1 },
    emoji: "🚗",
    color: "from-amber-500/90 to-orange-500/90",
  },
  {
    name: "Küchenbrand klein",
    requirements: { LF: 1, RTW: 1 },
    emoji: "🍳",
    color: "from-red-400/90 to-yellow-500/90",
  },
  {
    name: "Person mit CO-Verdacht",
    requirements: { LF: 1, RTW: 1, ELW: 1 },
    emoji: "🧯",
    color: "from-sky-500/90 to-cyan-500/90",
  },
  {
    name: "Wasserschaden",
    requirements: { LF: 1 },
    emoji: "💧",
    color: "from-blue-500/90 to-indigo-500/90",
  },
  {
    name: "Brandmeldeanlage",
    requirements: { LF: 1, ELW: 1 },
    emoji: "🚨",
    color: "from-rose-500/90 to-pink-500/90",
  },
];

// Hilfsfunktionen
function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return Date.now();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function readableMs(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${s}s`;
}

// --- Hauptkomponente ---
export default function FireICGame() {
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [clock, setClock] = useState(0); // seit Start in ms

  const [pool, setPool] = useState(() =>
    START_UNITS.map((u) => ({ ...u, status: "ready", busyUntil: 0, task: null }))
  );
  const [incidents, setIncidents] = useState([]);

  const startAtRef = useRef(0);
  const lastTickRef = useRef(0);
  const spawnRef = useRef(0);

  // Game Loop
  useEffect(() => {
    let rafId;
    function tick() {
      const t = now();
      if (!running) {
        lastTickRef.current = t;
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (lastTickRef.current === 0) lastTickRef.current = t;
      const dt = t - lastTickRef.current;
      lastTickRef.current = t;

      setClock((c) => c + dt);

      // Spawner
      spawnRef.current += dt;
      if (spawnRef.current >= GAME_CONFIG.spawnEveryMs) {
        spawnRef.current = 0;
        setIncidents((list) => {
          if (list.length >= GAME_CONFIG.maxOpenIncidents) return list;
          return [...list, createIncident()];
        });
      }

      // Release Units when busyUntil reached
      setPool((p) => {
        const np = p.map((u) => {
          if (u.status !== "busy") return u;
          if (t >= u.busyUntil) {
            return { ...u, status: "ready", busyUntil: 0, task: null };
          }
          return u;
        });
        return np;
      });

      // Update incidents (timeouts, resolve progress)
      setIncidents((list) => list.map(updateIncidentProgress(t)));

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [running]);

  // Einsatz erzeugen
  function createIncident() {
    const tpl = INCIDENT_TEMPLATES[Math.floor(Math.random() * INCIDENT_TEMPLATES.length)];
    const id = uid("einsatz");
    const createdAt = now();
    const deadline = createdAt + GAME_CONFIG.baseResolveMs + GAME_CONFIG.deadlineGraceMs + Math.floor(Math.random() * 10000);
    return {
      id,
      name: tpl.name,
      emoji: tpl.emoji,
      color: tpl.color,
      requirements: tpl.requirements, // z.B. { LF: 2, DLK: 1 }
      assigned: {}, // { LF: [unitId,...] }
      status: "open", // open -> working -> done/missed
      createdAt,
      deadline,
      startedAt: null,
      progress: 0,
      lastUpdate: createdAt,
      message: "",
    };
  }

  // Fortschritt updaten und Scoring
  function updateIncidentProgress(t) {
    return (inc) => {
      if (inc.status === "done" || inc.status === "missed") return inc;

      // Deadline verpasst?
      if (t > inc.deadline && inc.status !== "working") {
        // Missed (nicht rechtzeitig begonnen)
        if (inc.status !== "missed") {
          setScore((s) => s + GAME_CONFIG.points.missedPenalty);
        }
        return { ...inc, status: "missed", message: "Einsatz eskaliert (zu spät begonnen)." };
      }

      // Wenn working: Fortschritt steigern
      if (inc.status === "working") {
        const dt = t - (inc.lastUpdate || t);
        const newProg = Math.min(1, inc.progress + dt / GAME_CONFIG.baseResolveMs);
        let finished = false;
        let updated = { ...inc, progress: newProg, lastUpdate: t };
        if (newProg >= 1) {
          finished = true;
        }
        if (finished) {
          // Punkte vergeben je nach Deadline
          const onTime = t <= inc.deadline;
          setScore((s) => s + (onTime ? GAME_CONFIG.points.onTime : GAME_CONFIG.points.slowPenalty));
          return { ...updated, status: "done", message: onTime ? "Abarbeitung rechtzeitig." : "Abarbeitung verspätet." };
        }
        return updated;
      }

      return { ...inc, lastUpdate: t };
    };
  }

  // Prüfen, ob Anforderungen erfüllt sind
  function requirementsMet(inc) {
    return Object.entries(inc.requirements).every(([type, need]) => (inc.assigned[type]?.length || 0) >= need);
  }

  // Einheit zuweisen
  function assignUnit(incidentId, type) {
    const unitIndex = pool.findIndex((u) => u.type === type && u.status === "ready");
    if (unitIndex === -1) return; // keine freie Einheit

    const unit = pool[unitIndex];
    const t = now();

    // Einheit auf Anfahrt setzen (busy bis Ankunft)
    const arrival = t + GAME_CONFIG.travelMs;
    const updatedUnit = { ...unit, status: "busy", busyUntil: arrival, task: { incidentId, phase: "to-scene" } };
    const newPool = clone(pool);
    newPool[unitIndex] = updatedUnit;
    setPool(newPool);

    // am Einsatz ankommen -> der Einsatz "merkt" die Einheit erst bei Ankunft
    setTimeout(() => {
      setIncidents((list) =>
        list.map((inc) => {
          if (inc.id !== incidentId || (inc.status !== "open" && inc.status !== "working")) return inc;
          const assigned = clone(inc.assigned);
          assigned[type] = [...(assigned[type] || []), unit.id];
          let status = inc.status;
          let startedAt = inc.startedAt;
          let message = `${unit.id} eingetroffen (${type}).`;
          if (requirementsMet({ ...inc, assigned }) && inc.status !== "working") {
            status = "working";
            startedAt = now();
          }
          return { ...inc, assigned, status, startedAt, lastUpdate: now(), message };
        })
      );

      // Einheit bleibt bis Einsatzende und Rückfahrt gebunden
      const donePlusReturn = GAME_CONFIG.baseResolveMs + GAME_CONFIG.travelMs;
      setPool((p) =>
        p.map((u) =>
          u.id === unit.id ? { ...u, status: "busy", busyUntil: now() + donePlusReturn, task: { incidentId, phase: "at-scene" } } : u
        )
      );
    }, GAME_CONFIG.travelMs);

    // kleines Feedback
    setScore((s) => s + GAME_CONFIG.points.assign);
  }

  function unassignUnit(incidentId, type, unitId) {
    // Nur zulassen, wenn Einsatz noch nicht arbeitet
    setIncidents((list) =>
      list.map((inc) => {
        if (inc.id !== incidentId || inc.status !== "open") return inc;
        const assigned = clone(inc.assigned);
        assigned[type] = (assigned[type] || []).filter((id) => id !== unitId);
        return { ...inc, assigned, message: `${unitId} abgezogen.` };
      })
    );
  }

  function resetGame() {
    setRunning(false);
    setScore(0);
    setClock(0);
    setPool(START_UNITS.map((u) => ({ ...u, status: "ready", busyUntil: 0, task: null })));
    setIncidents([]);
    startAtRef.current = 0;
    lastTickRef.current = 0;
    spawnRef.current = 0;
  }

  const availableByType = useMemo(() => {
    const map = Object.fromEntries(UNIT_TYPES.map((t) => [t.key, 0]));
    pool.forEach((u) => {
      if (u.status === "ready") map[u.type]++;
    });
    return map;
  }, [pool]);

  const openIncidents = incidents.filter((i) => i.status === "open" || i.status === "working");

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🚒 Einsatzleiter – Feuerwehr</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRunning((r) => !r)}
              className={`px-4 py-2 rounded-2xl shadow ${
                running ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-500 hover:bg-emerald-600"
              }`}
            >
              {running ? "Pause" : "Start"}
            </button>
            <button onClick={resetGame} className="px-4 py-2 rounded-2xl shadow bg-slate-700 hover:bg-slate-600">Reset</button>
          </div>
        </header>

        <TopBar score={score} clock={clock} openCount={openIncidents.length} pool={pool} />

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <UnitPool panelTitle="Verfügbare Kräfte" pool={pool} availableByType={availableByType} />
          <IncidentList
            incidents={incidents}
            onAssign={assignUnit}
            onUnassign={unassignUnit}
            availableByType={availableByType}
          />
          <HelpPanel />
        </section>
      </div>
    </div>
  );
}

function TopBar({ score, clock, openCount, pool }) {
  const ready = pool.filter((u) => u.status === "ready").length;
  const busy = pool.length - ready;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatBox title="Punkte" value={score} />
      <StatBox title="Spielzeit" value={readableMs(clock)} />
      <StatBox title="Offene Einsätze" value={openCount} />
      <StatBox title="Kräfte (frei/gesamt)" value={`${ready}/${pool.length}`} sub={`${busy} gebunden`} />
    </div>
  );
}

function StatBox({ title, value, sub }) {
  return (
    <div className="rounded-2xl p-4 bg-slate-900/70 border border-slate-800 shadow">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function UnitPool({ panelTitle, pool, availableByType }) {
  return (
    <div className="rounded-2xl p-4 bg-slate-900/60 border border-slate-800 shadow space-y-3">
      <h2 className="font-semibold">{panelTitle}</h2>
      <div className="flex flex-wrap gap-2 text-xs">
        {UNIT_TYPES.map((t) => (
          <span key={t.key} className="px-2 py-1 rounded-xl bg-slate-800 border border-slate-700">
            {t.key}: {availableByType[t.key]}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {pool.map((u) => (
          <div key={u.id} className={`rounded-xl p-2 border text-sm ${u.status === "ready" ? "bg-slate-800/80 border-slate-700" : "bg-slate-800/40 border-slate-800 text-slate-400"}`}>
            <div className="font-medium">{u.id}</div>
            <div className="text-xs">Typ: {u.type}</div>
            <div className="text-xs">{u.status === "ready" ? "einsatzbereit" : `gebunden (${readableMs(u.busyUntil - now())})`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IncidentList({ incidents, onAssign, onUnassign, availableByType }) {
  return (
    <div className="lg:col-span-2 space-y-3">
      {incidents.length === 0 && (
        <div className="rounded-2xl p-6 border border-slate-800 bg-slate-900/60 text-slate-300">Noch keine Einsätze – klicke auf „Start“.</div>
      )}
      {incidents.map((i) => (
        <IncidentCard key={i.id} i={i} onAssign={onAssign} onUnassign={onUnassign} availableByType={availableByType} />
      ))}
    </div>
  );
}

function IncidentCard({ i, onAssign, onUnassign, availableByType }) {
  const requirementsEntries = Object.entries(i.requirements);
  const allMet = requirementsEntries.every(([t, need]) => (i.assigned[t]?.length || 0) >= need);

  return (
    <div className={`rounded-2xl overflow-hidden border shadow bg-gradient-to-r ${i.color} border-slate-900`}>
      <div className="p-4 sm:p-5 backdrop-blur bg-slate-950/50">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm uppercase tracking-wide text-slate-300">{i.id}</div>
            <div className="text-xl font-bold flex items-center gap-2">{i.emoji} {i.name}</div>
          </div>
          <StatusBadge i={i} />
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
            <div className="text-xs text-slate-300 mb-1">Anforderungen</div>
            <div className="flex flex-wrap gap-1 text-xs">
              {requirementsEntries.map(([type, need]) => {
                const have = i.assigned[type]?.length || 0;
                return (
                  <span key={type} className={`px-2 py-1 rounded-lg border ${have >= need ? "bg-emerald-600/30 border-emerald-500/50" : "bg-slate-800 border-slate-700"}`}>
                    {type}: {have}/{need}
                  </span>
                );
              })}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {requirementsEntries.map(([type, need]) => (
                <button
                  key={type}
                  onClick={() => onAssign(i.id, type)}
                  disabled={availableByType[type] <= 0}
                  className={`px-3 py-1.5 rounded-xl text-sm shadow border ${
                    availableByType[type] > 0 ? "bg-slate-800 hover:bg-slate-700 border-slate-700" : "bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed"
                  }`}
                >
                  {type} zuweisen
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
            <div className="text-xs text-slate-300 mb-1">Zeit & Status</div>
            <div className="text-sm">Deadline: in {readableMs(i.deadline - now())}</div>
            <div className="text-sm">Status: {labelForStatus(i.status)}</div>
            {i.status === "working" && (
              <div className="w-full h-2 bg-slate-800 rounded mt-2 overflow-hidden">
                <div className="h-2 bg-emerald-500" style={{ width: `${Math.round(i.progress * 100)}%` }} />
              </div>
            )}
            {i.message && <div className="text-xs text-slate-400 mt-2">{i.message}</div>}
          </div>
        </div>

        {Object.entries(i.assigned).some(([_, arr]) => (arr?.length || 0) > 0) && i.status === "open" && (
          <div className="mt-3 text-xs text-slate-300">
            Hinweis: Abziehen ist nur möglich, solange der Einsatz noch nicht arbeitet.
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(i.assigned).flatMap(([type, arr]) =>
                (arr || []).map((unitId) => (
                  <button
                    key={unitId}
                    onClick={() => onUnassign(i.id, type, unitId)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700"
                  >
                    {unitId} abziehen
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {i.status === "done" && (
          <div className="mt-3 text-emerald-300 text-sm">Einsatz abgeschlossen ✅</div>
        )}
        {i.status === "missed" && (
          <div className="mt-3 text-rose-200 text-sm">Einsatz eskaliert ❌</div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ i }) {
  let label = labelForStatus(i.status);
  let cls = "bg-slate-800 border-slate-700";
  if (i.status === "working") cls = "bg-amber-500/20 border-amber-400/40 text-amber-200";
  if (i.status === "done") cls = "bg-emerald-500/20 border-emerald-400/40 text-emerald-200";
  if (i.status === "missed") cls = "bg-rose-500/20 border-rose-400/40 text-rose-200";
  return (
    <span className={`text-xs px-2 py-1 rounded-lg border ${cls}`}>{label}</span>
  );
}

function labelForStatus(s) {
  return s === "open" ? "offen" : s === "working" ? "in Arbeit" : s === "done" ? "abgeschlossen" : "eskaliert";
}
