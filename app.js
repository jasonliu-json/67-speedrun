/* ==========================================================================
   67 LOW EFFORT CHALLENGE - CV Logic & Game Loop
   ========================================================================== */

// Game States
const STATE_LOADING = 'loading';
const STATE_CALIBRATING = 'calibrating';
const STATE_COUNTDOWN = 'countdown';
const STATE_PLAYING = 'playing';
const STATE_GAMEOVER = 'gameover';

let gameState = STATE_LOADING;

// Game Settings
const GAME_DURATION = 6700; // 6.7 seconds per game
const BOB_THRESHOLD = 0.035;   // Minimum Y movement amplitude (tuned for sensitivity)
const SMOOTHING_FACTOR = 1;   // Look at one frame (no smoothing) for minimum latency

// Game variables
let score = 0;
let basePointsPerBob = 10;
let hype = 0; // 0 to 100
let combo = 0;
let multiplier = 1;
let timeLeft = GAME_DURATION;
let gameTimerInterval = null;
let countdownInterval = null;
let bobCount = 0;
let toiletActiveTimers = [0, 0, 0, 0];

// Telemetry / Speed calculation
let bobTimes = [];
let gps = 0;

// Active sign challenge state
let currentChallenge = 'scale';
let challengeTimer = 0;
let challengeDuration = 3000; // 3 seconds to make the sign in fast mode
let nextChallengeTime = 4000;

// Hand history tracker for CV math
const handHistory = {
  left: { yValues: [], minY: 1.0, maxY: 0.0, lastMidCrossDir: 0 },
  right: { yValues: [], minY: 1.0, maxY: 0.0, lastMidCrossDir: 0 }
};

// Auto-start calibration tracker
let countdownTimeLeft = 1500;
let lastFrameTimestamp = 0;
const CALIBRATION_REQUIRED_HOLD = 1500; // 1.5 seconds
let prevWristPositions = { left: null, right: null };
// Camera Snapshot variables
let snapshotTimeMs = 7500; // Target snapshot time (randomized each game)
let isSnapshotTaken = false;
let playerPhoto = null; // Stores base64 data URL
let flashOpacity = 0.0;
let lastGameScore = 0;
let hasPlayed = false;
let isCooldownActive = false;
let cooldownTimeLeft = 3;
let cooldownInterval = null;

// Floating text animations
let floatingTexts = [];

// Audio System (Web Audio API Synth)
let audioCtx = null;
let bgMusicInterval = null;
let bgBeatStep = 0;
let isAudioMuted = true;
let shouldSaveScore = false;

// DOM Elements
const videoEl = document.getElementById('webcam-video');
const canvasEl = document.getElementById('game-canvas');
const ctx = canvasEl.getContext('2d');

const timerValEl = document.getElementById('timer-val');
const scoreValEl = document.getElementById('score-val');
const multiplierValEl = document.getElementById('multiplier-val');
const comboBarFillEl = document.getElementById('combo-bar-fill');
const gpsValEl = document.getElementById('gps-val');
const hypeTierValEl = document.getElementById('hype-tier-val');

const loadingOverlay = document.getElementById('loading-overlay');
const startOverlay = document.getElementById('start-overlay');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownValEl = document.getElementById('countdown-val');
const btnAudioToggle = document.getElementById('btn-audio-toggle');
const btnSaveToggle = document.getElementById('btn-save-toggle');
const sliderCameraSize = document.getElementById('slider-camera-size');
const cameraSizeDisplay = document.getElementById('camera-size-display');
const savePromptOverlay = document.getElementById('save-prompt-overlay');
const promptScoreVal = document.getElementById('prompt-score-val');
const promptPreviewImg = document.getElementById('prompt-preview-img');
const btnSaveYes = document.getElementById('btn-save-yes');
const btnSaveNo = document.getElementById('btn-save-no');
const promptQuestionText = document.getElementById('prompt-question-text');
const promptBtnGroup = document.getElementById('prompt-btn-group');
const calibrationStatusEl = document.getElementById('calibration-status');
const startGameoverBanner = document.getElementById('start-gameover-banner');
const startFinalScoreVal = document.getElementById('start-final-score-val');

const toiletPops = [
  document.getElementById('toilet-pop-tl'),
  document.getElementById('toilet-pop-tr'),
  document.getElementById('toilet-pop-bl'),
  document.getElementById('toilet-pop-br')
];

const hypeFillBarEl = document.getElementById('hype-fill-bar');
const hypeFlameValEl = document.getElementById('hype-flame-val');
const hypePercentTextEl = document.getElementById('hype-percent-text');

const challengeBoxEl = document.getElementById('challenge-box');
const challengeTextEl = document.getElementById('challenge-text');
const challengeIconEl = document.getElementById('challenge-icon');

const leaderboardCardsContainer = document.getElementById('leaderboard-cards-container');
const canvasContainerEl = document.querySelector('.canvas-container');

// Leaderboard Initial Data (Starts empty)
const DEFAULT_LEADERBOARD = [];

/* ==========================================================================
   Sound Synthesis Engine (Web Audio API)
   ========================================================================== */

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
  if (isAudioMuted || !audioCtx) return;
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'tick') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } 
  else if (type === 'go') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } 
  else if (type === 'bob') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(660, now + 0.04);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } 
  else if (type === 'combo') {
    osc.type = 'sine';
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, index) => {
      const noteTime = now + (index * 0.06);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, noteTime);
      g.gain.setValueAtTime(0.2, noteTime);
      g.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.12);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(noteTime);
      o.stop(noteTime + 0.12);
    });
  } 
  else if (type === 'shutter') {
    // White noise camera shutter burst
    const bufferSize = audioCtx.sampleRate * 0.15;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    noiseNode.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    
    noiseNode.start(now);
    noiseNode.stop(now + 0.15);
  }
  else if (type === 'gameover') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(40, now + 0.5);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.start(now);
    osc.stop(now + 0.6);
  }
  else if (type === 'toggle') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.linearRampToValueAtTime(300, now + 0.15);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  }
  else if (type === 'yes') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.08);
    osc.frequency.setValueAtTime(783.99, now + 0.16);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }
  else if (type === 'no') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(150, now + 0.35);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  }
}

