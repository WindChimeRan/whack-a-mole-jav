const $ = (id) => document.getElementById(id);
const holeElements = [...document.querySelectorAll('.hole')];
const visionBoard = $('visionBoard');
const visionContext = visionBoard.getContext('2d', { alpha: false });
const staticVisionBoard = document.createElement('canvas');
staticVisionBoard.width = visionBoard.width;
staticVisionBoard.height = visionBoard.height;
const staticVisionContext = staticVisionBoard.getContext('2d', { alpha: false });
const canvasColumns = [100, 300, 500];
const canvasRows = [86, 225, 364];
const kinds = { mole: { points: 1, label: 'mole' }, gold: { points: 3, label: 'gold mole' }, bomb: { points: -2, label: 'bomb' } };

const settings = { spawnMs: 600, lifeMs: 1100, maxActive: 3, durationSec: 30, samples: 1, seed: 42 };

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const game = {
  phase: 'idle', mode: 'jev', inputMode: 'image', holes: Array(9).fill(null), score: 0,
  hits: 0, missed: 0, bombs: 0, stale: 0, decisions: 0, errors: 0,
  latencies: [], timing: { modelTotal: 0, modelCount: 0, prepTotal: 0, tripTotal: 0, count: 0 },
  startedAt: 0, elapsedMs: 0, pausedAt: 0,
  nextSpawnAt: 0, nextDecisionAt: 0, pending: false, runId: 0,
  controller: null, boardVersion: 0, lastDecisionVersion: 0,
  seed: settings.seed, rng: seededRandom(settings.seed), lastPlanIndex: -1,
  spawnAttempts: 0, spawned: 0, scheduleHash: 2166136261,
};
let connected = false;
let actualModel = 'jev-latest';

function formatSeconds(ms) {
  return `${Number((ms / 1000).toFixed(2))} s`;
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawStaticVisionBoard() {
  const ctx = staticVisionContext;
  ctx.fillStyle = '#2d4938';
  ctx.fillRect(0, 0, 600, 450);
  ctx.fillStyle = '#698361';
  for (let x = 18; x < 600; x += 24) {
    for (let y = 18; y < 450; y += 24) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  for (let index = 0; index < 9; index++) {
    const x = canvasColumns[index % 3];
    const y = canvasRows[Math.floor(index / 3)];
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillStyle = '#dce8c5';
    ctx.fillText(String(index + 1).padStart(2, '0'), x - 82, y - 49);
    ellipse(ctx, x, y + 23, 82, 36, '#71845c');
    ellipse(ctx, x, y + 23, 70, 28, '#0e1d1b');
  }
}

drawStaticVisionBoard();

function drawVisionBoard() {
  const ctx = visionContext;
  const now = Date.now();
  ctx.drawImage(staticVisionBoard, 0, 0);
  game.holes.forEach((hole, index) => {
    const x = canvasColumns[index % 3];
    const y = canvasRows[Math.floor(index / 3)];
    if (!hole) return;

    const life = Math.max(0, Math.min(1, (hole.expiresAt - now) / hole.lifeMs));
    ctx.fillStyle = '#13251d';
    ctx.fillRect(x - 33, y - 67, 80, 6);
    ctx.fillStyle = life < .3 ? '#f18d75' : '#d5ec91';
    ctx.fillRect(x - 33, y - 67, 80 * life, 6);

    if (hole.kind === 'bomb') {
      ellipse(ctx, x, y - 14, 40, 41, '#424a49');
      ellipse(ctx, x - 14, y - 22, 6, 7, '#131b1a');
      ellipse(ctx, x + 14, y - 22, 6, 7, '#131b1a');
      ellipse(ctx, x, y - 1, 7, 6, '#f48e67');
      ctx.strokeStyle = '#f0905c';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 10, y - 50);
      ctx.lineTo(x + 24, y - 74);
      ctx.stroke();
      return;
    }

    const gold = hole.kind === 'gold';
    const body = gold ? '#f3c75c' : '#b97e62';
    ellipse(ctx, x - 29, y - 47, 16, 16, body);
    ellipse(ctx, x + 29, y - 47, 16, 16, body);
    ellipse(ctx, x, y - 19, 41, 47, body);
    ellipse(ctx, x - 15, y - 25, 5, 7, '#1b281e');
    ellipse(ctx, x + 15, y - 25, 5, 7, '#1b281e');
    ellipse(ctx, x, y - 5, 8, 6, gold ? '#8f592f' : '#6d4038');
    if (gold) {
      ctx.strokeStyle = '#ffe791';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 52, y - 53);
      ctx.lineTo(x + 52, y - 27);
      ctx.moveTo(x + 39, y - 40);
      ctx.lineTo(x + 65, y - 40);
      ctx.stroke();
    }
  });
}

