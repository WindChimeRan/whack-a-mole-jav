import { createMetalRequest, parseMetalChoice } from './metal-client.js';

const $ = (id) => document.getElementById(id);
const browserDirectModel = location.protocol === 'https:' || new URLSearchParams(location.search).get('direct') === '1';
const localMetalUrl = 'http://127.0.0.1:8012';
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
  phase: 'idle', mode: 'metal', inputMode: 'image', holes: Array(9).fill(null), score: 0,
  hits: 0, missed: 0, bombs: 0, stale: 0, decisions: 0, errors: 0,
  reactionMin: Infinity, reactionMax: 0,
  latencies: [], timing: { modelTotal: 0, modelCount: 0, prepTotal: 0, tripTotal: 0, count: 0 },
  startedAt: 0, elapsedMs: 0, pausedAt: 0,
  nextSpawnAt: 0, nextDecisionAt: 0, pending: false, runId: 0,
  controller: null, boardVersion: 0, lastDecisionVersion: 0,
  seed: settings.seed, rng: seededRandom(settings.seed), lastPlanIndex: -1,
  spawnAttempts: 0, spawned: 0, scheduleHash: 2166136261,
};
let connected = false;
let metalConfigured = true;
let metalConnected = false;
let connectionChecked = false;
let jevModelName = 'jev-latest';
let metalModelName = 'qwen35-metal';
let jevEndpoint = 'localhost:8011';
let metalEndpoint = 'localhost:8012';