// Background drill bass track scheduler
function startBassTrack() {
  if (bgMusicInterval) clearInterval(bgMusicInterval);
  
  bgBeatStep = 0;
  
  const tickTime = () => {
    let bpm = 120 + (hype * 0.5); // Speed runs up to 170BPM
    let stepDuration = (60 / bpm) / 2;
    
    playBassStep();
    bgMusicInterval = setTimeout(tickTime, stepDuration * 1000);
  };
  
  tickTime();
}

function stopBassTrack() {
  if (bgMusicInterval) {
    clearTimeout(bgMusicInterval);
    bgMusicInterval = null;
  }
}

function playBassStep() {
  if (isAudioMuted || !audioCtx || gameState !== STATE_PLAYING) return;
  
  const step = bgBeatStep % 16;
  bgBeatStep++;
  
  const now = audioCtx.currentTime;
  
  let rootFreq = 50; 
  if (step >= 4 && step < 8) rootFreq = 60; 
  else if (step >= 8 && step < 12) rootFreq = 45; 
  else if (step >= 12) rootFreq = 40; 
  
  const isBassPluck = [0, 3, 6, 8, 11, 14].includes(step);
  const isKick = [0, 8].includes(step);
  
  if (isKick) {
    const kickOsc = audioCtx.createOscillator();
    const kickGain = audioCtx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(100, now);
    kickOsc.frequency.exponentialRampToValueAtTime(30, now + 0.1);
    kickGain.gain.setValueAtTime(0.4, now);
    kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    kickOsc.connect(kickGain);
    kickGain.connect(audioCtx.destination);
    kickOsc.start(now);
    kickOsc.stop(now + 0.12);
  }
  
  if (isBassPluck) {
    const bassOsc = audioCtx.createOscillator();
    const bassGain = audioCtx.createGain();
    bassOsc.type = 'triangle';
    bassOsc.frequency.setValueAtTime(rootFreq, now);
    bassOsc.frequency.exponentialRampToValueAtTime(rootFreq * 0.85, now + 0.15);
    
    const vol = (multiplier >= 5) ? 0.4 : 0.25;
    bassGain.gain.setValueAtTime(vol, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    
    bassOsc.connect(bassGain);
    bassGain.connect(audioCtx.destination);
    bassOsc.start(now);
    bassOsc.stop(now + 0.2);
  }
}

/* ==========================================================================
   UI Controls & Init
   ========================================================================== */

if (btnAudioToggle) {
  btnAudioToggle.addEventListener('click', () => {
    initAudio();
    isAudioMuted = !isAudioMuted;
    
    if (isAudioMuted) {
      btnAudioToggle.classList.add('muted');
      btnAudioToggle.querySelector('.icon').innerText = '🔇';
      btnAudioToggle.querySelector('.label').innerText = 'SOUND OFF';
      stopBassTrack();
    } else {
      btnAudioToggle.classList.remove('muted');
      btnAudioToggle.querySelector('.icon').innerText = '🔊';
      btnAudioToggle.querySelector('.label').innerText = 'SOUND ON';
      if (gameState === STATE_PLAYING) {
        startBassTrack();
      }
    }
  });
}

btnSaveToggle.addEventListener('click', () => {
  initAudio();
  shouldSaveScore = !shouldSaveScore;
  if (shouldSaveScore) {
    btnSaveToggle.classList.remove('muted');
    btnSaveToggle.querySelector('.icon').innerText = '💾';
    btnSaveToggle.querySelector('.label').innerText = 'SAVE: ON';
  } else {
    btnSaveToggle.classList.add('muted');
    btnSaveToggle.querySelector('.icon').innerText = '❌';
    btnSaveToggle.querySelector('.label').innerText = 'SAVE: OFF';
  }
  playSound('toggle');
});

function showSavePromptOverlay(finalScore, isAuto = false) {
  if (promptScoreVal) promptScoreVal.innerText = finalScore;
  if (promptPreviewImg) {
    if (playerPhoto) {
      promptPreviewImg.src = playerPhoto;
      promptPreviewImg.style.display = 'block';
    } else {
      promptPreviewImg.src = '';
      promptPreviewImg.style.display = 'none';
    }
  }
  if (promptQuestionText) {
    promptQuestionText.innerText = isAuto 
      ? 'SAVING TO LEADERBOARD AUTOMATICALLY...' 
      : 'DO YOU WANT TO SAVE YOUR PICTURE AND SCORE ON THE LEADERBOARD?';
  }
  if (promptBtnGroup) {
    promptBtnGroup.style.display = isAuto ? 'none' : 'flex';
  }
  if (savePromptOverlay) savePromptOverlay.style.display = 'flex';
}

function hideSavePromptOverlay() {
  if (savePromptOverlay) savePromptOverlay.style.display = 'none';
}

if (btnSaveYes) {
  btnSaveYes.addEventListener('click', () => {
    initAudio();
    playSound('yes');
    hideSavePromptOverlay();
    saveScore(score, true);
    loadLeaderboard();
    
    lastGameScore = score;
    hasPlayed = true;

    resetGameStats();
    setGameState(STATE_CALIBRATING);
    startCooldown();
  });
}

if (btnSaveNo) {
  btnSaveNo.addEventListener('click', () => {
    initAudio();
    playSound('no');
    hideSavePromptOverlay();
    
    lastGameScore = score;
    hasPlayed = true;

    resetGameStats();
    setGameState(STATE_CALIBRATING);
    startCooldown();
  });
}

if (sliderCameraSize) {
  const updateCameraSize = () => {
    const w = parseInt(sliderCameraSize.value);
    const h = Math.round(w * 0.75); // Maintain 4:3 aspect ratio
    
    if (canvasContainerEl) {
      canvasContainerEl.style.width = `${w}px`;
      canvasContainerEl.style.height = `${h}px`;
    }
    
    requestAnimationFrame(() => {
      if (canvasContainerEl && cameraSizeDisplay) {
        const rect = canvasContainerEl.getBoundingClientRect();
        const actualW = Math.round(rect.width);
        const actualH = Math.round(rect.height);
        cameraSizeDisplay.innerText = `${actualW}px × ${actualH}px`;
      }
    });
  };
  
  sliderCameraSize.addEventListener('input', updateCameraSize);
  updateCameraSize(); // Sync initially
  window.addEventListener('resize', updateCameraSize); // Sync on window resizing
}

// Load Leaderboard from localStorage
function loadLeaderboard() {
  let board = localStorage.getItem('hype_leaderboard_v7');
  if (!board) {
    localStorage.setItem('hype_leaderboard_v7', JSON.stringify(DEFAULT_LEADERBOARD));
    board = JSON.stringify(DEFAULT_LEADERBOARD);
  }
  const scores = JSON.parse(board);
  scores.sort((a, b) => b.score - a.score);

  leaderboardCardsContainer.innerHTML = '';
  
  // Show only the Top 3 scores beside their photo cards
  scores.slice(0, 3).forEach((entry, i) => {
    const card = document.createElement('div');
    
    const isPlayerMatch = gameState === STATE_GAMEOVER && 
                           entry.score === score && 
                           entry.photo === playerPhoto;
                           
    if (isPlayerMatch) {
      card.classList.add('rank-highlight');
    }
    
    // Zoomed-in Photo box (blank if no photo present)
    let photoHTML = '';
    if (entry.photo) {
      photoHTML = `<div class="leaderboard-img-wrapper"><img src="${entry.photo}" alt="Face"></div>`;
    } else {
      photoHTML = `<div class="leaderboard-img-wrapper"></div>`;
    }
    
    const rankLabels = ['1st Place', '2nd Place', '3rd Place'];
    const cardClass = `rank-${i+1}`;
    
    card.className = `leaderboard-card ${cardClass}`;
    card.innerHTML = `
      ${photoHTML}
      <div class="leaderboard-card-info">
        <div class="leaderboard-card-rank">${rankLabels[i]}</div>
        <div class="leaderboard-card-score">${entry.score} PTS</div>
        <div class="leaderboard-card-tier">${escapeHTML(entry.tier)}</div>
      </div>
    `;
    leaderboardCardsContainer.appendChild(card);
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function qualifiesForTop3(scoreVal) {
  if (scoreVal <= 0) return false;
  let board = JSON.parse(localStorage.getItem('hype_leaderboard_v7') || '[]');
  board.sort((a, b) => b.score - a.score);
  if (board.length < 3) {
    return true;
  }
  return scoreVal >= board[2].score;
}

function saveScore(scoreVal, force = false) {
  if (!shouldSaveScore && !force) {
    console.log("Saving disabled by player.");
    return;
  }
  let board = JSON.parse(localStorage.getItem('hype_leaderboard_v7') || '[]');
  const tier = getHypeTier(scoreVal);
  
  // Create a new entry without name
  const newEntry = { score: scoreVal, tier: tier, photo: playerPhoto };
  board.push(newEntry);
  board.sort((a, b) => b.score - a.score);
  
  // Prune leaderboard to 10 entries max
  const top10 = board.slice(0, 10);
  
  // Crucial: Clear images for ranks index 3 and below (4th place and below)
  // to avoid hitting the 5MB browser localStorage limits.
  top10.forEach((entry, i) => {
    if (i >= 3) {
      entry.photo = null;
    }
  });
  
  localStorage.setItem('hype_leaderboard_v7', JSON.stringify(top10));
}

function getHypeTier(s) {
  if (s >= 1500) return '67 GOD! 👑';
  if (s >= 1000) return 'HYPE KING';
  if (s >= 500) return 'GROOVIN';
  if (s >= 200) return 'MIDDLING';
  return 'CHILLIN';
}

function resetGameStats() {
  score = 0;
  bobCount = 0;
  hype = 0;
  combo = 0;
  multiplier = 1;
  timeLeft = GAME_DURATION;
  bobTimes = [];
  gps = 0;
  floatingTexts = [];
  currentChallenge = 'scale';
  challengeTimer = 0;
  nextChallengeTime = 4000;
  countdownTimeLeft = 1500;
  prevWristPositions = { left: null, right: null };
  isSnapshotTaken = false;
  playerPhoto = null;
  flashOpacity = 0.0;
  
  handHistory.left.yValues = [];
  handHistory.right.yValues = [];
  handHistory.left.minY = 1.0;
  handHistory.left.maxY = 0.0;
  handHistory.right.minY = 1.0;
  handHistory.right.maxY = 0.0;
  
  scoreValEl.innerText = '00000';
  multiplierValEl.innerText = 'x1';
  comboBarFillEl.style.width = '0%';
  gpsValEl.innerText = '0.0';
  hypeTierValEl.innerText = "CHILLIN'";
  if (hypeFillBarEl) hypeFillBarEl.style.height = '0%';
  if (hypePercentTextEl) hypePercentTextEl.innerText = '0%';
  timerValEl.innerText = `${(GAME_DURATION / 1000).toFixed(2)}s`;
  canvasContainerEl.className = 'canvas-container';
}

/* ==========================================================================
   State Machine Management
   ========================================================================== */

function setGameState(newState) {
  gameState = newState;
  
  loadingOverlay.style.display = 'none';
  startOverlay.style.display = 'none';
  countdownOverlay.style.display = 'none';
  
  if (newState === STATE_LOADING) {
    loadingOverlay.style.display = 'flex';
  } 
  else if (newState === STATE_CALIBRATING) {
    startOverlay.style.display = 'flex';
    countdownTimeLeft = 1500;
    calibrationStatusEl.innerText = "Put both palms in screen view to activate...";
    
    // Display combined gameover banner inside start overlay if player just finished a game
    if (startGameoverBanner && startFinalScoreVal) {
      if (hasPlayed) {
        startFinalScoreVal.innerText = lastGameScore;
        startGameoverBanner.style.display = 'block';
      } else {
        startGameoverBanner.style.display = 'none';
      }
    }
  } 
  else if (newState === STATE_COUNTDOWN) {
    countdownOverlay.style.display = 'flex';
    runCountdown();
  } 
  else if (newState === STATE_PLAYING) {
    // Select a random snapshot target time between 30% and 70% of game duration left
    snapshotTimeMs = GAME_DURATION * (0.3 + Math.random() * 0.4);
    isSnapshotTaken = false;
    playerPhoto = null;
    
    startGameLoop();
    if (!isAudioMuted) startBassTrack();
  } 
  else if (newState === STATE_GAMEOVER) {
    playSound('gameover');
    stopBassTrack();

    // If shouldSaveScore is ON, save automatically
    if (shouldSaveScore) {
      saveScore(score);
      loadLeaderboard();

      // Save final score and flag for combined starting overlay
      lastGameScore = score;
      hasPlayed = true;

      // BUT if it qualifies for top 3, still show the trophy page and auto-proceed
      if (qualifiesForTop3(score)) {
        showSavePromptOverlay(score, true);
        spawnSkullBurst();
        
        resetGameStats();
        setGameState(STATE_CALIBRATING);
        startCooldown();
      } else {
        // Transition immediately back to calibration ready state
        resetGameStats();
        spawnSkullBurst();
        setGameState(STATE_CALIBRATING);

        // Start 3-second cooldown
        startCooldown();
      }
    } 
    // If shouldSaveScore is OFF, check if it qualifies for top 3 and prompt
    else if (qualifiesForTop3(score)) {
      showSavePromptOverlay(score, false);
      spawnSkullBurst();
    } 
    // If shouldSaveScore is OFF and not in top 3, proceed without saving/prompting
    else {
      lastGameScore = score;
      hasPlayed = true;

      resetGameStats();
      spawnSkullBurst();
      setGameState(STATE_CALIBRATING);

      // Start 3-second cooldown
      startCooldown();
    }
  }
}

function startCooldown() {
  isCooldownActive = true;
  cooldownTimeLeft = 3;
  
  const startBlocker = document.getElementById('btn-start-game');
  if (startBlocker) {
    startBlocker.innerText = `NEXT GAME IN ${cooldownTimeLeft}s`;
    startBlocker.classList.add('cooldown-mode');
  }
  
  if (cooldownInterval) clearInterval(cooldownInterval);
  cooldownInterval = setInterval(() => {
    cooldownTimeLeft--;
    if (cooldownTimeLeft > 0) {
      if (startBlocker) {
        startBlocker.innerText = `NEXT GAME IN ${cooldownTimeLeft}s`;
      }
    } else {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      isCooldownActive = false;
      if (startBlocker) {
        startBlocker.innerText = 'WAITING FOR PALMS...';
        startBlocker.classList.remove('cooldown-mode');
      }
      hideSavePromptOverlay();
    }
  }, 1000);
}

function runCountdown() {
  countdownTimeLeft = 1500;
  countdownValEl.innerText = '3';
  playSound('tick');
  
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    countdownTimeLeft -= 100;
    if (countdownTimeLeft > 0) {
      if (countdownTimeLeft === 1000) {
        countdownValEl.innerText = '2';
        playSound('tick');
      } else if (countdownTimeLeft === 500) {
        countdownValEl.innerText = '1';
        playSound('tick');
      }
    } else if (countdownTimeLeft === 0) {
      countdownValEl.innerText = 'GO!';
      playSound('go');
    } else if (countdownTimeLeft <= -400) {
      clearInterval(countdownInterval);
      setGameState(STATE_PLAYING);
    }
  }, 100);
}

function startGameLoop() {
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  gameTimerInterval = setInterval(() => {
    timeLeft -= 100;
    
    // Capture camera snapshot at target time
    if (timeLeft <= snapshotTimeMs && !isSnapshotTaken) {
      takeSnapshot();
      isSnapshotTaken = true;
    }

    decayHype();

    if (timeLeft <= 0) {
      timeLeft = 0;
      clearInterval(gameTimerInterval);
      setGameState(STATE_GAMEOVER);
    }
    
    const formattedTime = (timeLeft / 1000).toFixed(2);
    timerValEl.innerText = `${formattedTime}s`;
  }, 100);
}

// Decay Hype Meter
function decayHype() {
  const decayRate = 1.2 + (multiplier * 0.6);
  if (gps < 2.0) {
    hype = Math.max(0, hype - decayRate);
  } else if (gps < 4.0) {
    hype = Math.max(0, hype - (decayRate * 0.4));
  } else {
    hype = Math.min(100, hype + 0.3);
  }
  updateHypeUI();
}

function triggerChallengeScale() {
  currentChallenge = 'scale';
  nextChallengeTime = 3000 + Math.random() * 3000;
  
  if (challengeBoxEl) challengeBoxEl.className = 'challenge-box';
  if (challengeTextEl) challengeTextEl.innerText = 'BOB PALMS UP AND DOWN';
  if (challengeIconEl) challengeIconEl.innerText = '👐';
}

function triggerNewSignChallenge() {
  currentChallenge = Math.random() > 0.5 ? 'sign6' : 'sign7';
  challengeTimer = challengeDuration;
  
  if (challengeBoxEl) {
    if (currentChallenge === 'sign6') {
      challengeBoxEl.className = 'challenge-box highlight-red';
      if (challengeTextEl) challengeTextEl.innerText = 'DO SIGN 6!';
      if (challengeIconEl) challengeIconEl.innerText = '🤙';
    } else {
      challengeBoxEl.className = 'challenge-box highlight-blue';
      if (challengeTextEl) challengeTextEl.innerText = 'DO SIGN 7!';
      if (challengeIconEl) challengeIconEl.innerText = '👌';
    }
  }
  
  playSound('tick');
}

/* ==========================================================================
   Webcam Capture Snapshot Functionality
   ========================================================================== */

function takeSnapshot() {
  playSound('shutter');
  
  // Draw current video frame to a higher-definition offscreen canvas (320x240)
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = 320;
  snapCanvas.height = 240;
  const snapCtx = snapCanvas.getContext('2d');
  
  // Mirror frame to match the display
  snapCtx.translate(snapCanvas.width, 0);
  snapCtx.scale(-1, 1);
  
  try {
    // Zoom in slightly on the center of the video frame
    const vw = videoEl.videoWidth || 640;
    const vh = videoEl.videoHeight || 480;
    const zoom = 1.35; // 1.35x zoom on face area
    const sw = vw / zoom;
    const sh = vh / zoom;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    
    // Draw the raw webcam stream with the zoom crop
    snapCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, snapCanvas.width, snapCanvas.height);
    playerPhoto = snapCanvas.toDataURL('image/jpeg', 0.8);
  } catch (err) {
    console.error("Failed to capture snapshot: ", err);
    playerPhoto = null;
  }
}

/* ==========================================================================
   Telemetry UI Updaters
   ========================================================================== */

function addFloatingText(x, y, text, color) {
  floatingTexts.push({
    x: x,
    y: y,
    text: text,
    color: color,
    opacity: 1.0,
    life: 25
  });
}

function updateHypeUI() {
  if (hypeFillBarEl) hypeFillBarEl.style.height = `${hype}%`;
  if (hypePercentTextEl) hypePercentTextEl.innerText = `${Math.round(hype)}%`;
  if (hypeFlameValEl) hypeFlameValEl.style.bottom = `calc(${hype}% - 12px)`;
  
  let newMult = 1;
  let tier = "CHILLIN'";
  
  if (hype >= 85) {
    newMult = 5;
    tier = '67 GOD! 🚀';
    canvasContainerEl.className = 'canvas-container hype-super-border';
  } else if (hype >= 50) {
    newMult = 3;
    tier = 'HYPE!';
    canvasContainerEl.className = 'canvas-container hype-active-border';
  } else if (hype >= 20) {
    newMult = 2;
    tier = 'GROOVIN';
    canvasContainerEl.className = 'canvas-container';
  } else {
    newMult = 1;
    tier = "CHILLIN'";
    canvasContainerEl.className = 'canvas-container';
  }
  
  multiplier = newMult;
  multiplierValEl.innerText = `x${multiplier}`;
  hypeTierValEl.innerText = tier;
  
  let progress = 0;
  if (multiplier === 1) progress = (hype / 20) * 100;
  else if (multiplier === 2) progress = ((hype - 20) / 30) * 100;
  else if (multiplier === 3) progress = ((hype - 50) / 35) * 100;
  else progress = 100;
  
  comboBarFillEl.style.width = `${progress}%`;
}

function scorePoints(baseAmt, isChallenge = false) {
  const pointsGained = baseAmt * multiplier;
  score += pointsGained;
  scoreValEl.innerText = String(score).padStart(5, '0');
  
  let hypeGain = isChallenge ? 20 : 1.5;
  hype = Math.min(100, hype + hypeGain);
  updateHypeUI();
}

function calculateGPS() {
  const now = performance.now();
  bobTimes = bobTimes.filter(t => now - t < 3000);
  
  if (bobTimes.length > 0) {
    gps = (bobTimes.length / 3).toFixed(1);
  } else {
    gps = '0.0';
  }
  gpsValEl.innerText = gps;
}

/* ==========================================================================
   Computer Vision Mechanics & Hands-Free Calibration Start
   ========================================================================== */

function landmarkDistance(l1, l2) {
  return Math.sqrt(
    Math.pow(l1.x - l2.x, 2) +
    Math.pow(l1.y - l2.y, 2) +
    Math.pow(l1.z - l2.z, 2)
  );
}

function isFingerExtended(tipIdx, pipIdx, wristLandmark, landmarks) {
  const tipDist = landmarkDistance(landmarks[tipIdx], wristLandmark);
  const pipDist = landmarkDistance(landmarks[pipIdx], wristLandmark);
  return tipDist > pipDist * 1.1;
}

function processHandGestures(results) {
  if (gameState !== STATE_PLAYING && gameState !== STATE_CALIBRATING && gameState !== STATE_COUNTDOWN) return;
  
  const handsDetected = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
  
  let frameLeftHand = null;
  let frameRightHand = null;

  // Position-based left/right hand assignment (immune to MediaPipe handedness misclassification)
  if (handsDetected >= 2) {
    const hand1 = results.multiHandLandmarks[0];
    const hand2 = results.multiHandLandmarks[1];
    
    // Sort visually left-to-right (lower X coordinate is screen left)
    if (hand1[0].x < hand2[0].x) {
      frameLeftHand = hand1;
      frameRightHand = hand2;
    } else {
      frameLeftHand = hand2;
      frameRightHand = hand1;
    }
  } else if (handsDetected === 1) {
    const hand = results.multiHandLandmarks[0];
    if (hand[0].x < 0.5) {
      frameLeftHand = hand;
    } else {
      frameRightHand = hand;
    }
  }

  // Calibration state: start countdown immediately when hands are in position
  if (gameState === STATE_CALIBRATING) {
    if (handsDetected >= 2) {
      if (!isCooldownActive) {
        setGameState(STATE_COUNTDOWN);
      }
    } else {
      if (!isCooldownActive) {
        calibrationStatusEl.innerText = "Waiting for BOTH hands to appear...";
      } else {
        calibrationStatusEl.innerText = "Game Over! Cooldown active...";
      }
    }
    return;
  }

  // Countdown state: abort countdown if hands leave position
  if (gameState === STATE_COUNTDOWN) {
    if (handsDetected < 2) {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      setGameState(STATE_CALIBRATING);
    }
    return;
  }
  
  if (handsDetected === 0) return;

  // 1. Process finger-signs challenge
  if (currentChallenge === 'sign6' || currentChallenge === 'sign7') {
    let challengeComplete = false;
    let handToHighlight = null;

    [frameLeftHand, frameRightHand].forEach(hand => {
      if (!hand) return;

      const wrist = hand[0];
      const thumbTip = hand[4];
      const indexTip = hand[8];
      const middleTip = hand[12];
      const ringTip = hand[16];
      const pinkyTip = hand[20];

      if (currentChallenge === 'sign6') {
        const touchDist = landmarkDistance(thumbTip, pinkyTip);
        const idxExt = isFingerExtended(8, 6, wrist, hand);
        const midExt = isFingerExtended(12, 10, wrist, hand);
        const ringExt = isFingerExtended(16, 14, wrist, hand);
        const pinkyExt = isFingerExtended(20, 18, wrist, hand);

        if (touchDist < 0.09 && idxExt && midExt && ringExt && !pinkyExt) {
          challengeComplete = true;
          handToHighlight = hand;
        }
      } 
      else if (currentChallenge === 'sign7') {
        const touchDist = landmarkDistance(thumbTip, ringTip);
        const idxExt = isFingerExtended(8, 6, wrist, hand);
        const midExt = isFingerExtended(12, 10, wrist, hand);
        const pinkyExt = isFingerExtended(20, 18, wrist, hand);
        const ringExt = isFingerExtended(16, 14, wrist, hand);

        if (touchDist < 0.09 && idxExt && midExt && pinkyExt && !ringExt) {
          challengeComplete = true;
          handToHighlight = hand;
        }
      }
    });

    if (challengeComplete && handToHighlight) {
      playSound('combo');
      const textX = handToHighlight[0].x * canvasEl.width;
      const textY = handToHighlight[0].y * canvasEl.height - 30;
      addFloatingText(textX, textY, `+100 BONUS!`, '#ff00ff');
      scorePoints(100, true);
      triggerChallengeScale();
    }
  }

  // 2. Process primary bobbing (rhythmic scale)
  if (frameLeftHand && frameRightHand) {
    trackBobbingScale(frameLeftHand, frameRightHand);
  }
}

function trackBobbingScale(leftHand, rightHand) {
  const leftY = leftHand[9].y; // Track middle finger MCP joint (palm center) instead of wrist
  const rightY = rightHand[9].y;
  
  const historyL = handHistory.left;
  const historyR = handHistory.right;

  historyL.yValues.push(leftY);
  historyR.yValues.push(rightY);
  if (historyL.yValues.length > 20) {
    historyL.yValues.shift();
    historyR.yValues.shift();
  }

  let smoothYL = 0;
  let smoothYR = 0;
  const len = Math.min(SMOOTHING_FACTOR, historyL.yValues.length);
  for (let i = 1; i <= len; i++) {
    smoothYL += historyL.yValues[historyL.yValues.length - i];
    smoothYR += historyR.yValues[historyR.yValues.length - i];
  }
  smoothYL /= len;
  smoothYR /= len;

  historyL.minY = Math.min(historyL.minY, smoothYL);
  historyL.maxY = Math.max(historyL.maxY, smoothYL);
  historyR.minY = Math.min(historyR.minY, smoothYR);
  historyR.maxY = Math.max(historyR.maxY, smoothYR);

  const midL = (historyL.minY + historyL.maxY) / 2;
  const midR = (historyR.minY + historyR.maxY) / 2;
  
  const ampL = historyL.maxY - historyL.minY;
  const ampR = historyR.maxY - historyR.minY;

  if (ampL > BOB_THRESHOLD && ampR > BOB_THRESHOLD) {
    const currentCrossL = (smoothYL > midL) ? 1 : -1;
    const currentCrossR = (smoothYR > midR) ? 1 : -1;

    if (historyL.lastMidCrossDir !== currentCrossL || historyR.lastMidCrossDir !== currentCrossR) {
      if (currentCrossL !== currentCrossR) {
        bobTimes.push(performance.now());
        playSound('bob');
        
        bobCount++;
        
        let floatingText = `+${basePointsPerBob * multiplier}`;
        let textColor = '#ff0000';
        let customSize = 20;
        
        const isDiv3 = (bobCount % 3 === 0);
        const isDiv5 = (bobCount % 5 === 0);
        
        if (isDiv3 && isDiv5) {
          const slangBoth = [
            'SKIBIDI SIGMA!', 'OHIO GYATT!', 'LEVEL 10 RIZZ!', 'FANUM TAXED!', 'MEWING CHAMP!'
          ];
          floatingText = slangBoth[Math.floor(Math.random() * slangBoth.length)];
          textColor = '#ff00ff';
          customSize = 28;
        } else if (isDiv3) {
          const slang3 = [
            'RIZZLER', 'SKIBIDI', 'GYATT', 'OHIO', 'SIGMA'
          ];
          floatingText = slang3[Math.floor(Math.random() * slang3.length)];
          textColor = '#ffff00';
          customSize = 24;
        } else if (isDiv5) {
          const slang5 = [
            'MEWING', 'LOOKSMAXXING', 'FANUM', 'GRIMACE', 'KAI CENAT'
          ];
          floatingText = slang5[Math.floor(Math.random() * slang5.length)];
          textColor = '#00ffff';
          customSize = 24;
        }
        
        const scoreX = (leftHand[9].x + rightHand[9].x) * 0.5 * canvasEl.width;
        const scoreY = Math.min(leftHand[9].y, rightHand[9].y) * canvasEl.height - 20;
        
        // Add floating text with custom sizes for brainrot
        floatingTexts.push({
          x: scoreX,
          y: scoreY,
          text: floatingText,
          color: textColor,
          fontSize: customSize,
          opacity: 1.0,
          life: 25
        });
        
        scorePoints(basePointsPerBob);
        
        historyL.lastMidCrossDir = currentCrossL;
        historyR.lastMidCrossDir = currentCrossR;
      }
    }
  }

  // Recalibrate margins faster
  historyL.minY += 0.002;
  historyL.maxY -= 0.002;
  historyR.minY += 0.002;
  historyR.maxY -= 0.002;
}

/* ==========================================================================
   Visual Rendering & Canvas Overlays
   ========================================================================== */

function drawScreen(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // 1. Draw webcam feed mirrored
  if (results.image) {
    ctx.translate(canvasEl.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);
    ctx.restore();
    ctx.save();
  } else {
    ctx.fillStyle = '#00ff00'; // Clashing green screen default
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  }

  // 2. Draw low-effort skeletons (Ugly circles + emoji fingertips)
  if (results.multiHandLandmarks) {
    results.multiHandLandmarks.forEach((landmarks, index) => {
      const handLabel = results.multiHandedness[index].label;
      const isLeftOnScreen = handLabel === 'Right';
      
      // Ugly clashing lines: red vs blue
      const lineColor = isLeftOnScreen ? '#ff0000' : '#0000ff';
      ctx.lineWidth = 6;
      ctx.strokeStyle = lineColor;

      // Draw quick shaky skeleton connections
      const fingers = [
        [0, 1, 2, 3, 4],
        [0, 5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
        [0, 17, 18, 19, 20]
      ];

      // Draw straight palms lines
      ctx.beginPath();
      const pt0 = mirrorPoint(landmarks[0]);
      const pt5 = mirrorPoint(landmarks[5]);
      const pt9 = mirrorPoint(landmarks[9]);
      const pt17 = mirrorPoint(landmarks[17]);
      ctx.moveTo(pt0.x, pt0.y);
      ctx.lineTo(pt5.x, pt5.y);
      ctx.lineTo(pt9.x, pt9.y);
      ctx.lineTo(pt17.x, pt17.y);
      ctx.closePath();
      ctx.stroke();

      fingers.forEach(chain => {
        ctx.beginPath();
        const start = mirrorPoint(landmarks[chain[0]]);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < chain.length; i++) {
          const pt = mirrorPoint(landmarks[chain[i]]);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      });

      // Emojis drawn at fingertips for brainrot low effort style
      // Landmark mapping: Thumb (4), Index (8), Middle (12), Ring (16), Pinky (20)
      const tipEmojis = {
        4: '👾',
        8: '👽',
        12: '🤡',
        16: '💀',
        20: '💩'
      };

      // Draw fingertip emojis
      ctx.font = '22px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      [4, 8, 12, 16, 20].forEach(tipIdx => {
        const pt = mirrorPoint(landmarks[tipIdx]);
        ctx.fillText(tipEmojis[tipIdx], pt.x, pt.y);
      });

      // Other joints drawn as plain white circles with black borders
      landmarks.forEach((lm, idx) => {
        if ([4, 8, 12, 16, 20].includes(idx)) return; // skip fingertips
        const pt = mirrorPoint(lm);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    });
  }

  ctx.restore();

  // 3. Render telemetry graphs (Oscillating sine wave visualization)
  if (gameState === STATE_PLAYING) {
    drawOscilloscope();
  }

  // 4. Render Floating Text effects
  renderFloatingTexts();

  // 5. White screen flash for camera shutter
  if (flashOpacity > 0.0) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.restore();
    flashOpacity -= 0.15; // Decays over ~6 frames
  }

  // 5.5 Update corner spinning toilet GIF popups
  updateToiletCornerPops();

  // 6. Shake screen on canvas
  if (gameState === STATE_PLAYING && multiplier >= 5) {
    canvasEl.classList.add('screen-shake-effect');
  } else {
    canvasEl.classList.remove('screen-shake-effect');
  }
}

function mirrorPoint(lm) {
  return {
    x: (1.0 - lm.x) * canvasEl.width,
    y: lm.y * canvasEl.height
  };
}

function drawOscilloscope() {
  const width = 120;
  const height = 40;
  const x = canvasEl.width - width - 15;
  const y = 15;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();

  const historyL = handHistory.left.yValues;
  const historyR = handHistory.right.yValues;
  
  if (historyL.length > 1) {
    // Left Hand Wave (Red)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    historyL.forEach((val, index) => {
      const ptX = x + (index / 20) * width;
      const ptY = y + (1.0 - val) * height;
      if (index === 0) ctx.moveTo(ptX, ptY);
      else ctx.lineTo(ptX, ptY);
    });
    ctx.stroke();

    // Right Hand Wave (Blue)
    ctx.strokeStyle = '#0000ff';
    ctx.beginPath();
    historyR.forEach((val, index) => {
      const ptX = x + (index / 20) * width;
      const ptY = y + (1.0 - val) * height;
      if (index === 0) ctx.moveTo(ptX, ptY);
      else ctx.lineTo(ptX, ptY);
    });
    ctx.stroke();
  }

  ctx.restore();
  ctx.font = 'bold 8px Arial';
  ctx.fillStyle = '#000';
  ctx.fillText('WAVES', x + 2, y + height + 9);
}