function holePoint(index) {
  const stageRect = document.querySelector('.game-stage').getBoundingClientRect();
  if (game.inputMode === 'image') {
    const rect = visionBoard.getBoundingClientRect();
    return {
      x: rect.left - stageRect.left + canvasColumns[index % 3] / 600 * rect.width,
      y: rect.top - stageRect.top + (canvasRows[Math.floor(index / 3)] + 23) / 450 * rect.height,
    };
  }
  const rect = holeElements[index].getBoundingClientRect();
  return {
    x: rect.left - stageRect.left + rect.width / 2,
    y: rect.top - stageRect.top + rect.height * .76,
  };
}

function showImpact(index, label, kind, withHammer = true) {
  const stage = document.querySelector('.game-stage');
  const point = holePoint(index);
  if (withHammer) {
    const hammer = document.createElement('div');
    hammer.className = 'hammer-action';
    hammer.setAttribute('aria-hidden', 'true');
    hammer.textContent = '🔨';
    hammer.style.left = `${point.x}px`;
    hammer.style.top = `${point.y}px`;
    stage.append(hammer);
    setTimeout(() => hammer.remove(), 1100);
  }
  const impact = document.createElement('div');
  impact.className = `impact-popup ${kind}`;
  impact.textContent = label;
  impact.style.left = `${point.x}px`;
  impact.style.top = `${point.y - 24}px`;
  stage.append(impact);
  setTimeout(() => impact.remove(), 850);
}

function elapsed() {
  return game.elapsedMs + (game.phase === 'running' ? Date.now() - game.startedAt : 0);
}

function timeRemaining() {
  return Math.max(0, settings.durationSec * 1000 - elapsed());
}

function event(message, result = '', type = '') {
  const feed = $('eventFeed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();
  const row = document.createElement('li');
  row.className = type;
  const clock = document.createElement('span');
  clock.className = 'feed-time';
  clock.textContent = `${Math.floor(elapsed() / 1000)}s`;
  const detail = document.createElement('span');
  detail.textContent = message;
  const outcome = document.createElement('b');
  outcome.textContent = result;
  row.append(clock, detail, outcome);
  feed.prepend(row);
  while (feed.children.length > 12) feed.lastElementChild.remove();
  $('feedCount').textContent = `${feed.children.length} EVENTS`;
}

function renderChart() {
  const chart = $('latencyBars');
  if (chart.children.length !== 20) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 20; index++) {
      fragment.append(document.createElement('span'));
    }
    chart.replaceChildren(fragment);
  }
  const points = [...Array(Math.max(0, 20 - game.latencies.length)).fill(0), ...game.latencies.slice(-20)];
  points.forEach((ms, index) => {
    const bar = chart.children[index];
    bar.className = `bar${ms > 1000 ? ' very-slow' : ms > 500 ? ' slow' : ''}`;
    bar.style.height = `${ms ? Math.max(5, Math.min(100, ms / 1200 * 100)) : 3}%`;
    bar.title = ms ? `${ms} ms` : 'No call yet';
  });
}

function averageMs(total, count) {
  if (!count) return '—';
  const average = total / count;
  return `${average < 10 ? average.toFixed(1) : Math.round(average)} ms`;
}