function playerName() {
  return { metal: 'Qwen Metal', jev: 'Local Jev', human: 'You', demo: 'Demo bot' }[game.mode];
}

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
  $('prepStat').textContent = game.mode === 'human'
    ? Number.isFinite(game.reactionMin) ? `${game.reactionMin} ms` : '—'
    : averageMs(game.timing.prepTotal, game.timing.count);
  $('roundtripStat').textContent = game.mode === 'human'
    ? game.reactionMax ? `${game.reactionMax} ms` : '—'
    : averageMs(game.timing.tripTotal, game.timing.count);
  $('scheduleStat').textContent = `Seed ${game.seed} · ${game.spawned}/${game.spawnAttempts} spawns · plan ${game.scheduleHash.toString(16).padStart(8, '0')}`;
  $('staleLabel').textContent = game.mode === 'human' ? 'EMPTY SWINGS' : 'STALE CALLS';
  $('latencyLabel').textContent = game.mode === 'human' ? 'REACTION' : game.mode === 'metal' ? 'METAL REQUEST' : game.mode === 'demo' ? 'DEMO DELAY' : 'MODEL DECISION';
  $('prepLabel').textContent = game.mode === 'human' ? 'FASTEST HIT' : 'APP PREP';
  $('roundtripLabel').textContent = game.mode === 'human' ? 'SLOWEST HIT' : 'ROUND TRIP';
  $('decisionLabel').textContent = game.mode === 'human' ? 'SWINGS' : 'DECISIONS SENT';
  $('hitRateLabel').textContent = game.mode === 'human' ? 'CATCH RATE' : 'HIT RATE';
  $('chartTitle').textContent = game.mode === 'human' ? 'HUMAN REACTION TIME' : game.mode === 'metal' ? 'METAL REQUEST TIME' : game.mode === 'demo' ? 'DEMO RESPONSE TIME' : 'MODEL DECISION TIME';
  $('timingNote').textContent = game.mode === 'human'
    ? 'Reaction time runs from a mole appearing to your click on an occupied hole. Empty swings have no reaction time.'
    : game.mode === 'metal'
    ? browserDirectModel
      ? 'Metal request time is measured in this browser, from the local API call through its response. App prep includes frame capture.'
      : 'Metal request time is measured by the local proxy, including inference. App prep includes frame capture; round trip also includes browser transfer.'
    : game.mode === 'demo' ? 'Demo delay is a local simulation. App prep and round trip are still measured.'
      : 'Decision time is server reported. App prep includes frame capture; round trip includes the local proxy and network.';
  $('connectionLabel').textContent = game.mode === 'human' ? 'Human player is ready'
    : game.mode === 'demo' ? 'Demo bot is ready'
    : !connectionChecked ? browserDirectModel ? 'Connect to your local model' : 'Checking model servers…'
    : game.mode === 'metal'
    ? metalConnected ? 'Qwen Metal is ready' : 'Qwen Metal is offline'
    : connected ? 'Local Jev is ready' : 'Local Jev is offline';
  $('connectionAddress').textContent = game.mode === 'human' ? 'Click a hole or press 1–9'
    : game.mode === 'demo' ? 'Runs in this browser'
    : game.mode === 'metal'
    ? `${metalEndpoint} /v1/chat/completions`
    : `${jevEndpoint} /v1/systemone`;
  $('connectionDot').classList.toggle('connected', game.mode === 'human' || game.mode === 'demo' || (game.mode === 'metal' ? metalConnected : connected));
  $('checkConnection').textContent = browserDirectModel && !metalConnected ? 'Connect' : 'Recheck';
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
  visionBoard.classList.toggle('human-play', game.mode === 'human');
  $('inputIndicator').textContent = game.mode === 'human' ? 'HUMAN · CLICK OR PRESS 1–9' : imageMode ? 'IMAGE INPUT · MODEL VIEW' : 'TEXT STATE INPUT';
  if (imageMode) drawVisionBoard();
  const status = $('roundStatus');
  status.className = `status-chip${game.phase === 'running' ? ' running' : game.phase === 'paused' ? ' paused' : ''}`;
  status.textContent = {
    idle: 'READY TO PLAY', running: game.mode === 'human' ? 'YOUR TURN' : game.pending ? 'DECIDING…' : 'ROUND LIVE',
    paused: 'PAUSED', ended: 'ROUND COMPLETE',
  }[game.phase];
  $('stageMessage').textContent = {
    idle: 'Hit start to release the moles', running: game.mode === 'human' ? 'Click a mole before it disappears' : game.pending ? `${playerName()} is choosing…` : 'Watch the next move',
    paused: 'Round paused', ended: 'Round complete — change the pressure and go again',
  }[game.phase];
  $('agentBadge').textContent = game.mode === 'human' ? 'HUMAN PLAYER' : game.mode === 'demo' ? 'DEMO BOT' : `${game.mode === 'metal' ? 'QWEN METAL' : 'LOCAL JEV'} · ${imageMode ? 'IMAGE' : 'TEXT'}`;
  $('modelName').textContent = game.mode === 'metal' ? metalModelName : game.mode === 'jev' ? jevModelName : game.mode === 'human' ? 'human player' : 'demo-bot';
  $('startButton').innerHTML = game.phase === 'paused' ? 'Resume round <span>↗</span>' : game.phase === 'running' ? 'Playing… <span>↗</span>' : game.phase === 'ended' ? 'Replay round <span>↗</span>' : `Start ${game.mode === 'human' ? 'human' : imageMode ? 'image' : 'text'} round <span>↗</span>`;
  $('quickScore').textContent = game.phase === 'idle' ? 'Ready' : `${game.score} ${Math.abs(game.score) === 1 ? 'point' : 'points'}`;
  $('quickDetail').textContent = game.phase === 'idle'
    ? `${playerName()} · ${game.mode === 'human' ? 'same board' : imageMode ? 'image' : 'text'} · seed ${settings.seed}`
    : `${game.hits} ${game.hits === 1 ? 'hit' : 'hits'} · ${game.missed} escaped · ${game.stale} ${game.mode === 'human' ? 'empty swings' : 'stale'}`;
  $('startButton').disabled = game.phase === 'running';
  $('pauseButton').disabled = game.phase !== 'running';
  $('jevMode').disabled = ['running', 'paused'].includes(game.phase) || browserDirectModel;
  $('metalMode').disabled = ['running', 'paused'].includes(game.phase) || !metalConfigured;
  $('humanMode').disabled = ['running', 'paused'].includes(game.phase);
  $('demoMode').disabled = ['running', 'paused'].includes(game.phase);
  $('textInput').disabled = ['running', 'paused'].includes(game.phase) || game.mode === 'human';
  $('imageInput').disabled = ['running', 'paused'].includes(game.phase) || game.mode === 'human';
  $('lengthSelect').disabled = ['running', 'paused'].includes(game.phase);
  $('seedInput').disabled = ['running', 'paused'].includes(game.phase);
  $('imagePreset').disabled = ['running', 'paused'].includes(game.phase);
  $('jevMode').classList.toggle('selected', game.mode === 'jev');
  $('metalMode').classList.toggle('selected', game.mode === 'metal');
  $('humanMode').classList.toggle('selected', game.mode === 'human');
  $('demoMode').classList.toggle('selected', game.mode === 'demo');
  $('samplesSelect').disabled = game.mode !== 'jev';
  $('textInput').classList.toggle('selected', !imageMode);
  $('imageInput').classList.toggle('selected', imageMode);
  $('inputLabel').textContent = game.mode === 'human' ? 'YOUR VIEW' : 'MODEL INPUT';
  $('inputNote').textContent = game.mode === 'human' ? 'Click a hole or press 1–9 while the round runs.'
    : imageMode ? 'Sends the displayed board pixels; mole locations stay out of the text.'
      : 'Sends exact occupants and time remaining.';
  $('playerNote').textContent = game.mode === 'human' ? 'No model server needed. Use the same seed and pressure settings.'
    : game.mode === 'demo' ? 'Scripted local bot, for previewing the arena.'
    : !connectionChecked ? browserDirectModel ? 'Run vLLM-metal locally, then click Connect.' : 'Checking model servers…'
    : game.mode === 'jev' ? `DGX Spark Jev-style server: ${connected ? 'ready' : 'offline'}. Optional player.`
      : `Qwen3.5-0.8B on vLLM-metal: ${metalConnected ? 'ready' : 'offline'}.`;
  $('controlHint').textContent = game.mode === 'human'
    ? 'Click a hole or press 1–9. Use the same seed and pressure settings to compare your score.'
    : game.mode === 'demo'
    ? 'Demo bot makes local choices. Choose a model to test inference.'
    : !connectionChecked ? browserDirectModel ? 'Run vLLM-metal on 127.0.0.1:8012, then click Connect or Start.' : 'Checking model servers…'
    : game.mode === 'metal'
      ? metalConnected ? `Qwen Metal (${metalModelName}) is ready with ${imageMode ? 'image' : 'text'} input.`
        : `Qwen Metal is offline. Start vLLM-metal, then ${browserDirectModel ? 'click Connect' : 'recheck the connection'}.`
      : connected ? `Local Jev (${jevModelName}) is ready with ${imageMode ? 'image' : 'text'} input.`
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
    reactionMin: Infinity, reactionMax: 0,
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
  if (game.mode === 'metal' && !metalConnected) {
    await loadConnection();
    if (!metalConnected) return;
  }
  resetGame();
  game.phase = 'running';
  game.startedAt = Date.now();
  game.nextSpawnAt = Date.now() + 250;
  event(`${playerName()} · ${game.inputMode} · seed ${game.seed}`, 'START');
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
  game.holes[index] = { kind, spawnedAt: now, expiresAt: now + settings.lifeMs, lifeMs: settings.lifeMs };
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