function spawnSkullBurst() {
  for (let i = 0; i < 25; i++) {
    const rx = Math.random() * canvasEl.width;
    const ry = Math.random() * canvasEl.height;
    floatingTexts.push({
      x: rx,
      y: ry,
      text: '💀',
      color: '#ff0000',
      fontSize: 35 + Math.random() * 25,
      opacity: 1.0,
      life: 40 + Math.random() * 30
    });
  }
}

const CORNER_EMOJIS = ['🤫', '🍷', '💀', '👑', '👽', '💩', '🤡', '🤖', '👾'];

function updateToiletCornerPops() {
  if (gameState !== STATE_PLAYING) {
    // Turn off all toilet popups
    toiletPops.forEach((el, idx) => {
      if (el) {
        el.classList.remove('toilet-active');
        const imgEl = el.querySelector('.pop-gif');
        const emojiEl = el.querySelector('.pop-emoji');
        if (imgEl) imgEl.style.display = 'none';
        if (emojiEl) emojiEl.style.display = 'none';
      }
      toiletActiveTimers[idx] = 0;
    });
    return;
  }

  // Decr active timers
  toiletActiveTimers.forEach((t, idx) => {
    if (t > 0) {
      toiletActiveTimers[idx]--;
      if (toiletActiveTimers[idx] <= 0) {
        if (toiletPops[idx]) {
          toiletPops[idx].classList.remove('toilet-active');
          const imgEl = toiletPops[idx].querySelector('.pop-gif');
          const emojiEl = toiletPops[idx].querySelector('.pop-emoji');
          if (imgEl) imgEl.style.display = 'none';
          if (emojiEl) emojiEl.style.display = 'none';
        }
      }
    }
  });

  // Randomly trigger a popup (approx 2% chance per frame)
  if (Math.random() < 0.02) {
    const inactiveIndices = [];
    toiletActiveTimers.forEach((t, idx) => {
      if (t <= 0) inactiveIndices.push(idx);
    });

    if (inactiveIndices.length > 0) {
      const targetIdx = inactiveIndices[Math.floor(Math.random() * inactiveIndices.length)];
      toiletActiveTimers[targetIdx] = 45; // ~1.5 seconds at 30fps
      
      const el = toiletPops[targetIdx];
      if (el) {
        const imgEl = el.querySelector('.pop-gif');
        const emojiEl = el.querySelector('.pop-emoji');
        
        // 50% chance for skibidi toilet GIF, 50% chance for random original emoji
        if (Math.random() < 0.5) {
          if (imgEl) imgEl.style.display = 'block';
          if (emojiEl) emojiEl.style.display = 'none';
        } else {
          if (imgEl) imgEl.style.display = 'none';
          if (emojiEl) {
            const randomEmoji = CORNER_EMOJIS[Math.floor(Math.random() * CORNER_EMOJIS.length)];
            emojiEl.innerText = randomEmoji;
            emojiEl.style.display = 'block';
          }
        }
        
        el.classList.add('toilet-active');
      }
    }
  }
}

