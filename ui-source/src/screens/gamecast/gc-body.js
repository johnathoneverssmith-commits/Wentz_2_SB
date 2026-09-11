  const DATA = JSON.parse(document.getElementById("game-data").textContent);

  const TC = {
    ARI:"#97233f",ATL:"#a71930",BAL:"#241773",BUF:"#00338d",CAR:"#0085ca",CHI:"#0b162a",
    CIN:"#fb4f14",CLE:"#311d00",DAL:"#003594",DEN:"#fb4f14",DET:"#0076b6",GB:"#203731",
    HOU:"#03202f",IND:"#002c5f",JAX:"#006778",KC:"#e31837",LV:"#101010",LAC:"#0080c6",
    LAR:"#003594",MIA:"#008e97",MIN:"#4f2683",NE:"#002244",NO:"#a08658",NYG:"#0b2265",
    NYJ:"#125740",PHI:"#004c54",PIT:"#ffb612",SEA:"#002244",SF:"#aa0000",TB:"#d50a0a",
    TEN:"#0c2340",WAS:"#5a1414",
  };
  const NICK = {
    ARI:"CARDINALS",ATL:"FALCONS",BAL:"RAVENS",BUF:"BILLS",CAR:"PANTHERS",CHI:"BEARS",
    CIN:"BENGALS",CLE:"BROWNS",DAL:"COWBOYS",DEN:"BRONCOS",DET:"LIONS",GB:"PACKERS",
    HOU:"TEXANS",IND:"COLTS",JAX:"JAGUARS",KC:"CHIEFS",LV:"RAIDERS",LAC:"CHARGERS",
    LAR:"RAMS",MIA:"DOLPHINS",MIN:"VIKINGS",NE:"PATRIOTS",NO:"SAINTS",NYG:"GIANTS",
    NYJ:"JETS",PHI:"EAGLES",PIT:"STEELERS",SEA:"SEAHAWKS",SF:"49ERS",TB:"BUCCANEERS",
    TEN:"TITANS",WAS:"COMMANDERS",
  };
  const col = (t) => TC[t] || "#717c70";
  const nick = (t) => NICK[t] || t;
  const other = (t) => (t === DATA.home ? DATA.away : DATA.home);

  // ---- geometry ----
  const OWN = 100, TARGET = 900, U = (TARGET - OWN) / 100;   // 8 units / yard
  const EZ = 80, TOP = 50, BOT = 450, LANE = 250;
  // left→right x for "yards to the attacking end zone"
  const xLR = (ballOn) => OWN + (100 - Math.max(0, Math.min(100, ballOn))) * U;
  const clampX = (x) => Math.max(OWN - EZ + 10, Math.min(TARGET + EZ - 10, x));

  /**
   * Real NFL: teams switch ends after every quarter. Fix the home team as
   * attacking left→right in Q1; then odd quarters = home drives right, even =
   * home drives left. A drive's ball moves toward the attacking end zone.
   */
  const homeAttacksRight = (q) => q % 2 === 1;
  const driveAttacksRight = (side, q) => (side === "home") === homeAttacksRight(q);

  // ---- flatten the whole game into steps: one "pre-snap" beat per drive,
  // then one beat per play. gi (0..STEPS.length) is how many steps have
  // been revealed; this is what makes the *whole* game (not just scoring
  // drives) play out continuously, pausing only at quarter/injury beats.
  const STEPS = [];
  const driveStepStart = [];
  DATA.drives.forEach((d, k) => {
    driveStepStart[k] = STEPS.length;
    STEPS.push({ type: "presnap", k, quarter: d.quarter });
    d.plays.forEach((p, j) => STEPS.push({ type: "play", k, j, p, quarter: p.quarter }));
  });
  const TOTAL = STEPS.length;

  // ---- state ----
  let gi = 1;              // steps revealed; starts on drive 0's pre-snap
  let playing = false;
  let timer = null;
  let speed = 1;
  let lastQuarterShown = STEPS[0].quarter;
  const pending = [];      // queued interstitials: {kind:"quarter",quarter} | {kind:"injury",event}

  const curStep = () => STEPS[gi - 1];
  const curDrive = () => DATA.drives[curStep().k];
  const pi = () => gi - driveStepStart[curStep().k] - 1; // plays revealed within current drive

  const spot = (ballOn) => {
    if (Math.abs(ballOn - 50) < 0.5) return "midfield";
    const y = Math.round(ballOn > 50 ? 100 - ballOn : ballOn);
    return `${ballOn > 50 ? "own" : "opp"} ${y}`;
  };
  const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th");
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const pspan = (name) => (name ? `<span class="player">${esc(name)}</span>` : "");

  // narrated play description with colored player names (built fresh here —
  // the engine's `desc` has no names, by design, so the UI splices them in)
  function describePlay(p) {
    if (p.call === "field_goal") {
      const k = pspan(p.kicker);
      return p.outcome === "made"
        ? `${k} ${p.distance}-yard field goal is GOOD`
        : `${k} ${p.distance}-yard field goal attempt is NO GOOD`;
    }
    if (p.call === "punt") {
      const k = pspan(p.kicker), r = pspan(p.returner);
      if (p.outcome === "touchback") return `${k} punts ${p.distance} yards, touchback`;
      if (p.outcome === "return_td") return `${k} punts ${p.distance} yards &mdash; returned by ${r} for a TOUCHDOWN`;
      if (p.outcome === "downed") return `${k} punts ${p.distance} yards, downed`;
      return `${k} punts ${p.distance} yards, returned by ${r}`;
    }
    const g = Math.round(p.gained);
    const to = p.touchdown ? "the end zone" : `the ${spot(Math.max(1, p.ballOn - p.gained))}`;
    const passer = pspan(p.passer), target = pspan(p.targetOrRusher), defender = pspan(p.defender);
    let s;
    if (p.call === "sack") s = `${passer} sacked for ${g} to ${to}`;
    else if (p.call === "scramble") s = `${passer} scrambles for ${g >= 0 ? "+" : ""}${g} to ${to}`;
    else if (p.call === "run") s = `${target} run for ${g >= 0 ? "+" : ""}${g} to ${to}`;
    else if (p.outcome === "interception") s = `${passer} pass intercepted by ${defender}`;
    else if (g === 0 && !p.touchdown) s = `${passer} incomplete for ${target} (${p.depth.toLowerCase().replace(/_/g, " ")})`;
    else s = `${passer} complete to ${target} for ${g} to ${to}`;
    if (p.outcome === "fumble") s += ` &mdash; fumble, forced by ${defender}`;
    if (p.touchdown) s += " &mdash; TOUCHDOWN";
    else if (p.firstDown) s += " (1st down)";
    else if (p.turnover && p.call !== "sack" && p.outcome !== "interception" && p.outcome !== "fumble") s += " &mdash; TURNOVER";
    return s;
  }

  // ---- static field paint (once): turf, yard lines, numbers, FG posts ----
  function buildField() {
    const NUM = { 10:"10",20:"20",30:"30",40:"40",50:"50",60:"40",70:"30",80:"20",90:"10" };
    let s = "";
    s += `<rect x="0" y="${TOP}" width="1000" height="${BOT - TOP}" fill="var(--turf)"/>`;
    s += `<rect id="ezL" x="${OWN - EZ}" y="${TOP}" width="${EZ}" height="${BOT - TOP}" fill="var(--turf-2)"/>`;
    s += `<rect id="ezR" x="${TARGET}" y="${TOP}" width="${EZ}" height="${BOT - TOP}" fill="var(--turf-2)"/>`;
    for (let m = 0; m <= 100; m += 5) {
      const x = OWN + m * U, major = m % 10 === 0;
      s += `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${BOT}" stroke="var(--turf-line)" stroke-opacity="${major ? .8 : .4}" stroke-width="${major ? 2 : 1}"/>`;
    }
    for (const x of [OWN, TARGET]) s += `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${BOT}" stroke="var(--turf-line)" stroke-width="3"/>`;
    s += `<rect x="${OWN - EZ}" y="${TOP}" width="${(TARGET + EZ) - (OWN - EZ)}" height="${BOT - TOP}" fill="none" stroke="var(--turf-line)" stroke-width="3"/>`;
    for (const y of [180, 320]) for (let m = 1; m < 100; m++) {
      if (m % 5 === 0) continue;
      const x = OWN + m * U;
      s += `<line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}" stroke="var(--turf-line)" stroke-opacity=".45" stroke-width="1"/>`;
    }
    for (const m in NUM) {
      const x = OWN + Number(m) * U;
      s += `<text x="${x}" y="108" text-anchor="middle" font-family="Oswald,sans-serif" font-weight="600" font-size="32" letter-spacing="3" fill="var(--turf-line)" fill-opacity=".62">${NUM[m]}</text>`;
      s += `<text x="${x}" y="402" text-anchor="middle" font-family="Oswald,sans-serif" font-weight="600" font-size="32" letter-spacing="3" fill="var(--turf-line)" fill-opacity=".62" transform="rotate(180 ${x} 396)">${NUM[m]}</text>`;
    }
    // field goal posts — regulation yellow "slingshot", at the back of each end zone
    const post = (x) => `<g>
      <ellipse cx="${x}" cy="${LANE + 4}" rx="12" ry="4" fill="#000" opacity=".22"/>
      <path d="M ${x} ${LANE} L ${x} 172" stroke="#000" stroke-opacity=".16" stroke-width="9" stroke-linecap="round"/>
      <g fill="none" stroke="#ffc324" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M ${x} ${LANE} L ${x} 172 Q ${x} 158 ${x - 18} 158 L ${x - 32} 158 L ${x - 32} 84"/>
        <path d="M ${x} 172 Q ${x} 158 ${x + 18} 158 L ${x + 32} 158 L ${x + 32} 84"/>
      </g>
      <circle cx="${x - 32}" cy="82" r="3" fill="#ffc324"/>
      <circle cx="${x + 32}" cy="82" r="3" fill="#ffc324"/></g>`;
    s += post(OWN - EZ) + post(TARGET + EZ);
    s += `<defs>
      <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--chalk)"/></marker>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>`;
    s += `<g id="ezLabelL"></g><g id="ezLabelR"></g><g id="dyn"></g>`;
    document.getElementById("field").innerHTML = s;
  }

  // bigger ball + a possession ring/chip color-coded to the team with it
  const ball = (x, y, team, glow) => `
    <g transform="translate(${x} ${y})" ${glow ? 'filter="url(#glow)"' : ""}>
      <ellipse rx="27" ry="17.5" fill="none" stroke="${col(team)}" stroke-width="4"/>
      <ellipse rx="21.5" ry="13.5" fill="#7a3c14" stroke="#2b1405" stroke-width="2.2"/>
      <line x1="-9.5" y1="0" x2="9.5" y2="0" stroke="#f4ead9" stroke-width="2.6"/>
      <line x1="-5.2" y1="-4.2" x2="-5.2" y2="4.2" stroke="#f4ead9" stroke-width="2.1"/>
      <line x1="0" y1="-4.8" x2="0" y2="4.8" stroke="#f4ead9" stroke-width="2.1"/>
      <line x1="5.2" y1="-4.2" x2="5.2" y2="4.2" stroke="#f4ead9" stroke-width="2.1"/>
    </g>
    <g transform="translate(${x} ${y - 36})">
      <rect x="-24" y="-14" width="48" height="25" rx="6" fill="${col(team)}"/>
      <text text-anchor="middle" y="5" font-family="Oswald,sans-serif" font-weight="700" font-size="16"
        letter-spacing=".5" fill="#fff">${team}</text>
    </g>`;

  const DEPTH_PX = { BEHIND_LOS: 20, SHORT: 60, INTERMEDIATE: 110, DEEP: 170, "": 45 };

  // arrow for one play; `Xf` maps yards→x, `atkRight` gives the drive's heading
  function segPath(p, Xf, atkRight) {
    const x0 = clampX(Xf(p.ballOn));
    const x1 = clampX(Xf(p.ballOn - p.gained));
    if (p.call === "field_goal") {
      const postX = atkRight ? TARGET + EZ - 14 : OWN - EZ + 14;
      const mx = (x0 + postX) / 2;
      return { d: `M ${x0} ${LANE} Q ${mx} 128 ${postX} 150`, end: [postX, 150], kind: p.outcome === "made" ? "fg-good" : "fg-no" };
    }
    if (p.call === "punt") {
      const mx = (x0 + x1) / 2;
      const h = Math.min(175, 75 + Math.abs(p.gained) * 1.7);
      return { d: `M ${x0} ${LANE} Q ${mx} ${LANE - h} ${x1} ${LANE}`, end: [x1, LANE], kind: "punt" };
    }
    const pass = p.call === "pass";
    const incomplete = pass && p.gained === 0 && !p.touchdown && p.outcome !== "interception";
    const picked = p.outcome === "interception";
    if (incomplete || picked) {
      const reach = (DEPTH_PX[p.depth] || 60) * (atkRight ? 1 : -1);
      const tx = clampX(x0 + reach);
      return { d: `M ${x0} ${LANE} Q ${(x0 + tx) / 2} ${LANE - Math.abs(reach) * 1.1} ${tx} ${LANE}`, end: [(x0 + tx) / 2, LANE - Math.abs(reach) * 0.7], kind: picked ? "int" : "inc" };
    }
    if (pass) {
      const mx = (x0 + x1) / 2;
      const h = Math.min(150, 44 + Math.abs(p.gained) * 3.2);
      return { d: `M ${x0} ${LANE} Q ${mx} ${LANE - h} ${x1} ${LANE}`, end: [x1, LANE], kind: "pass" };
    }
    return { d: `M ${x0} ${LANE} L ${x1} ${LANE}`, end: [x1, LANE], kind: "run" };
  }

  // ---- chrome (board, drive list, injuries) ----
  function renderBoard() {
    const [hs, as] = DATA.finalScore;
    const done = gi >= TOTAL;
    const status = done ? "Final" : gi <= 1 ? "Pre-game" : `Q${curStep().quarter}`;
    document.getElementById("board").innerHTML = `
      <div class="team away" style="--tc:${col(DATA.away)}">
        <span class="chip"></span><span class="code">${DATA.away}</span><span class="score">${as}</span></div>
      <div class="mid"><span class="status${done ? "" : " live"}">${status}</span><span class="situ" id="situ"></span></div>
      <div class="team home" style="--tc:${col(DATA.home)}">
        <span class="chip"></span><span class="code">${DATA.home}</span><span class="score">${hs}</span></div>`;
    document.getElementById("matchup").textContent = `${DATA.away} at ${DATA.home}`;
  }

  function renderDriveList() {
    document.getElementById("drivecount").textContent = `${DATA.drives.length} drives`;
    document.getElementById("drivelist").innerHTML = DATA.drives.map((dr, k) => {
      const tag = dr.ended === "touchdown" || dr.ended === "punt_return_td" ? '<span class="d-tag td">TD</span>'
        : dr.ended === "field_goal" ? '<span class="d-tag td">FG</span>'
        : dr.ended === "missed_field_goal" ? '<span class="d-tag to">MISS</span>'
        : dr.ended === "punt" ? '<span class="d-tag special">PUNT</span>'
        : dr.ended === "turnover" ? '<span class="d-tag to">TO</span>' : "";
      return `<button class="drive" data-k="${k}" aria-current="${k === curStep().k}" style="--tc:${col(dr.team)}">
        <span class="d-team">${dr.team}</span>
        <span class="d-when">Q${dr.quarter} ${dr.startClock}</span>
        <span class="d-meta">${dr.plays.length} plays &middot; from the ${spot(dr.startBallOn)}${tag}</span>
      </button>`;
    }).join("");
  }

  // injuries reveal progressively as the replay passes them — no spoilers
  function revealedInjuries() {
    const out = [];
    for (let s = 0; s < gi; s++) {
      const st = STEPS[s];
      if (st.type === "play" && st.p.injuries.length) out.push(...st.p.injuries);
    }
    return out;
  }
  function renderInjuries() {
    const seen = revealedInjuries();
    document.getElementById("injcount").textContent = seen.length ? `${seen.length} so far` : "";
    const box = document.getElementById("injuries");
    if (!seen.length) { box.innerHTML = `<div class="empty">No injuries yet &mdash; the report fills in live as the game plays out.</div>`; return; }
    box.innerHTML = seen.map((e) => {
      const [lo, hi] = e.projectedWeeks;
      const wk = e.severity === "season" ? "out for the year" : lo === hi ? `${lo} wk` : `${lo}–${hi} wk`;
      return `<div class="inj" data-sev="${e.severity}">
        <span class="stripe"></span>
        <div>
          <div class="top"><span class="who" style="border-left:3px solid ${col(e.team)};padding-left:7px">${esc(e.player)}</span>
            <span class="tag">${e.team} &middot; Q${e.quarter} ${e.clock}</span></div>
          <div class="body">${esc(e.narrative)}</div>
          <span class="wk">${wk}</span>
        </div></div>`;
    }).reverse().join("");
  }

  // ---- transport shell (once) ----
  function buildTransport() {
    const ic = { prev:"M13 4 5 12l8 8V4z M4 4h2v16H4z", next:"M7 4l8 8-8 8V4z M18 4h2v16h-2z",
      play:"M6 4l14 8-14 8V4z", pause:"M6 4h4v16H6z M14 4h4v16h-4z" };
    document.getElementById("transport").innerHTML = `
      <button data-a="prev" aria-label="previous step"><svg viewBox="0 0 24 24"><path d="${ic.prev}"/></svg></button>
      <button class="play" data-a="toggle" aria-label="play"><svg id="ppIcon" viewBox="0 0 24 24"><path d="${ic.play}"/></svg></button>
      <button data-a="next" aria-label="next step"><svg viewBox="0 0 24 24"><path d="${ic.next}"/></svg></button>
      <div class="scrub">
        <input type="range" min="1" value="1" aria-label="game position">
        <span class="count"></span>
      </div>
      <select id="speed" aria-label="playback speed">
        <option value="0.5">0.5&times;</option>
        <option value="1" selected>1&times;</option>
        <option value="2">2&times;</option>
      </select>
      <button class="skip" data-a="skip">Skip to final</button>`;
    document.getElementById("transport").dataset.play = ic.play;
    document.getElementById("transport").dataset.pause = ic.pause;
  }
  function updateTransport() {
    const T = document.getElementById("transport");
    T.querySelector('[data-a="prev"]').disabled = gi <= 1;
    T.querySelector('[data-a="next"]').disabled = gi >= TOTAL;
    T.querySelector('[data-a="skip"]').disabled = gi >= TOTAL;
    T.querySelector('#ppIcon path').setAttribute("d", playing ? T.dataset.pause : T.dataset.play);
    T.querySelector('.play').setAttribute("aria-label", playing ? "pause" : "play");
    const r = T.querySelector('input[type=range]');
    r.max = TOTAL;
    if (document.activeElement !== r) r.value = gi;
    T.querySelector('.count').textContent = `${gi} / ${TOTAL}`;
  }

  // ---- field + play readout (per step) ----
  function renderPlay() {
    const st = curStep(), d = curDrive();
    const atkRight = driveAttacksRight(d.side, d.quarter);
    const Xf = (ballOn) => (atkRight ? xLR(ballOn) : 1000 - xLR(ballOn));
    const dTeam = d.team, defTeam = other(dTeam);

    const n = pi(); // plays of the current drive revealed so far
    const revealed = d.plays.slice(0, n);
    const cur = st.type === "play" ? st.p : null;
    const next = n < d.plays.length ? d.plays[n] : null;
    const ballOn = cur ? (cur.touchdown ? 0 : Math.max(0, cur.ballOn - cur.gained)) : d.startBallOn;
    const turnedOver = cur && (cur.outcome === "interception" || cur.outcome === "fumble" || cur.call === "punt");
    const driveEnded = cur && (cur.touchdown || cur.call === "punt" || cur.call === "field_goal");
    const possessor = turnedOver ? defTeam : dTeam;
    const targetEZx = atkRight ? TARGET + EZ / 2 : OWN - EZ / 2;
    const postX = atkRight ? TARGET + EZ - 14 : OWN - EZ + 14;
    const fgGood = cur && cur.call === "field_goal" && cur.outcome === "made";
    let bx = cur && cur.touchdown ? targetEZx : clampX(Xf(ballOn));
    let by = LANE;
    if (cur && cur.call === "field_goal") { bx = postX; by = 150; }

    let dyn = "";
    const chevron = atkRight ? "▶" : "◀";
    dyn += `<g transform="translate(${atkRight ? OWN + 10 : TARGET - 10} ${TOP - 22})">
      <text text-anchor="${atkRight ? "start" : "end"}" font-family="Oswald,sans-serif" font-weight="600"
        font-size="15" letter-spacing="1.5" fill="var(--ink-2)">${atkRight ? dTeam + " driving " + chevron : chevron + " " + dTeam + " driving"}</text></g>`;

    const marker = next || cur;
    if (marker && !driveEnded) {
      const losX = clampX(Xf(marker.ballOn));
      const fd = marker.ballOn - marker.ydstogo;
      dyn += `<line x1="${losX}" y1="${TOP + 4}" x2="${losX}" y2="${BOT - 4}" stroke="var(--los)" stroke-width="2.5" stroke-dasharray="2 5"/>`;
      if (fd > 0) {
        const fdX = clampX(Xf(fd));
        dyn += `<line x1="${fdX}" y1="${TOP + 4}" x2="${fdX}" y2="${BOT - 4}" stroke="var(--first)" stroke-width="2.5"/>`;
      }
    }
    const SEG_LABEL = { int: "INTERCEPTED", inc: "incomplete", "fg-good": "GOOD", "fg-no": "NO GOOD" };
    revealed.forEach((p, j) => {
      const seg = segPath(p, Xf, atkRight);
      const last = j === revealed.length - 1;
      const stroke = seg.kind === "int" || seg.kind === "fg-no" ? "var(--injury)"
        : seg.kind === "fg-good" ? "var(--chalk)"
        : seg.kind === "punt" ? "var(--special)"
        : "var(--chalk)";
      const dash = seg.kind === "inc" ? "6 7" : seg.kind === "int" ? "8 7"
        : seg.kind === "punt" ? "4 9" : seg.kind === "fg-good" || seg.kind === "fg-no" ? "3 8" : "0";
      const head = last && (seg.kind === "run" || seg.kind === "pass" || seg.kind === "punt");
      dyn += `<path d="${seg.d}" fill="none" stroke="${stroke}" stroke-linecap="round"
        stroke-width="${last ? 7 : 3.2}" stroke-opacity="${last ? 1 : .32}" stroke-dasharray="${dash}"
        ${head ? 'marker-end="url(#ah)"' : ""}/>`;
      if (last && SEG_LABEL[seg.kind])
        dyn += `<text x="${seg.end[0]}" y="${seg.end[1] - 12}" text-anchor="middle"
          font-family="IBM Plex Mono" font-weight="600" font-size="19" fill="${stroke}">${SEG_LABEL[seg.kind]}</text>`;
      else if (last && seg.kind === "punt")
        dyn += `<text x="${seg.end[0]}" y="${LANE - Math.min(175, 75 + Math.abs(p.gained) * 1.7) - 10}" text-anchor="middle"
          font-family="IBM Plex Mono" font-weight="600" font-size="17" fill="var(--special)">PUNT</text>`;
    });
    dyn += ball(bx, by, possessor, (cur && cur.touchdown) || fgGood);
    document.getElementById("dyn").innerHTML = dyn;

    const set = (id, fill) => document.getElementById(id).setAttribute("fill", fill);
    const scored = (cur && cur.touchdown) || fgGood;
    set(atkRight ? "ezR" : "ezL", `color-mix(in srgb, ${col(dTeam)} ${scored ? 60 : 42}%, var(--turf-2))`);
    set(atkRight ? "ezL" : "ezR", `color-mix(in srgb, ${col(defTeam)} 42%, var(--turf-2))`);
    const ezLabel = (id, x, team) =>
      document.getElementById(id).innerHTML =
        `<text x="${x}" y="${(TOP + BOT) / 2}" text-anchor="middle" transform="rotate(-90 ${x} ${(TOP + BOT) / 2})"
          font-family="Oswald,sans-serif" font-weight="700" font-size="29" letter-spacing="4"
          fill="var(--turf-ink)" fill-opacity=".92">${nick(team)}</text>`;
    ezLabel("ezLabelL", OWN - EZ / 2, atkRight ? defTeam : dTeam);
    ezLabel("ezLabelR", TARGET + EZ / 2, atkRight ? dTeam : defTeam);

    document.getElementById("situ").innerHTML = `Q${d.quarter} &middot; ${st.type === "play" ? cur.clock : d.startClock}`;
    let dd, desc;
    if (!cur) {
      dd = `1st &amp; 10`;
      desc = `${dTeam} takes over at the ${spot(next.ballOn)}`;
    } else if (cur.touchdown) {
      dd = "Touchdown"; desc = describePlay(cur);
    } else if (cur.call === "field_goal") {
      dd = cur.outcome === "made" ? "Field Goal" : "No Good"; desc = describePlay(cur);
    } else if (cur.call === "punt") {
      dd = "Punt"; desc = describePlay(cur);
    } else {
      dd = `${ord(cur.down)} &amp; ${Math.round(cur.ydstogo) || "Goal"} at the ${spot(cur.ballOn)}`;
      desc = describePlay(cur);
    }
    document.getElementById("playline").innerHTML =
      `<span class="dd${scored ? " td" : ""}">${dd}</span><span class="desc">${desc}</span>`;

    updateTransport();
    document.querySelectorAll(".drive").forEach((el) =>
      el.setAttribute("aria-current", +el.dataset.k === st.k));
  }

  function render() { renderBoard(); renderPlay(); renderInjuries(); }

  // ---- interstitials ----
  function showInterstitial() {
    const veil = document.getElementById("veil"), card = document.getElementById("card");
    const it = pending[0];
    if (!it) { veil.hidden = true; return; }
    if (it.kind === "quarter") {
      card.style.setProperty("--tc", "var(--chalk)");
      card.innerHTML = `<p class="kicker">Now starting</p><h2>Quarter ${it.quarter}</h2>
        <p class="sub">${DATA.away} at ${DATA.home} &middot; teams switch ends of the field</p>
        <button class="go" data-go>Continue</button>`;
    } else {
      const e = it.event, [lo, hi] = e.projectedWeeks;
      const wk = e.severity === "season" ? "out for the season" : lo === hi ? `${lo} week${lo === 1 ? "" : "s"}` : `${lo}–${hi} weeks`;
      card.style.setProperty("--tc", "var(--injury)");
      card.innerHTML = `<p class="kicker">${e.team} injury &middot; Q${e.quarter} ${e.clock}</p><h2>${esc(e.player)}</h2>
        <p class="sub">${esc(e.position)} &middot; out for the rest of the game</p>
        <p class="narr">${esc(e.narrative)}</p>
        <span class="wk">Projected: ${wk}</span>
        <button class="go" data-go>Continue</button>`;
    }
    veil.hidden = false;
    card.querySelector("[data-go]").focus();
  }
  function dismissInterstitial() {
    pending.shift();
    if (pending.length) { showInterstitial(); return; }
    document.getElementById("veil").hidden = true;
    if (playing) startTimer();
  }

  // advance one step "organically" (autoplay tick or the Next button):
  // queues a quarter beat and/or injury beats for what it just revealed.
  function revealStep() {
    gi = Math.min(TOTAL, gi + 1);
    const st = curStep();
    if (st.quarter > lastQuarterShown) {
      pending.push({ kind: "quarter", quarter: st.quarter });
      lastQuarterShown = st.quarter;
    }
    if (st.type === "play") for (const e of st.p.injuries) pending.push({ kind: "injury", event: e });
  }

  // random-access move (drive click / scrub): no interstitials, just jump
  function jumpTo(target) {
    haltTimer();
    pending.length = 0;
    document.getElementById("veil").hidden = true;
    gi = Math.max(1, Math.min(TOTAL, target));
    lastQuarterShown = curStep().quarter;
    render();
  }

  function haltTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function startTimer() {
    haltTimer();
    timer = setInterval(() => {
      if (gi >= TOTAL) { haltTimer(); playing = false; render(); return; }
      revealStep();
      render();
      if (pending.length) { haltTimer(); showInterstitial(); }
    }, 1100 / speed);
  }
  function togglePlay() {
    if (playing) { playing = false; haltTimer(); render(); return; }
    if (gi >= TOTAL) jumpTo(1);
    playing = true;
    render();
    startTimer();
  }
  function stepOnce(delta) {
    haltTimer();
    if (delta < 0) { gi = Math.max(1, gi - 1); render(); return; }
    if (gi >= TOTAL) return;
    revealStep();
    render();
    if (pending.length) showInterstitial();
  }
  function skipToEnd() {
    haltTimer();
    playing = false;
    pending.length = 0;
    document.getElementById("veil").hidden = true;
    gi = TOTAL;
    lastQuarterShown = curStep().quarter;
    render();
  }

  document.addEventListener("click", (ev) => {
    const goBtn = ev.target.closest("[data-go]");
    if (goBtn) { dismissInterstitial(); return; }
    const dv = ev.target.closest(".drive");
    if (dv) { jumpTo(driveStepStart[+dv.dataset.k] + 1); return; }
    const b = ev.target.closest("[data-a]");
    if (!b || b.disabled) return;
    if (b.dataset.a === "prev") stepOnce(-1);
    else if (b.dataset.a === "next") stepOnce(1);
    else if (b.dataset.a === "skip") skipToEnd();
    else togglePlay();
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.matches(".scrub input")) { jumpTo(+ev.target.value); return; }
    if (ev.target.id === "speed") {
      speed = +ev.target.value;
      if (playing) startTimer();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.target.matches("input,select")) return;
    if (!document.getElementById("veil").hidden) {
      if (ev.key === " " || ev.key === "Enter") { dismissInterstitial(); ev.preventDefault(); }
      return;
    }
    if (ev.key === "ArrowRight") { stepOnce(1); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { stepOnce(-1); ev.preventDefault(); }
    else if (ev.key === " ") { togglePlay(); ev.preventDefault(); }
  });

  buildField();
  buildTransport();
  renderDriveList();
  render();
})();