function whack(index, timing = '', human = false) {
  const target = game.holes[index];
  const label = `Hole ${index + 1}`;
  if (!target) {
    game.stale++;
    showImpact(index, 'MISS', 'miss');
    event(`${label} was empty${human ? '' : ' on arrival'}`, human ? 'MISS' : timing, 'stale');
    return;
  }

  const { points, label: kindLabel } = kinds[target.kind];
  if (human) {
    const reactionMs = Math.max(0, Date.now() - target.spawnedAt);
    game.latencies.push(reactionMs);
    if (game.latencies.length > 20) game.latencies.shift();
    game.timing.modelTotal += reactionMs;
    game.timing.modelCount++;
    game.reactionMin = Math.min(game.reactionMin, reactionMs);
    game.reactionMax = Math.max(game.reactionMax, reactionMs);
    timing = `${reactionMs} ms reaction`;
  }
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

function humanWhack(index) {
  if (game.mode !== 'human' || game.phase !== 'running' || index < 0 || index > 8) return;
  if (timeRemaining() <= 0) return endGame();
  expireMoles(Date.now());
  game.decisions++;
  whack(index, '', true);
  renderChart();
  render();
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
  if (game.mode !== 'demo') {
    if (game.inputMode === 'image') drawVisionBoard();
    const request = game.inputMode === 'image'
      ? { backend: game.mode, mode: 'image', image: visionBoard.toDataURL('image/png'), score: game.score, samples: settings.samples }
      : { backend: game.mode, mode: 'text', holes: snapshot, score: game.score, samples: settings.samples };
    body = JSON.stringify(browserDirectModel && game.mode === 'metal'
      ? createMetalRequest(request, metalModelName)
      : request);
  }
  const prepMs = performance.now() - preparationStarted;
  const sentAt = performance.now();
  try {
    let resultPromise;
    if (game.mode === 'demo') {
      resultPromise = demoChoice(snapshot);
    } else if (browserDirectModel && game.mode === 'metal') {
      resultPromise = fetch(`${localMetalUrl}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      }).then(async (response) => {
        const completion = await response.json();
        if (!response.ok) throw new Error(`Local Qwen server returned HTTP ${response.status}`);
        const choice = parseMetalChoice(completion?.choices?.[0]?.message?.content);
        return {
          choice: choice || 'wait', invalidOutput: !choice,
          model: completion.model || metalModelName,
          modelMs: Math.round(performance.now() - sentAt), timingSource: 'browser_to_local',
        };
      });
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
      jevModelName = result.model;
    } else if (game.mode === 'metal') {
      metalModelName = result.model;
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
      ? `${Math.round(result.modelMs)} ms ${game.mode === 'metal' ? 'request' : 'model'}`
      : `${Math.round(result.roundTripMs)} ms trip`;
    if (result.invalidOutput) event('Unrecognized model answer; waiting', timing, 'error');
    const index = /^h[1-9]$/.test(result.choice) ? Number(result.choice.slice(1)) - 1 : -1;
    if (index < 0) {
      event('Chose to wait', timing);
      game.nextDecisionAt = Date.now() + 70;
    } else {
      whack(index, timing);
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
  if (game.mode !== 'human' && !game.pending && now >= game.nextDecisionAt && game.boardVersion !== game.lastDecisionVersion) {
    void decide();
  } else if (changed) {
    render();
  }
}

async function loadConnection() {
  connectionChecked = false;
  render();
  if (browserDirectModel) {
    connected = false;
    try {
      const response = await fetch(`${localMetalUrl}/health`, { signal: AbortSignal.timeout(15_000) });
      metalConnected = response.ok;
    } catch {
      metalConnected = false;
    }
    connectionChecked = true;
    render();
    return;
  }
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    connected = status.connected;
    jevModelName = status.model;
    metalConfigured = Boolean(status.metalConfigured);
    metalConnected = Boolean(status.metalConnected);
    metalModelName = status.metalModel || metalModelName;
    jevEndpoint = status.endpoint || jevEndpoint;
    metalEndpoint = status.metalEndpoint || metalEndpoint;
  } catch {
    $('connectionLabel').textContent = 'Local server unavailable';
    connected = false;
    metalConnected = false;
  }
  connectionChecked = true;
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
function selectPlayer(mode) {
  if (game.mode === mode) return;
  game.mode = mode;
  if (mode === 'human') game.inputMode = 'image';
  resetGame();
}

$('jevMode').addEventListener('click', () => selectPlayer('jev'));
$('metalMode').addEventListener('click', () => selectPlayer('metal'));
$('humanMode').addEventListener('click', () => selectPlayer('human'));
$('demoMode').addEventListener('click', () => selectPlayer('demo'));
$('textInput').addEventListener('click', () => { if (game.inputMode !== 'text') { game.inputMode = 'text'; resetGame(); } });
$('imageInput').addEventListener('click', () => { if (game.inputMode !== 'image') { game.inputMode = 'image'; resetGame(); } });
$('startButton').addEventListener('click', startGame);
$('pauseButton').addEventListener('click', () => pauseGame());
$('resetButton').addEventListener('click', resetGame);
visionBoard.addEventListener('pointerdown', (event_) => {
  const rect = visionBoard.getBoundingClientRect();
  const column = Math.floor((event_.clientX - rect.left) / rect.width * 3);
  const row = Math.floor((event_.clientY - rect.top) / rect.height * 3);
  if (column >= 0 && column < 3 && row >= 0 && row < 3) humanWhack(row * 3 + column);
});
holeElements.forEach((element, index) => element.addEventListener('pointerdown', () => humanWhack(index)));
document.addEventListener('keydown', (event_) => {
  if (!/^[1-9]$/.test(event_.key) || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event_.target.tagName)) return;
  humanWhack(Number(event_.key) - 1);
});

renderChart();
render();
if (!browserDirectModel) loadConnection();
setInterval(tick, 10);
setInterval(() => {
  if (game.phase !== 'running') return;
  renderClock();
  if (game.inputMode === 'image') drawVisionBoard();
}, 100);