function renderClock() {
  const remaining = timeRemaining();
  const seconds = Math.ceil(remaining / 1000);
  $('roundTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('timerFill').style.width = `${remaining / (settings.durationSec * 1000) * 100}%`;
}

function render() {
  renderClock();
  $('scoreBig').textContent = `${game.score < 0 ? '−' : ''}${String(Math.abs(game.score)).padStart(3, '0')}`;
  $('hitStat').textContent = game.hits;
  $('missStat').textContent = game.missed;
  $('staleStat').textContent = game.stale;
  $('decisionStat').textContent = game.decisions;
  $('latencyStat').textContent = averageMs(game.timing.modelTotal, game.timing.modelCount);
  $('prepStat').textContent = averageMs(game.timing.prepTotal, game.timing.count);
  $('roundtripStat').textContent = averageMs(game.timing.tripTotal, game.timing.count);
  $('scheduleStat').textContent = `Seed ${game.seed} · ${game.spawned}/${game.spawnAttempts} spawns · plan ${game.scheduleHash.toString(16).padStart(8, '0')}`;
  $('latencyLabel').textContent = game.mode === 'demo' ? 'DEMO DELAY' : 'MODEL DECISION';
  $('chartTitle').textContent = game.mode === 'demo' ? 'DEMO RESPONSE TIME' : 'MODEL DECISION TIME';
  $('hitRateStat').textContent = game.hits + game.missed
    ? `${Math.round(game.hits / (game.hits + game.missed) * 100)}%`
    : '—';

  const imageMode = game.inputMode === 'image';
  if (!imageMode) {
    holeElements.forEach((element, index) => {
      const occupant = game.holes[index];
      element.classList.toggle('active', Boolean(occupant));
      element.classList.toggle('gold', occupant?.kind === 'gold');
      element.classList.toggle('bomb', occupant?.kind === 'bomb');
      element.setAttribute('aria-label', `Hole ${index + 1}: ${occupant?.kind || 'empty'}`);
    });
  }
  $('gameBoard').hidden = imageMode;
  visionBoard.hidden = !imageMode;
  $('inputIndicator').textContent = imageMode ? 'IMAGE INPUT · MODEL VIEW' : 'TEXT STATE INPUT';
  if (imageMode) drawVisionBoard();
  const status = $('roundStatus');
  status.className = `status-chip${game.phase === 'running' ? ' running' : game.phase === 'paused' ? ' paused' : ''}`;
  status.textContent = {
    idle: 'READY TO PLAY', running: game.pending ? 'DECIDING…' : 'ROUND LIVE',
    paused: 'PAUSED', ended: 'ROUND COMPLETE',
  }[game.phase];
  $('stageMessage').textContent = {
    idle: 'Hit start to release the moles', running: game.pending ? `${game.mode === 'jev' ? 'Local Jev' : 'Demo bot'} is choosing…` : 'Watch the next move',
    paused: 'Round paused', ended: 'Round complete — change the pressure and go again',
  }[game.phase];
  $('agentBadge').textContent = game.mode === 'jev' ? `LOCAL JEV · ${imageMode ? 'IMAGE' : 'TEXT'}` : 'DEMO BOT';
  $('startButton').innerHTML = game.phase === 'paused' ? 'Resume round <span>↗</span>' : game.phase === 'running' ? 'Playing… <span>↗</span>' : game.phase === 'ended' ? 'Replay round <span>↗</span>' : `Start ${imageMode ? 'image' : 'text'} round <span>↗</span>`;
  $('quickScore').textContent = game.phase === 'idle' ? 'Ready' : `${game.score} points`;
  $('quickDetail').textContent = game.phase === 'idle'
    ? `${imageMode ? 'Image' : 'Text'} input · seed ${settings.seed} · ${settings.durationSec} seconds`
    : `${game.hits} hits · ${game.missed} escaped · ${game.stale} stale`;
  $('startButton').disabled = game.phase === 'running';
  $('pauseButton').disabled = game.phase !== 'running';
  $('jevMode').disabled = ['running', 'paused'].includes(game.phase);
  $('demoMode').disabled = ['running', 'paused'].includes(game.phase);
  $('textInput').disabled = ['running', 'paused'].includes(game.phase);
  $('imageInput').disabled = ['running', 'paused'].includes(game.phase);
  $('lengthSelect').disabled = ['running', 'paused'].includes(game.phase);
  $('seedInput').disabled = ['running', 'paused'].includes(game.phase);
  $('imagePreset').disabled = ['running', 'paused'].includes(game.phase);
  $('jevMode').classList.toggle('selected', game.mode === 'jev');
  $('demoMode').classList.toggle('selected', game.mode === 'demo');
  $('textInput').classList.toggle('selected', !imageMode);
  $('imageInput').classList.toggle('selected', imageMode);
  $('inputNote').textContent = imageMode
    ? 'Sends the displayed board pixels; mole locations stay out of the text.'
    : 'Sends exact occupants and time remaining.';
  $('controlHint').textContent = game.mode === 'demo'
    ? 'Demo bot makes local choices. Switch to Local Jev for model decisions.'
    : connected ? `Local Jev (${actualModel}) is ready with ${imageMode ? 'image' : 'text'} input.`
      : 'Local Jev is offline. Recheck the connection or use Demo bot.';
}

function abortDecision() {
  game.runId++;
  game.controller?.abort();
  game.controller = null;
  game.pending = false;
}

function resetGame() {
  abortDecision();
  Object.assign(game, {
    phase: 'idle', holes: Array(9).fill(null), score: 0, hits: 0,
    missed: 0, bombs: 0, stale: 0, decisions: 0, errors: 0,
    latencies: [], timing: { modelTotal: 0, modelCount: 0, prepTotal: 0, tripTotal: 0, count: 0 },
    startedAt: 0, elapsedMs: 0, pausedAt: 0,
    nextSpawnAt: 0, nextDecisionAt: 0, boardVersion: 0, lastDecisionVersion: 0,
    seed: settings.seed, rng: seededRandom(settings.seed), lastPlanIndex: -1,
    spawnAttempts: 0, spawned: 0, scheduleHash: 2166136261,
  });
  document.querySelectorAll('.hammer-action,.impact-popup').forEach((element) => element.remove());
  $('eventFeed').innerHTML = '<li class="feed-empty">The action starts when you launch a round.</li>';
  $('feedCount').textContent = '0 EVENTS';
  renderChart();
  render();
}

async function startGame() {
  if (game.phase === 'paused') {
    const shift = Date.now() - game.pausedAt;
    game.holes.forEach((hole) => { if (hole) hole.expiresAt += shift; });
    game.nextSpawnAt += shift;
    game.startedAt = Date.now();
    game.phase = 'running';
    event('Round resumed', '', '');
    render();
    document.querySelector('.board-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (game.mode === 'jev' && !connected) {
    await loadConnection();
    if (!connected) return;
  }
  resetGame();
  game.phase = 'running';
  game.startedAt = Date.now();
  game.nextSpawnAt = Date.now() + 250;
  event(`${game.mode === 'jev' ? `Local Jev · ${game.inputMode}` : 'Demo bot'} · seed ${game.seed}`, 'START');
  render();
  document.querySelector('.board-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pauseGame(message = 'Round paused') {
  if (game.phase !== 'running') return;
  game.elapsedMs = elapsed();
  game.pausedAt = Date.now();
  game.phase = 'paused';
  abortDecision();
  event(message, 'PAUSE');
  render();
}

function endGame() {
  if (game.phase !== 'running') return;
  game.elapsedMs = settings.durationSec * 1000;
  game.phase = 'ended';
  abortDecision();
  game.holes = Array(9).fill(null);
  event(`Final score ${game.score} · ${game.hits} hits`, 'FINISH');
  render();
  document.querySelector('.quick-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function spawnMole(now) {
  let index = Math.floor(game.rng() * 9);
  const roll = game.rng();
  if (index === game.lastPlanIndex) index = (index + 1) % 9;
  game.lastPlanIndex = index;
  const kind = roll < .11 ? 'bomb' : roll < .29 ? 'gold' : 'mole';
  const kindCode = kind === 'mole' ? 1 : kind === 'gold' ? 2 : 3;
  game.spawnAttempts++;
  game.scheduleHash = Math.imul(game.scheduleHash ^ (((index + 1) << 2) | kindCode), 16777619) >>> 0;
  const active = game.holes.filter(Boolean).length;
  if (active >= settings.maxActive || game.holes[index]) {
    return;
  }
  game.holes[index] = { kind, expiresAt: now + settings.lifeMs, lifeMs: settings.lifeMs };
  game.spawned++;
  game.boardVersion++;
}

async function demoChoice(snapshot) {
  const delay = 110 + Math.round(Math.random() * 160);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const targets = snapshot.map((hole, index) => ({ hole, index }))
    .filter(({ hole }) => hole && hole.kind !== 'bomb')
    .sort((a, b) => (b.hole.kind === 'gold' ? 3 : 1) - (a.hole.kind === 'gold' ? 3 : 1) || a.hole.msLeft - b.hole.msLeft);
  return { choice: targets.length ? `h${targets[0].index + 1}` : 'wait', confidence: 1, latencyMs: delay, model: 'demo-bot' };
}

async function decide() {
  const preparationStarted = performance.now();
  if (game.boardVersion === game.lastDecisionVersion) return;
  game.lastDecisionVersion = game.boardVersion;
  const now = Date.now();
  const snapshot = game.holes.map((hole) => hole ? { kind: hole.kind, msLeft: Math.max(0, hole.expiresAt - now) } : null);
  game.pending = true;
  game.decisions++;
  const runId = game.runId;
  const controller = new AbortController();
  game.controller = controller;
  let body = null;
  if (game.mode === 'jev') {
    if (game.inputMode === 'image') drawVisionBoard();
    const request = game.inputMode === 'image'
      ? { mode: 'image', image: visionBoard.toDataURL('image/png'), score: game.score, samples: settings.samples }
      : { mode: 'text', holes: snapshot, score: game.score, samples: settings.samples };
    body = JSON.stringify(request);
  }
  const prepMs = performance.now() - preparationStarted;
  const sentAt = performance.now();
  try {
    let resultPromise;
    if (game.mode === 'demo') {
      resultPromise = demoChoice(snapshot);
    } else {
      resultPromise = fetch('/api/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body, signal: controller.signal,
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Decision server request failed');
        return result;
      });
    }
    requestAnimationFrame(() => {
      if (runId === game.runId && game.phase === 'running') render();
    });
    const result = await resultPromise;
    if (game.mode === 'demo') result.modelMs = result.latencyMs;
    result.roundTripMs = performance.now() - sentAt;
    if (runId !== game.runId || game.phase !== 'running') return;
    if (timeRemaining() <= 0) return endGame();
    expireMoles(Date.now());
    result.prepMs = prepMs;
    if (game.mode === 'jev') {
      actualModel = result.model;
      $('modelName').textContent = actualModel;
    }
    if (Number.isFinite(result.modelMs)) {
      game.latencies.push(result.modelMs);
      if (game.latencies.length > 20) game.latencies.shift();
      game.timing.modelTotal += result.modelMs;
      game.timing.modelCount++;
    }
    game.timing.prepTotal += result.prepMs;
    game.timing.tripTotal += result.roundTripMs;
    game.timing.count++;
    renderChart();
    const timing = Number.isFinite(result.modelMs)
      ? `${Math.round(result.modelMs)} ms model`
      : `${Math.round(result.roundTripMs)} ms trip`;
    const index = /^h[1-9]$/.test(result.choice) ? Number(result.choice.slice(1)) - 1 : -1;
    if (index < 0) {
      event('Chose to wait', timing);
      game.nextDecisionAt = Date.now() + 70;
    } else {
      const target = game.holes[index];
      const label = `Hole ${index + 1}`;
      if (!target) {
        game.stale++;
        showImpact(index, 'MISS', 'miss');
        event(`${label} was empty on arrival`, timing, 'stale');
      } else {
        const { points, label: kindLabel } = kinds[target.kind];
        game.score += points;
        if (points > 0) game.hits++;
        else game.bombs++;
        showImpact(index, points > 0 ? `+${points} HIT` : '−2 BOMB', target.kind === 'gold' ? 'gold' : points > 0 ? 'hit' : 'bomb');
        game.holes[index] = null;
        game.boardVersion++;
        const element = holeElements[index];
        element.classList.add('selected', 'whacked');
        setTimeout(() => element.classList.remove('selected', 'whacked'), 230);
        event(`${label}: ${kindLabel}`, `${points > 0 ? '+' : ''}${points} · ${timing}`, points > 0 ? 'hit' : 'bomb');
      }
      game.nextDecisionAt = Date.now() + 70;
    }
  } catch (error) {
    if (runId !== game.runId || error.name === 'AbortError') return;
    game.errors++;
    event(error.message, 'ERROR', 'error');
    pauseGame('API error — round paused');
  } finally {
    if (runId === game.runId) {
      game.pending = false;
      game.controller = null;
      render();
    }
  }
}

function expireMoles(now) {
  let changed = false;
  game.holes.forEach((hole, index) => {
    if (hole && now >= hole.expiresAt) {
      if (hole.kind !== 'bomb') {
        game.missed++;
        showImpact(index, 'ESCAPED', 'miss', false);
        event(`Hole ${index + 1}: ${kinds[hole.kind].label} escaped`, 'MISSED', 'stale');
      }
      game.holes[index] = null;
      game.boardVersion++;
      changed = true;
    }
  });
  return changed;
}

function tick() {
  if (game.phase !== 'running') return;
  const now = Date.now();
  if (timeRemaining() <= 0) return endGame();
  let changed = expireMoles(now);
  if (now >= game.nextSpawnAt) {
    const before = game.boardVersion;
    spawnMole(now);
    const following = game.nextSpawnAt + settings.spawnMs;
    game.nextSpawnAt = following > now ? following : now + settings.spawnMs;
    changed ||= game.boardVersion !== before;
  }
  if (!game.pending && now >= game.nextDecisionAt && game.boardVersion !== game.lastDecisionVersion) {
    void decide();
  } else if (changed) {
    render();
  }
}

async function loadConnection() {
  $('connectionLabel').textContent = 'Checking Local Jev…';
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    connected = status.connected;
    actualModel = status.model;
    $('modelName').textContent = actualModel;
    $('connectionAddress').textContent = `${status.endpoint} /v1/systemone`;
    $('connectionLabel').textContent = connected ? 'Local Jev is ready' : 'Local Jev is offline';
    $('connectionDot').classList.toggle('connected', connected);
  } catch {
    $('connectionLabel').textContent = 'Local server unavailable';
    connected = false;
  }
  render();
}

$('checkConnection').addEventListener('click', loadConnection);

$('spawnSlider').addEventListener('input', (event_) => {
  settings.spawnMs = Number(event_.target.value);
  $('spawnValue').textContent = formatSeconds(settings.spawnMs);
  if (game.phase === 'running') game.nextSpawnAt = Date.now() + settings.spawnMs;
});
$('lifeSlider').addEventListener('input', (event_) => {
  settings.lifeMs = Number(event_.target.value);
  $('lifeValue').textContent = formatSeconds(settings.lifeMs);
});
$('crowdSelect').addEventListener('change', (event_) => { settings.maxActive = Number(event_.target.value); });
$('samplesSelect').addEventListener('change', (event_) => {
  settings.samples = event_.target.value === 'auto' ? 'auto' : Number(event_.target.value);
});
$('lengthSelect').addEventListener('change', (event_) => {
  settings.durationSec = Number(event_.target.value);
  render();
});
$('seedInput').addEventListener('change', (event_) => {
  const seed = Number(event_.target.value);
  if (Number.isInteger(seed) && seed >= 0 && seed <= 2147483647) {
    settings.seed = seed;
  } else {
    event_.target.value = settings.seed;
  }
});
$('imagePreset').addEventListener('click', () => {
  Object.assign(settings, { spawnMs: 600, lifeMs: 1100, maxActive: 3, durationSec: 30, samples: 1, seed: 42 });
  game.mode = 'jev';
  game.inputMode = 'image';
  $('spawnSlider').value = settings.spawnMs;
  $('lifeSlider').value = settings.lifeMs;
  $('crowdSelect').value = settings.maxActive;
  $('samplesSelect').value = settings.samples;
  $('lengthSelect').value = settings.durationSec;
  $('seedInput').value = settings.seed;
  $('spawnValue').textContent = formatSeconds(settings.spawnMs);
  $('lifeValue').textContent = formatSeconds(settings.lifeMs);
  resetGame();
});
$('jevMode').addEventListener('click', () => { game.mode = 'jev'; render(); });
$('demoMode').addEventListener('click', () => { game.mode = 'demo'; render(); });
$('textInput').addEventListener('click', () => { game.inputMode = 'text'; render(); });
$('imageInput').addEventListener('click', () => { game.inputMode = 'image'; render(); });
$('startButton').addEventListener('click', startGame);
$('pauseButton').addEventListener('click', () => pauseGame());
$('resetButton').addEventListener('click', resetGame);

renderChart();
render();
loadConnection();
setInterval(tick, 10);
setInterval(() => {
  if (game.phase !== 'running') return;
  renderClock();
  if (game.inputMode === 'image') drawVisionBoard();
}, 100);