function renderFloatingTexts() {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y -= 1.5;
    ft.opacity = ft.life / 25;
    ft.life--;

    ctx.save();
    const sz = ft.fontSize || 20;
    ctx.font = `bold ${sz}px "Arial"`;
    ctx.fillStyle = ft.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();

    if (ft.life <= 0) {
      floatingTexts.splice(i, 1);
    }
  }
}

function onResults(results) {
  processHandGestures(results);
  drawScreen(results);
  if (gameState === STATE_PLAYING) {
    calculateGPS();
  }
}

/* ==========================================================================
   MediaPipe Setup & Initializer
   ========================================================================== */

function initMediaPipe() {
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence: 0.65
  });

  hands.onResults(onResults);

  let isProcessingFrame = false;
  const camera = new Camera(videoEl, {
    onFrame: async () => {
      if (isProcessingFrame) {
        return; // Prevent concurrent hands.send calls
      }
      try {
        if (gameState === STATE_PLAYING || gameState === STATE_CALIBRATING || gameState === STATE_COUNTDOWN) {
          isProcessingFrame = true;
          await hands.send({ image: videoEl });
        } else {
          drawScreen({});
        }
      } catch (err) {
        console.error("Error in camera onFrame: ", err);
      } finally {
        isProcessingFrame = false;
      }
    },
    width: 640,
    height: 480
  });

  camera.start()
    .then(() => {
      loadLeaderboard();
      setGameState(STATE_CALIBRATING);
    })
    .catch(err => {
      console.error("Camera failed to start: ", err);
      calibrationStatusEl.innerText = "CAMERA FAIL: CHECK PERMISSIONS!";
    });
}

window.addEventListener('DOMContentLoaded', () => {
  localStorage.setItem('hype_leaderboard_v7', '[]'); // Clear leaderboard for now
  setGameState(STATE_LOADING);
  initMediaPipe();
});
