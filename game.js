(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const startScreen = document.getElementById('start-screen');
  const gameOverScreen = document.getElementById('gameover-screen');
  const fireBtn = document.getElementById('fire-btn');
  const muteBtn = document.getElementById('mute-btn');
  const finalScoreEl = document.getElementById('final-score');
  const finalHighScoreEl = document.getElementById('final-high-score');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');

  const HIGH_SCORE_KEY = 'orbitalDashHighScore';
  const MUTED_KEY = 'orbitalDashMuted';

  const SHIP_X = 100;
  const SHIP_RADIUS = 15;
  const THRUST_STEP = 2.2;
  const MAX_VY = 6.5;
  const FLAME_FRAMES = 14;

  const BASE_SPEED = 2.5;
  const MAX_SPEED_BONUS = 4;
  const SPAWN_SPACING = 210;

  const BLAST_SPEED = 11;
  const BLAST_RANGE = 190;
  const BLAST_COOLDOWN_FRAMES = 18;

  const SCORE_PASS = 1;
  const SCORE_BLAST_KILL = 3;
  const LARGE_ASTEROID_THRESHOLD = 32;
  const DEATH_DURATION = 70;

  const ASTEROID_PALETTES = [
    { base: '#8a7f6b', dark: '#4a4335', light: '#b3a68c' },
    { base: '#6b7280', dark: '#383c46', light: '#9aa1b0' },
    { base: '#8a5a4a', dark: '#4a2e24', light: '#b8836c' },
    { base: '#5c5c5c', dark: '#2e2e2e', light: '#8a8a8a' },
    { base: '#7c6f57', dark: '#3f3728', light: '#a99c7d' }
  ];

  const STAR_LINES = ['Score!', 'Yes!', 'Cha-ching!', 'Nice grab!', 'Bonus!'];
  const BIG_DODGE_LINES = ['That was a big one!', 'Whew, close!', 'Nailed it!', 'Big rock, bigger skills!'];
  const AMBIENT_LINES = [
    'Are we there yet?',
    'I did not sign up for this.',
    'Beep boop, just kidding.',
    'This belt is not on the map.',
    'Snacks would be nice right now.',
    'Is that rock judging us?',
    'Definitely taking the scenic route.',
    'My antennae are tingling.'
  ];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  let state = 'START'; // START -> PLAYING -> DYING -> GAMEOVER
  let shipY, shipVY, bottomFlameTimer, topFlameTimer, blastCooldown;
  let obstacles, blasts, explosions, collectibles, collectibleTimer, score, speed;
  let speechText, speechTimer, ambientTimer;
  let shipDebris, deathTimer;

  let muted = localStorage.getItem(MUTED_KEY) === 'true';
  let audioCtx, masterGain, musicGain, coastGainNode;
  let musicTimer = null;
  let nextNoteTime = 0;
  let noteIndex = 0;
  const NOTE_FREQS = [220, 220, 329.63, 293.66, 246.94, 246.94, 349.23, 329.63];
  const NOTE_DURATION = 0.16;

  function createNoiseBuffer(duration) {
    const size = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const buffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playNote(freq, time, duration) {
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.22, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  function scheduleMusic() {
    while (nextNoteTime < audioCtx.currentTime + 0.2) {
      playNote(NOTE_FREQS[noteIndex % NOTE_FREQS.length], nextNoteTime, NOTE_DURATION * 0.9);
      nextNoteTime += NOTE_DURATION;
      noteIndex++;
    }
    musicTimer = setTimeout(scheduleMusic, 50);
  }

  function startCoastAmbience() {
    const source = audioCtx.createBufferSource();
    source.buffer = createNoiseBuffer(2);
    source.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 260;
    filter.Q.value = 0.6;
    coastGainNode = audioCtx.createGain();
    coastGainNode.gain.value = 0;
    source.connect(filter);
    filter.connect(coastGainNode);
    coastGainNode.connect(masterGain);
    source.start();
  }

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : 0.5;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.6;
    musicGain.connect(masterGain);

    nextNoteTime = audioCtx.currentTime + 0.1;
    scheduleMusic();
    startCoastAmbience();
  }

  function playThrusterSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = createNoiseBuffer(0.2);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 550;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.35, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(now);
    src.stop(now + 0.2);
  }

  function playExplosionSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = createNoiseBuffer(0.35);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.3);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.6, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(now);
    src.stop(now + 0.35);
  }

  function playCoinSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [988, 1319].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = audioCtx.createGain();
      const t = now + i * 0.07;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.1);
    });
  }

  function playShipExplosionSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.55);
    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.5, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.6);

    const src = audioCtx.createBufferSource();
    src.buffer = createNoiseBuffer(0.7);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.6);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.8, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(now);
    src.stop(now + 0.7);
  }

  function updateCoastAmbience() {
    if (!coastGainNode) return;
    const thrusting = bottomFlameTimer > 0 || topFlameTimer > 0;
    const target = thrusting ? 0 : 0.1;
    coastGainNode.gain.setTargetAtTime(target, audioCtx.currentTime, 0.15);
  }

  function setMuted(value) {
    muted = value;
    localStorage.setItem(MUTED_KEY, String(muted));
    muteBtn.textContent = muted ? 'Sound: Off' : 'Sound: On';
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
  }

  function rollSmallRadius() {
    return 9 + Math.random() * 9;
  }

  function rollMediumRadius() {
    return 20 + Math.random() * 12;
  }

  function rollLargeRadius() {
    return 34 + Math.random() * 18;
  }

  function rollRadius() {
    const largeChance = Math.min(0.05 + score * 0.004, 0.18);
    const mediumChance = 0.25;
    const r = Math.random();
    if (r < largeChance) return rollLargeRadius();
    if (r < largeChance + mediumChance) return rollMediumRadius();
    return rollSmallRadius();
  }

  function asteroidTier(radius) {
    if (radius > LARGE_ASTEROID_THRESHOLD) return 'large';
    if (radius >= 20) return 'medium';
    return 'small';
  }

  function makeCraters(radius) {
    const count = 2 + Math.floor(Math.random() * 3);
    const craters = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.55;
      craters.push({
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        r: radius * (0.12 + Math.random() * 0.18)
      });
    }
    return craters;
  }

  function makeClusterCircles(radius) {
    const count = 3 + Math.floor(Math.random() * 3);
    const circles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.5;
      const r = radius * (0.35 + Math.random() * 0.3);
      circles.push({ dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, r });
    }
    return circles;
  }

  function makeShardPoints(radius) {
    const n = 5 + Math.floor(Math.random() * 3);
    const points = [];
    for (let i = 0; i < n; i++) {
      points.push({
        angle: (i / n) * Math.PI * 2,
        r: radius * (0.7 + Math.random() * 0.5)
      });
    }
    return points;
  }

  function makeAsteroid(x, y, radius) {
    const shape = ['circle', 'cluster', 'shard'][Math.floor(Math.random() * 3)];
    const palette = ASTEROID_PALETTES[Math.floor(Math.random() * ASTEROID_PALETTES.length)];
    const obstacle = { x, y, radius, shape, palette, passed: false, hit: false, collisionRadius: radius * 0.9 };

    if (shape === 'circle') {
      obstacle.craters = makeCraters(radius);
    } else if (shape === 'cluster') {
      obstacle.circles = makeClusterCircles(radius);
      obstacle.collisionRadius = radius * 1.05;
    } else {
      obstacle.points = makeShardPoints(radius);
      obstacle.rotation = Math.random() * Math.PI * 2;
      obstacle.collisionRadius = radius * 0.95;
      obstacle.craters = makeCraters(radius * 0.7);
    }
    return obstacle;
  }

  function shrinkAsteroid(o, newRadius) {
    const shape = ['circle', 'cluster', 'shard'][Math.floor(Math.random() * 3)];
    o.radius = newRadius;
    o.shape = shape;
    delete o.craters;
    delete o.circles;
    delete o.points;
    delete o.rotation;

    if (shape === 'circle') {
      o.collisionRadius = newRadius * 0.9;
      o.craters = makeCraters(newRadius);
    } else if (shape === 'cluster') {
      o.collisionRadius = newRadius * 1.05;
      o.circles = makeClusterCircles(newRadius);
    } else {
      o.collisionRadius = newRadius * 0.95;
      o.points = makeShardPoints(newRadius);
      o.rotation = Math.random() * Math.PI * 2;
      o.craters = makeCraters(newRadius * 0.7);
    }
  }

  function spawnExplosion(x, y, big) {
    const count = big ? 24 + Math.floor(Math.random() * 10) : 10 + Math.floor(Math.random() * 6);
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        speed: (big ? 2.5 + Math.random() * 4 : 1.5 + Math.random() * 2.5)
      });
    }
    explosions.push({ x, y, particles, age: 0, maxAge: big ? 40 : 24, scale: big ? 1.8 : 1 });
  }

  function updateExplosions() {
    for (const ex of explosions) ex.age++;
    explosions = explosions.filter((ex) => ex.age <= ex.maxAge);
  }

  function drawExplosions() {
    for (const ex of explosions) {
      const t = ex.age / ex.maxAge;
      const alpha = 1 - t;
      ctx.save();
      ctx.translate(ex.x, ex.y);
      ctx.fillStyle = `rgba(255,255,210,${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(0, 0, 10 * ex.scale * (1 - t), 0, Math.PI * 2);
      ctx.fill();
      for (const p of ex.particles) {
        const dist = p.speed * ex.age;
        const px = Math.cos(p.angle) * dist;
        const py = Math.sin(p.angle) * dist;
        ctx.fillStyle = `rgba(255,${150 + Math.floor(80 * (1 - t))},80,${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, 3 * ex.scale * (1 - t)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function spawnAsteroidGroup() {
    const groupSize = Math.random() < 0.22 ? 2 : 1;
    const startX = W + 40;
    for (let i = 0; i < groupSize; i++) {
      const radius = rollRadius();
      const margin = radius + 30;
      const y = margin + Math.random() * (H - margin * 2);
      obstacles.push(makeAsteroid(startX + i * 70, y, radius));
    }
  }

  function showSpeech(text) {
    speechText = text;
    speechTimer = 100;
  }

  function makeCollectible(x, y) {
    const tierRoll = Math.random();
    let radius, points;
    if (tierRoll < 0.45) {
      radius = 16 + Math.random() * 4;
      points = 5;
    } else if (tierRoll < 0.8) {
      radius = 11 + Math.random() * 4;
      points = 10;
    } else {
      radius = 6 + Math.random() * 4;
      points = 15;
    }
    return {
      x,
      y,
      radius,
      points,
      collected: false,
      collisionRadius: radius * 0.9,
      swaySeed: Math.random() * Math.PI * 2
    };
  }

  function spawnCollectible() {
    const candidates = obstacles.filter((o) => o.x > SHIP_X + 80);
    let x, y;
    if (candidates.length && Math.random() < 0.4) {
      const near = candidates[Math.floor(Math.random() * candidates.length)];
      x = Math.max(near.x + (Math.random() * 70 - 35), SHIP_X + 60);
      y = Math.max(24, Math.min(H - 24, near.y + (Math.random() * 80 - 40)));
    } else {
      x = W + 40;
      y = 30 + Math.random() * (H - 60);
    }
    collectibles.push(makeCollectible(x, y));
  }

  function resetState() {
    initAudio();
    state = 'PLAYING';
    shipY = H / 2;
    shipVY = 0;
    bottomFlameTimer = 0;
    topFlameTimer = 0;
    blastCooldown = 0;
    obstacles = [];
    blasts = [];
    explosions = [];
    collectibles = [];
    collectibleTimer = 120;
    speechText = '';
    speechTimer = 0;
    ambientTimer = 180;
    shipDebris = [];
    deathTimer = 0;
    score = 0;
    speed = BASE_SPEED;
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    fireBtn.classList.remove('hidden');
  }

  function startShipDeath() {
    state = 'DYING';
    deathTimer = DEATH_DURATION;
    fireBtn.classList.add('hidden');
    if (coastGainNode) coastGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    playShipExplosionSound();
    spawnExplosion(SHIP_X, shipY, true);

    const shipColors = ['#9aa3c2', '#1c2a5e', '#4b5170', '#5c6480', '#7CFC00'];
    shipDebris = [];
    const fragCount = 9;
    for (let i = 0; i < fragCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speedMag = 1.5 + Math.random() * 3.5;
      shipDebris.push({
        x: SHIP_X,
        y: shipY,
        vx: Math.cos(angle) * speedMag,
        vy: Math.sin(angle) * speedMag,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        w: 4 + Math.random() * 7,
        h: 3 + Math.random() * 6,
        color: pick(shipColors)
      });
    }
  }

  function updateShipDeath() {
    updateExplosions();
    for (const f of shipDebris) {
      f.x += f.vx;
      f.y += f.vy;
      f.rot += f.vr;
    }
    deathTimer--;
    if (deathTimer <= 0) {
      endGame();
    }
  }

  function thrustUp() {
    if (state !== 'PLAYING') return;
    shipVY = Math.max(shipVY - THRUST_STEP, -MAX_VY);
    bottomFlameTimer = FLAME_FRAMES;
    playThrusterSound();
  }

  function thrustDown() {
    if (state !== 'PLAYING') return;
    shipVY = Math.min(shipVY + THRUST_STEP, MAX_VY);
    topFlameTimer = FLAME_FRAMES;
    playThrusterSound();
  }

  function fireBlast() {
    if (state !== 'PLAYING' || blastCooldown > 0) return;
    const x = SHIP_X + 20;
    blasts.push({ x, y: shipY, startX: x, hit: false });
    blastCooldown = BLAST_COOLDOWN_FRAMES;
  }

  function endGame() {
    state = 'GAMEOVER';
    fireBtn.classList.add('hidden');
    if (coastGainNode) coastGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    const highScore = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
    if (score > highScore) {
      localStorage.setItem(HIGH_SCORE_KEY, String(score));
    }
    finalScoreEl.textContent = score;
    finalHighScoreEl.textContent = Math.max(score, highScore);
    gameOverScreen.classList.remove('hidden');
  }

  function update() {
    if (state === 'DYING') {
      updateShipDeath();
      return;
    }

    if (bottomFlameTimer > 0) bottomFlameTimer--;
    if (topFlameTimer > 0) topFlameTimer--;
    if (blastCooldown > 0) blastCooldown--;
    if (speechTimer > 0) speechTimer--;
    updateCoastAmbience();
    updateExplosions();

    ambientTimer--;
    if (ambientTimer <= 0) {
      if (speechTimer <= 0) showSpeech(pick(AMBIENT_LINES));
      ambientTimer = 240 + Math.floor(Math.random() * 240);
    }

    shipY += shipVY;
    if (shipY - SHIP_RADIUS < 0 || shipY + SHIP_RADIUS > H) {
      endGame();
      return;
    }

    speed = BASE_SPEED + Math.min(score * 0.08, MAX_SPEED_BONUS);

    for (const b of blasts) {
      b.x += BLAST_SPEED;
      for (const o of obstacles) {
        if (o.hit) continue;
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        if (Math.sqrt(dx * dx + dy * dy) < o.collisionRadius + 4) {
          b.hit = true;
          const tier = asteroidTier(o.radius);
          if (tier === 'small') {
            o.hit = true;
            if (!o.passed) {
              o.passed = true;
              score += SCORE_BLAST_KILL;
            }
            spawnExplosion(o.x, o.y);
          } else {
            const newRadius = tier === 'large' ? rollMediumRadius() : rollSmallRadius();
            shrinkAsteroid(o, newRadius);
            spawnExplosion(o.x, o.y);
          }
          playExplosionSound();
          break;
        }
      }
    }
    blasts = blasts.filter((b) => !b.hit && b.x - b.startX <= BLAST_RANGE && b.x < W + 20);
    obstacles = obstacles.filter((o) => !o.hit);

    for (const o of obstacles) {
      o.x -= speed;

      if (!o.passed && o.x + o.collisionRadius < SHIP_X - SHIP_RADIUS) {
        o.passed = true;
        score += SCORE_PASS;
        if (o.radius > LARGE_ASTEROID_THRESHOLD) {
          showSpeech(pick(BIG_DODGE_LINES));
        }
      }

      const dx = SHIP_X - o.x;
      const dy = shipY - o.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SHIP_RADIUS + o.collisionRadius) {
        startShipDeath();
        return;
      }
    }

    obstacles = obstacles.filter((o) => o.x + o.collisionRadius > 0);

    const last = obstacles[obstacles.length - 1];
    if (!last || last.x < W - SPAWN_SPACING) {
      spawnAsteroidGroup();
    }

    for (const s of collectibles) {
      s.x -= speed;
      const dx = SHIP_X - s.x;
      const dy = shipY - s.y;
      if (Math.sqrt(dx * dx + dy * dy) < SHIP_RADIUS + s.collisionRadius) {
        s.collected = true;
        score += s.points;
        playCoinSound();
        showSpeech(pick(STAR_LINES));
      }
    }
    collectibles = collectibles.filter((s) => !s.collected && s.x + s.collisionRadius > 0);

    collectibleTimer--;
    if (collectibleTimer <= 0) {
      spawnCollectible();
      collectibleTimer = 90 + Math.floor(Math.random() * 90);
    }
  }

  function drawCoastTrail() {
    if (bottomFlameTimer > 0 || topFlameTimer > 0) return;
    const t = performance.now() / 150;
    for (let i = 0; i < 3; i++) {
      const offset = i * 9 + (t % 9);
      const alpha = Math.max(0.32 - i * 0.09 - (offset % 9) * 0.02, 0);
      ctx.beginPath();
      ctx.fillStyle = `rgba(200,210,255,${alpha})`;
      ctx.ellipse(-18 - offset, Math.sin(t + i) * 2, 5 - i, 3 - i * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawShip() {
    ctx.save();
    ctx.translate(SHIP_X, shipY);
    const tilt = Math.max(-0.4, Math.min(0.4, shipVY * 0.05));
    ctx.rotate(tilt);

    drawCoastTrail();

    ctx.fillStyle = '#9aa3c2';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4b5170';
    ctx.fillRect(-21, -6, 6, 4);
    ctx.fillRect(-21, 2, 6, 4);

    ctx.fillStyle = '#5c6480';
    ctx.fillRect(14, -2, 9, 4);

    ctx.fillStyle = 'rgba(140,220,255,0.88)';
    ctx.beginPath();
    ctx.ellipse(-2, -7, 7, 6, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7CFC00';
    ctx.beginPath();
    ctx.arc(-2, -8.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#123312';
    ctx.beginPath();
    ctx.arc(-3.3, -9, 0.7, 0, Math.PI * 2);
    ctx.arc(-0.8, -9, 0.7, 0, Math.PI * 2);
    ctx.fill();

    if (bottomFlameTimer > 0) {
      const t = bottomFlameTimer / FLAME_FRAMES;
      const flicker = 0.85 + Math.random() * 0.3;
      const len = (8 + 10 * t) * flicker;
      ctx.beginPath();
      ctx.moveTo(-21, 6);
      ctx.lineTo(-18, 6 + len);
      ctx.lineTo(-15, 6);
      ctx.closePath();
      ctx.fillStyle = '#ffb347';
      ctx.fill();
    }

    if (topFlameTimer > 0) {
      const t = topFlameTimer / FLAME_FRAMES;
      const flicker = 0.85 + Math.random() * 0.3;
      const len = (8 + 10 * t) * flicker;
      ctx.beginPath();
      ctx.moveTo(-21, -6);
      ctx.lineTo(-18, -6 - len);
      ctx.lineTo(-15, -6);
      ctx.closePath();
      ctx.fillStyle = '#ffb347';
      ctx.fill();
    }

    ctx.restore();
  }

  function drawShipDebris() {
    const alpha = Math.max(deathTimer / DEATH_DURATION, 0);
    for (const f of shipDebris) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = f.color;
      ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawBlasts() {
    for (const b of blasts) {
      ctx.save();
      ctx.translate(b.x, b.y);
      const grad = ctx.createLinearGradient(-10, 0, 4, 0);
      grad.addColorStop(0, 'rgba(124,252,0,0)');
      grad.addColorStop(1, '#b6ff5c');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function starShapePath(radius) {
    const spikes = 5;
    const outerR = radius;
    const innerR = radius * 0.48;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (Math.PI / spikes) * i - Math.PI / 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawCollectibles() {
    for (const s of collectibles) {
      const bob = Math.sin(performance.now() / 900 + s.swaySeed) * 2;
      const sway = Math.sin(performance.now() / 1600 + s.swaySeed) * 0.09;

      ctx.save();
      ctx.translate(s.x, s.y + bob);
      ctx.rotate(sway);
      starShapePath(s.radius);
      const grad = ctx.createRadialGradient(0, 0, Math.max(s.radius * 0.2, 1), 0, 0, s.radius);
      grad.addColorStop(0, '#fff6c8');
      grad.addColorStop(1, '#ffcc33');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#a3760a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(s.x, s.y + bob);
      ctx.fillStyle = '#5c3d00';
      ctx.font = `bold ${Math.max(9, Math.floor(s.radius * 0.65))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.points, 0, 1);
      ctx.restore();
    }
  }

  function drawSpeechBubble() {
    if (speechTimer <= 0 || !speechText) return;
    let alpha = 1;
    if (speechTimer < 15) alpha = speechTimer / 15;
    if (100 - speechTimer < 8) alpha = Math.min(alpha, (100 - speechTimer) / 8);

    ctx.save();
    ctx.translate(SHIP_X, shipY);
    ctx.globalAlpha = alpha;
    ctx.font = '12px system-ui, sans-serif';
    const textWidth = ctx.measureText(speechText).width;
    const padding = 8;
    const bw = textWidth + padding * 2;
    const bh = 22;
    const bx = 8;
    const by = -38;

    ctx.fillStyle = '#f4f6ff';
    ctx.beginPath();
    ctx.moveTo(bx + 6, by);
    ctx.lineTo(bx + bw - 6, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + 6);
    ctx.lineTo(bx + bw, by + bh - 6);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - 6, by + bh);
    ctx.lineTo(bx + 18, by + bh);
    ctx.lineTo(bx + 10, by + bh + 8);
    ctx.lineTo(bx + 12, by + bh);
    ctx.lineTo(bx + 6, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - 6);
    ctx.lineTo(bx, by + 6);
    ctx.quadraticCurveTo(bx, by, bx + 6, by);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#12131c';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(speechText, bx + padding, by + bh / 2);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function shadedFill(palette, radius) {
    const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, Math.max(radius * 0.15, 1), 0, 0, radius);
    grad.addColorStop(0, palette.light);
    grad.addColorStop(0.6, palette.base);
    grad.addColorStop(1, palette.dark);
    return grad;
  }

  function drawAsteroid(o) {
    ctx.save();
    ctx.translate(o.x, o.y);

    if (o.shape === 'circle') {
      ctx.fillStyle = shadedFill(o.palette, o.radius);
      ctx.beginPath();
      ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = o.palette.dark;
      for (const c of o.craters) {
        ctx.beginPath();
        ctx.arc(c.dx, c.dy, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (o.shape === 'cluster') {
      for (const c of o.circles) {
        ctx.save();
        ctx.translate(c.dx, c.dy);
        ctx.fillStyle = shadedFill(o.palette, c.r);
        ctx.beginPath();
        ctx.arc(0, 0, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.rotate(o.rotation);
      ctx.fillStyle = shadedFill(o.palette, o.radius);
      ctx.beginPath();
      o.points.forEach((p, i) => {
        const px = Math.cos(p.angle) * p.r;
        const py = Math.sin(p.angle) * p.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = o.palette.dark;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = o.palette.dark;
      for (const c of o.craters) {
        ctx.beginPath();
        ctx.arc(c.dx, c.dy, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawObstacles() {
    for (const o of obstacles) drawAsteroid(o);
  }

  function drawScore() {
    ctx.fillStyle = '#e8ecff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(score, W / 2, 50);
  }

  function drawStars() {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97) % W;
      const sy = (i * 53) % H;
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawStars();
    if (state !== 'START') {
      drawObstacles();
      drawCollectibles();
      drawBlasts();
      drawExplosions();
      if (state === 'DYING') {
        drawShipDebris();
      } else if (state === 'PLAYING') {
        drawShip();
        drawSpeechBubble();
      }
    }
    if (state === 'PLAYING' || state === 'DYING' || state === 'GAMEOVER') {
      drawScore();
    }
  }

  function loop() {
    if (state === 'PLAYING' || state === 'DYING') update();
    render();
    requestAnimationFrame(loop);
  }

  function canvasPointerY(clientY) {
    const rect = canvas.getBoundingClientRect();
    return (clientY - rect.top) * (H / rect.height);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      thrustUp();
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      thrustDown();
    } else if (e.code === 'Space') {
      e.preventDefault();
      fireBlast();
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    const y = canvasPointerY(e.clientY);
    if (y < H / 2) thrustUp();
    else thrustDown();
  });

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const y = canvasPointerY(touch.clientY);
    if (y < H / 2) thrustUp();
    else thrustDown();
  }, { passive: false });

  fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    fireBlast();
  }, { passive: false });

  fireBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fireBlast();
  });

  startBtn.addEventListener('click', resetState);
  restartBtn.addEventListener('click', resetState);

  muteBtn.addEventListener('click', () => setMuted(!muted));
  setMuted(muted);

  render();
  requestAnimationFrame(loop);
})();
