/* ─────────────────────────────────────────────────────────────────────────────
   EA Sports FC 26 Real-Time Multi-Agent AI Match Engine v5.1 (Bug Fix & Polish)
   
   Bug Fixes & Improvements:
     • Single-Trigger Goal Detection (guarantees score increases by exactly 1 per goal)
     • Goal Cooldown & Kickoff Reset Lock (prevents 60FPS multi-increment bug)
     • Realistic Shot & Goal Probability Engine (authentic football scores, e.g. 2-1, 1-0)
     • Out-of-Bounds & Goal Kick Reset Mechanics
     • Smooth Multi-Agent Player AI (Dribbling, Passing, Pressing, Shooting, GK Diving)
   ───────────────────────────────────────────────────────────────────────────── */





// Polyfill for roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    const rad = Math.min(r, Math.min(w, h) / 2);
    this.beginPath();
    this.moveTo(x + rad, y);
    this.arcTo(x + w, y, x + w, y + h, rad);
    this.arcTo(x + w, y + h, x, y + h, rad);
    this.arcTo(x, y + h, x, y, rad);
    this.arcTo(x, y, x + w, y, rad);
    this.closePath();
    return this;
  };
}

const W = 840, H = 450;
const PITCH_M = 18;

function applyLossForm(clubId, stateRef) {
  let squad = (stateRef.players || []).filter(player => player.clubId === clubId && !player.injury);
  if (clubId === stateRef.myClubId && stateRef.starters?.length) {
    squad = stateRef.starters.filter(player => player.clubId === clubId && !player.injury);
  } else {
    squad = squad
      .sort((a, b) => (stateRef.getEffectivePlayerOvr?.(b) ?? b.ovr ?? 0) - (stateRef.getEffectivePlayerOvr?.(a) ?? a.ovr ?? 0))
      .slice(0, 11);
  }

  squad.forEach(player => {
    player.formModifier = Math.max(-3, Math.min(3, (Number(player.formModifier) || 0) - 1));
  });
}
const GOAL_TOP = H / 2 - 42;
const GOAL_BOT = H / 2 + 42;
const MAX_COMM = 35;

class LiveMatchEngine {
  constructor(canvasId, fixture, onMatchFinished) {
    this.canvasId   = canvasId;
    this.fixture    = fixture;
    this.onFinished = onMatchFinished;
    this.canvas     = document.getElementById(canvasId);

    this.home = fixture.homeClub;
    this.away = fixture.awayClub;
    this.userSide = fixture.homeClub.id === state.myClubId ? 'home' : 'away';
    this.opponentSide = this.userSide === 'home' ? 'away' : 'home';

    // Match State
    this.homeScore = 0;
    this.awayScore = 0;
    this.minute    = 0;
    this.running   = false;
    this.speed     = 1;
    this.mentality = 'balanced';

    // Possession & Stats
    this.homePossTicks  = 0;
    this.awayPossTicks  = 0;
    this.possessionSide = 'home';
    this.commentary      = [];
    this.goalEvents      = [];
    this.cardEvents      = [];
    this.freeKickEvents  = [];
    this.penaltyShootout = null;
    this.stats = {
      home: { shots: 0, sot: 0, xG: 0, saves: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, freeKicks: 0 },
      away: { shots: 0, sot: 0, xG: 0, saves: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, freeKicks: 0 },
    };

    // Goal Lock Flag to prevent multi-trigger
    this.isGoalCooldown = false;

    // Loops & Timers
    this._rafId        = null;
    this._simTimerId   = null;
    this.goalFlashTime = 0;
    this.goalFlashSide = null;

    this._setupCanvas();
    this._initMatch();
    this._drawFrame();
  }

  _setupCanvas() {
    if (!this.canvas) return;
    this.canvas.width  = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
  }

  // ─── Match & Player AI Initialization ──────────────────────────────────────
  _initMatch() {
    this.isGoalCooldown = false;

    const mkPlayer = (role, side, num, bx, by, posName) => {
      let name = posName || role;
      const clubId = side === 'home' ? this.home.id : this.away.id;
      if (side === 'home' && state.starters?.length) {
        const match = state.starters.find(p => p.pos === role || p.pos === posName);
        if (match) name = match.name.split(' ').pop();
      } else {
        const pool = INITIAL_PLAYERS.filter(p => p.clubId === clubId && p.pos === role);
        if (pool.length) name = pool[0].name.split(' ').pop();
      }

      let fullName = name;
      let playerId = null;
      if (side === 'home' && clubId === state.myClubId && state.starters?.length) {
        const match = state.starters.find(p => p.pos === role || p.pos === posName);
        if (match) { name = match.name.split(' ').pop(); fullName = match.name; playerId = match.id; }
      } else if (side === 'away' && clubId === state.myClubId && state.starters?.length) {
        const match = state.starters.find(p => p.pos === role || p.pos === posName);
        if (match) { name = match.name.split(' ').pop(); fullName = match.name; playerId = match.id; }
      } else {
        const pool = (state.players || INITIAL_PLAYERS).filter(p => p.clubId === clubId && (p.pos === role || p.pos === posName));
        if (pool.length) { name = pool[0].name.split(' ').pop(); fullName = pool[0].name; playerId = pool[0].id; }
      }
      return {
        id: `${side}_${num}_${role}`,
        playerId,
        role, side, num, name, fullName,
        x: bx, y: by,
        bx, by,
        vx: 0, vy: 0,
        facing: side === 'home' ? 0 : Math.PI,
        maxSpeed: role === 'ST' || role === 'LW' || role === 'RW' ? 2.6 : role === 'GK' ? 1.8 : 2.1,
        actionTimer: Math.floor(Math.random() * 15),
        state: 'IDLE',
        yellows: 0,
        sentOff: false,
      };
    };

    // Home Team 4-3-3 (Attacking Right ->)
    this.homePlayers = [
      mkPlayer('GK',  'home', 1,  PITCH_M + 25,  H / 2, 'GK'),
      mkPlayer('LB',  'home', 3,  PITCH_M + 130, H * 0.15, 'LB'),
      mkPlayer('CB',  'home', 4,  PITCH_M + 115, H * 0.38, 'CB'),
      mkPlayer('CB',  'home', 5,  PITCH_M + 115, H * 0.62, 'CB'),
      mkPlayer('RB',  'home', 2,  PITCH_M + 130, H * 0.85, 'RB'),
      mkPlayer('CM',  'home', 8,  PITCH_M + 250, H * 0.28, 'CM'),
      mkPlayer('CDM', 'home', 6,  PITCH_M + 220, H / 2,    'CDM'),
      mkPlayer('CM',  'home', 10, PITCH_M + 250, H * 0.72, 'CM'),
      mkPlayer('LW',  'home', 7,  PITCH_M + 380, H * 0.18, 'LW'),
      mkPlayer('ST',  'home', 9,  PITCH_M + 400, H / 2,    'ST'),
      mkPlayer('RW',  'home', 11, PITCH_M + 380, H * 0.82, 'RW'),
    ];

    // Away Team 4-3-3 (Attacking Left <-)
    this.awayPlayers = [
      mkPlayer('GK',  'away', 1,  W - PITCH_M - 25,  H / 2, 'GK'),
      mkPlayer('LB',  'away', 3,  W - PITCH_M - 130, H * 0.85, 'LB'),
      mkPlayer('CB',  'away', 4,  W - PITCH_M - 115, H * 0.62, 'CB'),
      mkPlayer('CB',  'away', 5,  W - PITCH_M - 115, H * 0.38, 'CB'),
      mkPlayer('RB',  'away', 2,  W - PITCH_M - 130, H * 0.15, 'RB'),
      mkPlayer('CM',  'away', 8,  W - PITCH_M - 250, H * 0.72, 'CM'),
      mkPlayer('CDM', 'away', 6,  W - PITCH_M - 220, H / 2,    'CDM'),
      mkPlayer('CM',  'away', 10, W - PITCH_M - 250, H * 0.28, 'CM'),
      mkPlayer('LW',  'away', 7,  W - PITCH_M - 380, H * 0.85, 'LW'),
      mkPlayer('ST',  'away', 9,  W - PITCH_M - 400, H / 2,    'ST'),
      mkPlayer('RW',  'away', 11, W - PITCH_M - 380, H * 0.18, 'RW'),
    ];

    // Ball Simulation State
    const initialOwner = Math.random() > 0.5 ? this.homePlayers[6] : this.awayPlayers[6];
    this.ball = {
      x: initialOwner.x + 8, y: initialOwner.y, z: 0,
      vx: 0, vy: 0, vz: 0,
      owner: initialOwner,
      state: 'CARRIED',
    };
  }

  // ─── Public Controls ───────────────────────────────────────────────────────
  start() {
    if (this.running) return;
    this._resetMatch();
    this.running = true;
    state.playSound?.('whistle');
    this._addComm(`⚽ KICK-OFF! ${this.home.name} vs ${this.away.name}`, 'kickoff');
    this._startSimLoop();
    this._startRenderLoop();
  }

  stop() {
    this.running = false;
    if (this._simTimerId) { clearInterval(this._simTimerId); this._simTimerId = null; }
    if (this._rafId)      { cancelAnimationFrame(this._rafId);  this._rafId = null; }
  }

  setMentality(m) {
    if (this.mentality === m) return;
    this.mentality = m;
    const labels = { defensive: '🛡 DEFENSIVE', balanced: '⚖ BALANCED', attacking: '⚡ ATTACKING' };
    this._addComm(`Tactical switch → ${labels[m]}`, 'tactic');
  }

  setSpeed(s) {
    if (s === 0) {
      this.running = false;
      if (this._simTimerId) { clearInterval(this._simTimerId); this._simTimerId = null; }
      this._addComm(`⏸ MATCH PAUSED`, 'tactic');
    } else {
      this.speed = s;
      const wasRunning = this.running;
      this.running = true;
      if (!wasRunning) {
        this._startSimLoop();
        this._startRenderLoop();
      } else {
        this._startSimLoop();
      }
    }
  }


  _resetMatch() {
    this.minute        = 0;
    this.homeScore     = 0;
    this.awayScore     = 0;
    this.homePossTicks = 0;
    this.awayPossTicks = 0;
    this.possessionSide = 'home';
    this.commentary      = [];
    this.goalEvents      = [];
    this.cardEvents      = [];
    this.freeKickEvents  = [];
    this.penaltyShootout = null;
    this.stats = {
      home: { shots: 0, sot: 0, xG: 0, saves: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, freeKicks: 0 },
      away: { shots: 0, sot: 0, xG: 0, saves: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, freeKicks: 0 },
    };
    this.isGoalCooldown = false;
    this._initMatch();
  }

  _startSimLoop() {
    if (this._simTimerId) clearInterval(this._simTimerId);
    const msMap = { 1: 1000, 2: 400, 3: 150, 4: 60 };
    this._simTimerId = setInterval(() => this._simMinuteTick(), msMap[this.speed] || 1000);
  }

  _startRenderLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    const loop = () => {
      if (!this.running) return;
      this._updateEngineAI();
      this._drawFrame();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  // ─── Match Clock Minute Tick ───────────────────────────────────────────────
  _simMinuteTick() {
    if (!this.running) return;
    this.minute++;

    // Trigger interactive key decision moments at minute 24, 62, and 81
    if (this.minute === 24 || this.minute === 62 || this.minute === 81) {
      this.triggerInteractiveMoment();
      return;
    }

    if (this.ball.owner) {
      if (this.ball.owner.side === 'home') {
        this.homePossTicks++;
        this.possessionSide = 'home';
      } else {
        this.awayPossTicks++;
        this.possessionSide = 'away';
      }
    }

    // Simulate realistic fouls, yellow/red cards, and direct free kicks during play
    if (this.minute > 3 && this.minute < 89 && this.minute !== 45) {
      this._simulateDisciplineAndFreeKick();
    }

    if (this.minute === 45) {
      this._addComm(`🔔 HALF-TIME — ${this.home.name} ${this.homeScore}–${this.awayScore} ${this.away.name}`, 'halftime');
    } else if (this.minute >= 90) {
      this._finishMatch();
      return;
    }

    this._updateUI();
  }

  _pickFreeKickTaker(clubId) {
    const squad = clubId === state.myClubId && state.starters?.length
      ? state.starters.filter(p => p.pos !== 'GK')
      : (state.players || []).filter(p => p.clubId === clubId && p.pos !== 'GK');
    if (!squad.length) return { name: 'Set-Piece Specialist', ovr: 80, sho: 80, pas: 80, pos: 'CAM' };
    return [...squad].sort((a, b) => {
      const scoreA = (Number(a.sho) || Number(a.ovr) || 75) * 0.55 + (Number(a.pas) || Number(a.ovr) || 75) * 0.45;
      const scoreB = (Number(b.sho) || Number(b.ovr) || 75) * 0.55 + (Number(b.pas) || Number(b.ovr) || 75) * 0.45;
      return scoreB - scoreA;
    })[0];
  }

  _simulateDisciplineAndFreeKick() {
    const aggressionMod = this.mentality === 'attacking' ? 1.12 : this.mentality === 'defensive' ? 1.04 : 1.0;
    if (Math.random() > 0.072 * aggressionMod) return;

    const foulSide = Math.random() < 0.5 ? 'home' : 'away';
    const oppSide = foulSide === 'home' ? 'away' : 'home';
    const foulClub = foulSide === 'home' ? this.home : this.away;
    const oppClub = oppSide === 'home' ? this.home : this.away;

    this.stats[foulSide].fouls++;
    const activePlayers = (foulSide === 'home' ? this.homePlayers : this.awayPlayers).filter(p => !p.sentOff && p.role !== 'GK');
    if (!activePlayers.length) return;
    // Defenders and midfielders commit fouls more often
    const weighted = activePlayers.filter(p => ['CB', 'LB', 'RB', 'CDM', 'CM'].includes(p.role));
    const fouler = (weighted.length && Math.random() < 0.78)
      ? weighted[Math.floor(Math.random() * weighted.length)]
      : activePlayers[Math.floor(Math.random() * activePlayers.length)];

    // Card decision (~22% of fouls draw a yellow card, capped at 3 yellows per team)
    const cardRoll = Math.random();
    if (cardRoll < 0.22 && (this.stats[foulSide].yellowCards || 0) < 3) {
      // Yellow card (or 2nd yellow -> Red!)
      fouler.yellows = (fouler.yellows || 0) + 1;
      const statePlayer = fouler.playerId ? (state.players || []).find(p => p.id === fouler.playerId) : null;
      if (fouler.yellows >= 2) {
        fouler.sentOff = true;
        this.stats[foulSide].yellowCards++;
        this.stats[foulSide].redCards++;
        if (statePlayer) {
          statePlayer.yellowCards = (statePlayer.yellowCards || 0) + 1;
          statePlayer.redCards = (statePlayer.redCards || 0) + 1;
        }
        this.cardEvents.push({ minute: this.minute, side: foulSide, player: fouler.fullName || fouler.name, card: 'SECOND_YELLOW', clubName: foulClub.name });
        this._addComm(`🟨🟥 RED CARD! ${fouler.fullName || fouler.name} (${foulClub.name}) sees a second yellow and is sent off! Down to 10 men!`, 'red-card');
        state.playSound?.('whistle');
        if (this.ball.owner === fouler) { this.ball.owner = null; this.ball.state = 'ROLLING'; }
      } else {
        this.stats[foulSide].yellowCards++;
        if (statePlayer) statePlayer.yellowCards = (statePlayer.yellowCards || 0) + 1;
        this.cardEvents.push({ minute: this.minute, side: foulSide, player: fouler.fullName || fouler.name, card: 'YELLOW', clubName: foulClub.name });
        const reasons = ['a late sliding tackle', 'pulling back the counter-attack', 'a reckless challenge in midfield', 'dissent toward the referee'];
        this._addComm(`🟨 YELLOW CARD! ${fouler.fullName || fouler.name} (${foulClub.name}) booked for ${reasons[Math.floor(Math.random() * reasons.length)]}.`, 'yellow-card');
      }
    } else if (cardRoll >= 0.22 && cardRoll < 0.238 && this.stats[foulSide].redCards < 1) {
      // Straight red card!
      fouler.sentOff = true;
      this.stats[foulSide].redCards++;
      const statePlayer = fouler.playerId ? (state.players || []).find(p => p.id === fouler.playerId) : null;
      if (statePlayer) statePlayer.redCards = (statePlayer.redCards || 0) + 1;
      this.cardEvents.push({ minute: this.minute, side: foulSide, player: fouler.fullName || fouler.name, card: 'RED', clubName: foulClub.name });
      this._addComm(`🟥 STRAIGHT RED CARD! ${fouler.fullName || fouler.name} (${foulClub.name}) is dismissed for a cynical last-man challenge!`, 'red-card');
      state.playSound?.('whistle');
      if (this.ball.owner === fouler) { this.ball.owner = null; this.ball.state = 'ROLLING'; }
    }

    // Direct Free Kick in dangerous attacking area (~35% of fouls)
    if (Math.random() < 0.35) {
      this.stats[oppSide].freeKicks++;
      const taker = this._pickFreeKickTaker(oppClub.id);
      const fkSkill = ((Number(taker.sho) || Number(taker.ovr) || 78) + (Number(taker.pas) || Number(taker.ovr) || 78)) / 2;
      const goalChance = Math.min(0.24, Math.max(0.08, 0.11 + (fkSkill - 80) * 0.007));
      this.stats[oppSide].shots++;
      this.stats[oppSide].xG += 0.16;

      if (Math.random() < goalChance) {
        this[`${oppSide}Score`]++;
        this.stats[oppSide].sot++;
        this.goalEvents.push({ minute: this.minute, side: oppSide, scorer: taker.name, isFreeKick: true, home: this.homeScore, away: this.awayScore });
        this.freeKickEvents.push({ minute: this.minute, side: oppSide, taker: taker.name, outcome: 'GOAL' });
        this._addComm(`🎯⚽ WHAT A FREE KICK! ${taker.name} curls an unstoppable strike over the wall into the top corner for ${oppClub.name}! (${this.homeScore}–${this.awayScore})`, 'goal');
        state.playSound?.('goal');
      } else if (Math.random() < 0.55) {
        this.stats[oppSide].sot++;
        this.stats[foulSide].saves++;
        this.freeKickEvents.push({ minute: this.minute, side: oppSide, taker: taker.name, outcome: 'SAVED' });
        this._addComm(`🎯 DIRECT FREE KICK! ${taker.name} (${oppClub.name}) whips it over the wall, but the keeper tips it over the bar!`, 'free-kick');
      } else {
        this.freeKickEvents.push({ minute: this.minute, side: oppSide, taker: taker.name, outcome: 'WALL' });
        this._addComm(`🎯 FREE KICK: ${taker.name} (${oppClub.name}) strikes from 23 yards — clips the top of the wall and goes behind.`, 'free-kick');
      }
    }
  }

  _pickInteractiveShooter(players) {
    const groups = [
      { weight: 60, positions: ['ST', 'CF', 'LW', 'RW'] },
      { weight: 30, positions: ['CAM', 'CM', 'CDM', 'LM', 'RM'] },
      { weight: 10, positions: ['CB', 'LB', 'RB', 'LWB', 'RWB'] }
    ].map(group => ({ ...group, players: players.filter(player => group.positions.includes(player.pos)) }))
      .filter(group => group.players.length);
    const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
    let choice = Math.random() * totalWeight;
    const selectedGroup = groups.find(group => (choice -= group.weight) < 0) || groups[groups.length - 1];
    return selectedGroup?.players[Math.floor(Math.random() * selectedGroup.players.length)] || players[0];
  }

  // ─── Interactive Key Moment Decision Engine ───────────────────────────────
  triggerInteractiveMoment() {
    this.running = false;
    this.isGoalCooldown = true;
    if (this._simTimerId) { clearInterval(this._simTimerId); this._simTimerId = null; }
    const modal = document.getElementById('matchDecisionModal');
    if (!modal) return;

    const isAttacking = Math.random() < 0.60;
    const minute = this.minute;

    const starters = state.starters && state.starters.length ? state.starters : [];
    const attacker = this._pickInteractiveShooter(starters) || { name: 'Forward', ovr: 75, pos: 'ST' };
    const defender = starters.find(p => p.pos === 'GK') || { name: 'Goalkeeper', ovr: 75, pos: 'GK' };
    const opponentClub = this.userSide === 'home' ? this.away : this.home;
    const opponentRoster = (state.players || []).filter(player => player.clubId === opponentClub.id);
    const opponentShooter = this._pickInteractiveShooter(opponentRoster) || { name: 'Opponent striker', ovr: 75, pos: 'ST' };
    const opposingKeeper = opponentRoster.find(player => player.pos === 'GK') || { name: 'Goalkeeper', ovr: 75, pos: 'GK' };
    const playerRating = player => {
      const rating = Number(player?.ovr);
      return Number.isFinite(rating) && rating > 0 ? rating : 75;
    };
    const ratingChance = (advantage, minimum = 0.35, maximum = 0.65) =>
      Math.min(maximum, Math.max(minimum, 0.5 + advantage * 0.006));

    let eventType = isAttacking ? 'ATTACK_SHOT' : 'GK_SAVE';
    const specialRoll = Math.random();
    if (specialRoll < 0.08) eventType = isAttacking ? 'PENALTY_KICK' : 'OPPONENT_PENALTY_KICK';
    else if (specialRoll < 0.30) eventType = isAttacking ? 'FREE_KICK' : 'OPPONENT_FREE_KICK';

    const mdBadge = document.getElementById('mdBadge');
    const mdMinute = document.getElementById('mdMinute');
    const mdTitle = document.getElementById('mdTitle');
    const mdSubtitle = document.getElementById('mdSubtitle');
    const mdPlayerName = document.getElementById('mdPlayerName');
    const mdPlayerStats = document.getElementById('mdPlayerStats');
    const mdChancePercent = document.getElementById('mdChancePercent');
    const mdGrid = document.getElementById('mdGridContainer');
    const mdBanner = document.getElementById('mdResultBanner');

    if (mdMinute) mdMinute.textContent = `${minute}'`;
    if (mdBanner) mdBanner.style.display = 'none';

    let baseProb = 0.50;
    let targetOptions = [];

    if (eventType === 'ATTACK_SHOT') {
      baseProb = ratingChance(playerRating(attacker) - playerRating(opposingKeeper));
      if (mdBadge) mdBadge.innerHTML = `⚽ BIG GOAL CHANCE • ${minute}'`;
      if (mdTitle) mdTitle.textContent = `1-on-1 Goal Chance! Choose Shot Placement`;
      if (mdSubtitle) mdSubtitle.textContent = `${attacker.name} breaks past defender into the 18-yard box! Where should he shoot?`;
      if (mdPlayerName) mdPlayerName.textContent = attacker.name;
      if (mdPlayerStats) mdPlayerStats.textContent = `${attacker.pos} • ${attacker.ovr} OVR • Shooting Power`;
      if (mdChancePercent) mdChancePercent.textContent = `${Math.round(baseProb * 100)}% Chance to Score`;

      targetOptions = [
        { label: '🎯 Top-Left Corner', probMod: 1.15, text: 'Top-Left Corner Finesse' },
        { label: '🎯 Top-Right Corner', probMod: 1.15, text: 'Top-Right Top Shelf' },
        { label: '⚽ Low Driven Left', probMod: 1.05, text: 'Low Driven Shot' },
        { label: '⚽ Low Driven Right', probMod: 1.05, text: 'Low Bottom Corner' },
        { label: '🚀 Power Center Strike', probMod: 0.95, text: 'Central Power Blast' },
        { label: '👟 Delicate Chip', probMod: 0.85, text: 'Over GK Chip' }
      ];
    } else if (eventType === 'FREE_KICK') {
      const fkTaker = this._pickFreeKickTaker(state.myClubId);
      Object.assign(attacker, fkTaker);
      this.stats[this.userSide].freeKicks++;
      this.stats[this.opponentSide].fouls++;
      baseProb = Math.min(0.68, Math.max(0.32, 0.42 + (playerRating(fkTaker) - playerRating(opposingKeeper)) * 0.012));
      if (mdBadge) mdBadge.innerHTML = `🎯 DIRECT FREE KICK (22 YARDS) • ${minute}'`;
      if (mdTitle) mdTitle.textContent = `Direct Free Kick! Choose Your Technique`;
      if (mdSubtitle) mdSubtitle.textContent = `Foul right outside the box! ${fkTaker.name} stands over the ball — wall is set:`;
      if (mdPlayerName) mdPlayerName.textContent = fkTaker.name;
      if (mdPlayerStats) mdPlayerStats.textContent = `${fkTaker.pos} • ${fkTaker.ovr} OVR • Free Kick Specialist`;
      if (mdChancePercent) mdChancePercent.textContent = `${Math.round(baseProb * 100)}% Chance to Score`;

      targetOptions = [
        { label: '🎯 Curl Over Wall (Top Left)', probMod: 1.15, text: 'Top-Left Curled Free Kick' },
        { label: '🎯 Whip Top Right Corner', probMod: 1.12, text: 'Top-Right Free Kick' },
        { label: '⚡ Knuckleball Power Strike', probMod: 1.02, text: 'Dipping Knuckleball Free Kick' },
        { label: '👟 Cheeky Low Under the Wall', probMod: 0.94, text: 'Low Under-the-Wall Free Kick' }
      ];
    } else if (eventType === 'GK_SAVE' || eventType === 'OPPONENT_PENALTY_KICK' || eventType === 'OPPONENT_FREE_KICK') {
      if (eventType === 'OPPONENT_FREE_KICK') {
        this.stats[this.opponentSide].freeKicks++;
        this.stats[this.userSide].fouls++;
      }
      baseProb = eventType === 'OPPONENT_PENALTY_KICK'
        ? ratingChance(playerRating(defender) - playerRating(opponentShooter), 0.20, 0.40)
        : eventType === 'OPPONENT_FREE_KICK'
          ? ratingChance(playerRating(defender) - playerRating(opponentShooter), 0.50, 0.78)
          : ratingChance(playerRating(defender) - playerRating(opponentShooter));
      if (mdBadge) mdBadge.innerHTML = `${eventType === 'OPPONENT_PENALTY_KICK' ? '🎯 PENALTY SAVE' : eventType === 'OPPONENT_FREE_KICK' ? '🎯 FREE KICK DEFENSE' : '🧤 DEFENSIVE EMERGENCY'} • ${minute}'`;
      if (mdTitle) mdTitle.textContent = eventType === 'OPPONENT_PENALTY_KICK' ? `Save ${opponentShooter.name}'s Penalty!` : eventType === 'OPPONENT_FREE_KICK' ? `Defend ${opponentShooter.name}'s Free Kick!` : `Direct ${defender.name} to Make the Save!`;
      if (mdSubtitle) mdSubtitle.textContent = eventType === 'OPPONENT_PENALTY_KICK'
        ? `${opponentShooter.name} steps up to take the penalty. Direct your Goalkeeper:`
        : eventType === 'OPPONENT_FREE_KICK'
          ? `${opponentShooter.name} lines up a dangerous free kick from 23 yards! Direct your Goalkeeper:`
          : `${opponentShooter.name} fires toward goal! Direct your Goalkeeper:`;
      if (mdPlayerName) mdPlayerName.textContent = defender.name;
      if (mdPlayerStats) mdPlayerStats.textContent = `${defender.pos} • ${defender.ovr} OVR • Diving & Reflexes`;
      if (mdChancePercent) mdChancePercent.textContent = `${Math.round(baseProb * 100)}% Chance to Save`;

      targetOptions = [
        { label: '🧤 Full Extension Dive Left', probMod: 1.10, text: 'Leaping Left Save' },
        { label: '🧤 Full Extension Dive Right', probMod: 1.10, text: 'Leaping Right Save' },
        { label: '🧤 Stand Ground & Reflex Block', probMod: 1.00, text: 'Reflex Block' },
        { label: '🧤 Rush Out & Smother', probMod: 0.90, text: 'Aggressive Smother' }
      ];
    } else {
      baseProb = 0.82;
      if (mdBadge) mdBadge.innerHTML = `🎯 PENALTY SPOT KICK • ${minute}'`;
      if (mdTitle) mdTitle.textContent = `Penalty Kick Awarded!`;
      if (mdSubtitle) mdSubtitle.textContent = `${attacker.name} steps up to take the penalty kick! Choose target placement:`;
      if (mdPlayerName) mdPlayerName.textContent = attacker.name;
      if (mdPlayerStats) mdPlayerStats.textContent = `${attacker.pos} • ${attacker.ovr} OVR • Penalty Taker`;
      if (mdChancePercent) mdChancePercent.textContent = `82% Chance to Score`;

      targetOptions = [
        { label: '🎯 Top Corner Left', probMod: 1.10, text: 'Top Left Penalty' },
        { label: '🎯 Top Corner Right', probMod: 1.10, text: 'Top Right Penalty' },
        { label: '⚽ Low Driven Left', probMod: 1.00, text: 'Bottom Left Spot Kick' },
        { label: '⚽ Low Driven Right', probMod: 1.00, text: 'Bottom Right Spot Kick' },
        { label: '👑 Panenka Center Chip', probMod: 0.85, text: 'Panenka Chip Center' }
      ];
    }

    if (mdGrid) {
      mdGrid.innerHTML = targetOptions.map((opt, idx) => `
        <button class="btn-secondary md-target-btn" data-idx="${idx}" style="padding: 1rem 0.5rem; font-size: 0.84rem; font-weight: 800; border-radius: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,137,0.3); color: #fff; cursor: pointer; transition: transform 0.15s ease, background 0.15s ease;">
          ${opt.label}
        </button>
      `).join('');

      mdGrid.querySelectorAll('.md-target-btn').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx);
          const choice = targetOptions[idx];
          const finalProb = Math.min(0.95, baseProb * choice.probMod);
          const success = Math.random() < finalProb;

          if (mdGrid) mdGrid.style.pointerEvents = 'none';

          if (eventType === 'ATTACK_SHOT' || eventType === 'PENALTY_KICK' || eventType === 'FREE_KICK') {
            if (success) {
              const side = this.userSide;
              this[`${side}Score`]++;
              this.stats[side].shots++;
              this.stats[side].sot++;
              this.stats[side].xG += eventType === 'FREE_KICK' ? 0.25 : 0.65;
              this.goalEvents.push({ minute, side, scorer: attacker.name, isFreeKick: eventType === 'FREE_KICK', home: this.homeScore, away: this.awayScore });
              this._addComm(`⚽ GOAL! ${attacker.name} strikes for ${side === 'home' ? this.home.name : this.away.name} (${choice.text})! (${this.homeScore}–${this.awayScore})`, 'goal');
              state.playSound?.('goal');

              if (mdBanner) {
                mdBanner.style.display = 'block';
                mdBanner.style.background = 'rgba(0, 255, 137, 0.2)';
                mdBanner.style.color = 'var(--accent-lime)';
                mdBanner.style.border = '1px solid rgba(0, 255, 137, 0.4)';
                mdBanner.innerHTML = `⚽ GOAL! ${attacker.name} scores fantastic ${choice.text}!`;
              }
            } else {
              this.stats[this.userSide].shots++;
              this.stats[this.userSide].sot++;
              this.stats[this.opponentSide].saves++;
              this._addComm(`💨 SAVED! Opposing keeper denies ${attacker.name}'s ${choice.text}!`, 'miss');
              state.playSound?.('whistle');

              if (mdBanner) {
                mdBanner.style.display = 'block';
                mdBanner.style.background = 'rgba(255, 50, 80, 0.2)';
                mdBanner.style.color = '#ff4d6d';
                mdBanner.style.border = '1px solid rgba(255, 50, 80, 0.4)';
                mdBanner.innerHTML = `🧤 SAVED! Opposing Goalkeeper turns away the strike!`;
              }
            }
          } else {
            // GK SAVE EVENT
            if (success) {
              this.stats[this.opponentSide].shots++;
              this.stats[this.opponentSide].sot++;
              this.stats[this.userSide].saves++;
              this._addComm(`🧤 WHAT A SAVE! ${defender.name} pulls off incredible ${choice.text}!`, 'save');
              state.playSound?.('whistle');

              if (mdBanner) {
                mdBanner.style.display = 'block';
                mdBanner.style.background = 'rgba(0, 240, 255, 0.2)';
                mdBanner.style.color = 'var(--accent-cyan)';
                mdBanner.style.border = '1px solid rgba(0, 240, 255, 0.4)';
                mdBanner.innerHTML = `🧤 OUTSTANDING SAVE! ${defender.name} denies the goal!`;
              }
            } else {
              const side = this.opponentSide;
              this[`${side}Score`]++;
              this.stats[side].shots++;
              this.stats[side].sot++;
              this.stats[side].xG += 0.55;
              this.goalEvents.push({ minute, side, scorer: opponentShooter.name, home: this.homeScore, away: this.awayScore });
              this._addComm(`⚽ GOAL CONCEDED! ${side === 'home' ? this.home.name : this.away.name} score despite ${defender.name}'s attempt! (${this.homeScore}–${this.awayScore})`, 'goal');
              state.playSound?.('goal');

              if (mdBanner) {
                mdBanner.style.display = 'block';
                mdBanner.style.background = 'rgba(255, 50, 80, 0.2)';
                mdBanner.style.color = '#ff4d6d';
                mdBanner.style.border = '1px solid rgba(255, 50, 80, 0.4)';
                mdBanner.innerHTML = `⚽ GOAL CONCEDED! Opponent scores into the net!`;
              }
            }
          }

          this._updateUI();

          setTimeout(() => {
            modal.classList.remove('active');
            if (mdGrid) mdGrid.style.pointerEvents = 'auto';
            this.isGoalCooldown = false;
            this.running = true;
            this._startSimLoop();
            this._startRenderLoop();
          }, 1600);
        };
      });
    }

    modal.classList.add('active');
  }


  // ─── Real-Time 60FPS Multi-Agent AI Engine ─────────────────────────────────
  _updateEngineAI() {
    const allPlayers = [...this.homePlayers, ...this.awayPlayers].filter(p => !p.sentOff);
    const b = this.ball;

    // 1. Ball Carrier AI
    if (b.owner) {
      const owner = b.owner;
      this.possessionSide = owner.side;

      const footDist = 10;
      b.x = owner.x + Math.cos(owner.facing) * footDist;
      b.y = owner.y + Math.sin(owner.facing) * footDist;
      b.z = 0;
      b.vx = owner.vx;
      b.vy = owner.vy;

      if (!this.isGoalCooldown) {
        owner.actionTimer = (owner.actionTimer || 0) + 1;
        if (owner.actionTimer > 22) { // Action decision every ~0.35s
          owner.actionTimer = 0;
          this._evaluateOwnerAction(owner);
        }
      }
    } else {
      // 2. Ball Physics Trajectory
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;

      if (b.z > 0) {
        b.vz -= 0.15;
      } else {
        b.z = 0;
        b.vz = 0;
        b.vx *= 0.93;
        b.vy *= 0.93;
      }

      // Trajectory Interception / Control
      if (!this.isGoalCooldown && (b.state === 'ROLLING' || (b.state === 'IN_AIR' && b.z < 15))) {
        for (const p of allPlayers) {
          if (p.role === 'GK' && Math.abs(b.vx) > 3.5) continue;
          const dist = Math.hypot(p.x - b.x, p.y - b.y);
          if (dist < 14) {
            b.owner = p;
            b.state = 'CARRIED';
            p.facing = p.side === 'home' ? 0 : Math.PI;
            break;
          }
        }
      }

      // Check Goal Line & Out of Bounds
      this._checkGoalScored();
      this._checkOutOfBounds();
    }

    // 3. Off-the-ball Tactical AI
    this._updateOffTheBallAI(allPlayers);

    if (this.goalFlashTime > 0) this.goalFlashTime--;
  }

  _evaluateOwnerAction(owner) {
    const isHome = owner.side === 'home';
    const teammates = (isHome ? this.homePlayers : this.awayPlayers).filter(p => p !== owner && p.role !== 'GK');
    const goalX     = isHome ? W - PITCH_M : PITCH_M;
    const goalDist  = Math.hypot(goalX - owner.x, H / 2 - owner.y);

    // A. SHOOT: Increased range (~280px) and realistic goal scoring rate
    if (goalDist < 280 && Math.random() < (goalDist < 160 ? 0.65 : 0.35)) {
      this._executeShot(owner, isHome, goalX);
      return;
    }

    // B. PASS: Find best open teammate
    const openTeammates = teammates.filter(p => {
      const dist = Math.hypot(p.x - owner.x, p.y - owner.y);
      return dist > 40 && dist < 320;
    });

    if (openTeammates.length && Math.random() < 0.78) {
      // Prioritize teammates upfield
      openTeammates.sort((a, b) => isHome ? b.x - a.x : a.x - b.x);
      const target = openTeammates[0];
      this._executePass(owner, target);
      return;
    }

    // C. DRIBBLE: Advance forward into space
    owner.state = 'DRIBBLE';
  }

  _executePass(passer, receiver) {
    const b = this.ball;
    b.owner = null;
    b.state = 'ROLLING';

    const dx = receiver.x - passer.x;
    const dy = receiver.y - passer.y;
    const dist = Math.hypot(dx, dy);

    const passSpeed = Math.min(7.0, Math.max(4.5, dist * 0.035));
    b.vx = (dx / dist) * passSpeed;
    b.vy = (dy / dist) * passSpeed;

    passer.facing = Math.atan2(dy, dx);
  }

  _executeShot(shooter, isHome, goalX) {
    const b = this.ball;
    b.owner = null;
    b.state = 'IN_AIR';

    const stat    = this.stats[isHome ? 'home' : 'away'];
    const oppStat = this.stats[isHome ? 'away' : 'home'];
    stat.shots++;

    const targetY = GOAL_TOP + 10 + Math.random() * (GOAL_BOT - GOAL_TOP - 20);
    const dx = goalX - shooter.x;
    const dy = targetY - shooter.y;
    const dist = Math.hypot(dx, dy);

    const shotSpeed = 8.0 + Math.random() * 2.5;
    b.vx = (dx / dist) * shotSpeed;
    b.vy = (dy / dist) * shotSpeed;
    b.vz = 1.8 + Math.random() * 1.5;

    shooter.facing = Math.atan2(dy, dx);

    const xG = parseFloat((Math.max(0.10, 1 - dist / 320)).toFixed(2));
    stat.xG = parseFloat((stat.xG + xG).toFixed(2));

    const onTarget = Math.random() < 0.65;
    if (onTarget) stat.sot++;

    const gk = isHome ? this.awayPlayers[0] : this.homePlayers[0];

    // Balanced keeper save logic (not overpowered)
    if (onTarget && Math.random() < 0.45 && dist > 140) {
      // Keeper Save
      oppStat.saves++;
      gk.y += (targetY - gk.y) * 0.50;
      this._addComm(`🧤 SAVE by ${gk.name}!`, 'save');
    } else if (!onTarget) {
      this._addComm(`Shot from ${shooter.name} goes wide!`, 'miss');
    }
  }

  // ─── Single-Trigger Goal Detection System ──────────────────────────────────
  _checkGoalScored() {
    if (this.isGoalCooldown || !this.running) return;
    const b = this.ball;

    // Check Home Goal (Left Goal Net)
    if (b.x < PITCH_M + 4 && b.y > GOAL_TOP + 4 && b.y < GOAL_BOT - 4 && b.z < 25) {
      this.isGoalCooldown = true;
      this.awayScore++;
      this._onGoalScored('away');
    }
    // Check Away Goal (Right Goal Net)
    else if (b.x > W - PITCH_M - 4 && b.y > GOAL_TOP + 4 && b.y < GOAL_BOT - 4 && b.z < 25) {
      this.isGoalCooldown = true;
      this.homeScore++;
      this._onGoalScored('home');
    }
  }

  _onGoalScored(scoringSide) {
    // Freeze ball motion
    const b = this.ball;
    b.vx = 0; b.vy = 0; b.vz = 0;

    this.goalFlashTime = 75;
    this.goalFlashSide = scoringSide;
    state.playSound?.('goal');

    const scorerClub = scoringSide === 'home' ? this.home.name : this.away.name;
    this._addComm(`⚽ GOAL! ${scorerClub} score! (${this.homeScore}–${this.awayScore})`, 'goal');

    this.goalEvents.push({ minute: this.minute, side: scoringSide, scorer: scorerClub, home: this.homeScore, away: this.awayScore });

    const scoreEl = document.getElementById('matchScoreDisplay');
    if (scoreEl) {
      scoreEl.textContent = `${this.homeScore} – ${this.awayScore}`;
      scoreEl.style.color = 'var(--accent-lime)';
      scoreEl.style.textShadow = '0 0 30px rgba(0,255,135,0.9)';
      setTimeout(() => { if (scoreEl) { scoreEl.style.color = ''; scoreEl.style.textShadow = ''; }}, 1600);
    }

    // Reset pitch to Kickoff after celebration
    setTimeout(() => {
      if (this.running) this._initMatch();
    }, 1400);
  }

  _checkOutOfBounds() {
    if (this.isGoalCooldown) return;
    const b = this.ball;

    // Pitch touchline bounds
    if (b.y < PITCH_M + 4) { b.y = PITCH_M + 6; b.vy = Math.abs(b.vy) * 0.4; }
    if (b.y > H - PITCH_M - 4) { b.y = H - PITCH_M - 6; b.vy = -Math.abs(b.vy) * 0.4; }

    // Endlines outside of goal net -> Goal kick / Keeper restart
    if (b.x < PITCH_M - 8 || b.x > W - PITCH_M + 8) {
      if (b.y < GOAL_TOP || b.y > GOAL_BOT) {
        const side = b.x < W / 2 ? 'home' : 'away';
        const gk = side === 'home' ? this.homePlayers[0] : this.awayPlayers[0];
        b.owner = gk;
        b.state = 'CARRIED';
        b.x = gk.x;
        b.y = gk.y;
        b.vx = 0; b.vy = 0; b.vz = 0;
      }
    }
  }

  _updateOffTheBallAI(allPlayers) {
    const b = this.ball;
    const isHomePoss = this.possessionSide === 'home';

    const defendingTeam = isHomePoss ? this.awayPlayers : this.homePlayers;
    const attackingTeam = isHomePoss ? this.homePlayers : this.awayPlayers;
    
    // Nearest defender is the primary presser
    let presser = null, minDist = 9999;
    for (const p of defendingTeam) {
      if (p.role === 'GK') continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < minDist) { minDist = d; presser = p; }
    }

    allPlayers.forEach(p => {
      const isCarrier = p === b.owner;
      const isGK      = p.role === 'GK';
      const isOnAttackingTeam = (p.side === 'home') === isHomePoss;

      let targetX = p.bx;
      let targetY = p.by;
      
      const goalDir = p.side === 'home' ? 1 : -1;
      const ownGoalX = p.side === 'home' ? PITCH_M : W - PITCH_M;

      if (isGK) {
        // Goalkeeper hugs goal line & tracks ball Y angle
        targetX = p.bx;
        targetY = p.by + (b.y - p.by) * 0.45;
        targetY = Math.max(GOAL_TOP + 8, Math.min(GOAL_BOT - 8, targetY));

      } else if (isCarrier) {
        // Carrier dribbles towards opponent goal smoothly
        targetX = p.x + goalDir * 50;
        targetY = p.y * 0.8 + p.by * 0.2;

      } else if (p === presser) {
        // Presser closes down ball carrier directly
        targetX = b.x;
        targetY = b.y;
        
        // Tackle check when close
        if (b.owner && minDist < 15) {
          if (Math.random() < 0.15) {
            b.owner = p;
            b.state = 'CARRIED';
            this.possessionSide = p.side;
            this._addComm(`Tackle! ${p.name} dispossesses the ball!`, 'normal');
          }
        }

      } else if (!isOnAttackingTeam) {
        // Dynamic Defensive Line (Entire team shifts relative to ball position)
        // Defending team drops back as ball gets closer to their goal, and pushes up when ball is far
        const ballDistFromOwnGoal = Math.abs(b.x - ownGoalX);
        const shiftFactor = (ballDistFromOwnGoal / W) * 0.70;
        
        // Target position moves dynamically with the ball across the pitch
        const dynamicX = ownGoalX + (b.x - ownGoalX) * 0.65;
        targetX = p.bx * 0.35 + dynamicX * 0.65;
        targetY = p.by + (b.y - H / 2) * 0.45;
        
      } else if (isOnAttackingTeam) {
        // Attacking team pushes up and supports the ball carrier
        const dynamicX = b.x + (goalDir * 40);
        targetX = p.bx * 0.4 + dynamicX * 0.6;
        targetY = p.by + (b.y - p.by) * 0.30;
      }

      // Smooth Physics Movement
      const dx = targetX - p.x;
      const dy = targetY - p.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 1.5) {
        const targetSpeed = Math.min(p.maxSpeed, dist * 0.08);
        const desiredVx = (dx / dist) * targetSpeed;
        const desiredVy = (dy / dist) * targetSpeed;

        p.vx += (desiredVx - p.vx) * 0.15;
        p.vy += (desiredVy - p.vy) * 0.15;
        p.x += p.vx;
        p.y += p.vy;

        // Smooth facing rotation
        const targetAngle = Math.atan2(p.vy, p.vx);
        let diff = targetAngle - p.facing;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        p.facing += diff * 0.20;
      } else {
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x += p.vx;
        p.y += p.vy;
      }

      // Bounds check
      p.x = Math.max(PITCH_M + 6, Math.min(W - PITCH_M - 6, p.x));
      p.y = Math.max(PITCH_M + 6, Math.min(H - PITCH_M - 6, p.y));
    });
  }

  // ─── Visual Presentation ───────────────────────────────────────────────────
  _drawFrame() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    this._drawPitch(ctx);

    if (this.goalFlashTime > 0) {
      const alpha = (this.goalFlashTime / 75) * 0.25;
      ctx.fillStyle = this.goalFlashSide === 'home' ? `rgba(0, 255, 137, ${alpha})` : `rgba(0, 240, 255, ${alpha})`;
      ctx.fillRect(0, 0, W, H);
    }

    this._drawPlayers(ctx, this.awayPlayers, '#00e5ff', '#001833');
    this._drawPlayers(ctx, this.homePlayers, '#00ff87', '#003322');
    this._drawBall(ctx);
    this._drawPossessionIndicator(ctx);
  }

  _drawPitch(ctx) {
    const grassGrad = ctx.createLinearGradient(0, 0, 0, H);
    grassGrad.addColorStop(0, '#0c3b1d');
    grassGrad.addColorStop(1, '#072b14');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, 0, W, H);

    for (let x = 0; x < W; x += 55) {
      if (Math.floor(x / 55) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(x, 0, 55, H);
      }
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.5;

    ctx.strokeRect(PITCH_M, PITCH_M, W - PITCH_M * 2, H - PITCH_M * 2);

    ctx.beginPath();
    ctx.moveTo(W / 2, PITCH_M);
    ctx.lineTo(W / 2, H - PITCH_M);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 58, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    const paW = 135, paH = 210;
    ctx.strokeRect(PITCH_M, (H - paH) / 2, paW, paH);
    ctx.strokeRect(W - PITCH_M - paW, (H - paH) / 2, paW, paH);

    const gbW = 46, gbH = 104;
    ctx.strokeRect(PITCH_M, (H - gbH) / 2, gbW, gbH);
    ctx.strokeRect(W - PITCH_M - gbW, (H - gbH) / 2, gbW, gbH);

    [[PITCH_M + 92, H / 2], [W - PITCH_M - 92, H / 2]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    ctx.restore();

    const goalH = GOAL_BOT - GOAL_TOP;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, GOAL_TOP, PITCH_M, goalH);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(0, GOAL_TOP, PITCH_M, goalH);

    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(W - PITCH_M, GOAL_TOP, PITCH_M, goalH);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(W - PITCH_M, GOAL_TOP, PITCH_M, goalH);
  }

  _drawPlayers(ctx, players, fillColor, strokeColor) {
    players.forEach(p => {
      if (p.sentOff) return;
      const px = Number.isFinite(p.x) ? p.x : (p.bx || 0);
      const py = Number.isFinite(p.y) ? p.y : (p.by || 0);
      const facing = Number.isFinite(p.facing) ? p.facing : (p.side === 'home' ? 0 : Math.PI);

      const isCarrier = this.ball && this.ball.owner === p;

      if (isCarrier) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 16, 0, Math.PI * 2);
        ctx.strokeStyle = p.side === 'home' ? '#00ff87' : '#00e5ff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = p.side === 'home' ? '#00ff87' : '#00e5ff';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(px + 2, py + 5, 11, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.restore();

      // Directional Notch Pointer (Subtle notch on circle edge)
      ctx.save();
      ctx.beginPath();
      const pointerX = px + Math.cos(facing) * 12;
      const pointerY = py + Math.sin(facing) * 12;
      if (Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
        ctx.arc(pointerX, pointerY, 2.5, 0, Math.PI * 2);
      }
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fillStyle   = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = 2.2;
      ctx.stroke();

      ctx.fillStyle    = p.side === 'home' ? '#001a0d' : '#001520';
      ctx.font         = 'bold 9px Outfit, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.num || ''), px, py);
      if (p.yellows > 0) {
        ctx.fillStyle = '#ffd43b';
        ctx.fillRect(px + 7, py - 13, 5, 7);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(px + 7, py - 13, 5, 7);
      }
      ctx.restore();
    });
  }

  _drawBall(ctx) {
    const b = this.ball;
    const shadowY = b.y + 5 + b.z * 0.2;

    ctx.save();
    ctx.beginPath();
    const shadowRadius = Math.max(3, 7 - b.z * 0.15);
    ctx.ellipse(b.x + 2, shadowY, shadowRadius, shadowRadius * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.1, 0.35 - b.z * 0.01)})`;
    ctx.fill();
    ctx.restore();

    const drawY = b.y - b.z;

    const glow = ctx.createRadialGradient(b.x, drawY, 0, b.x, drawY, 13);
    glow.addColorStop(0, 'rgba(255,235,80,0.7)');
    glow.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(b.x, drawY, 13, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, drawY, 6.5, 0, Math.PI * 2);
    ctx.fillStyle   = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(b.x, drawY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#111111';
    ctx.fill();
    ctx.restore();
  }

  _drawPossessionIndicator(ctx) {
    const barW = 160, barH = 6, barX = (W - barW) / 2, barY = H - 8;
    const totalTicks = this.homePossTicks + this.awayPossTicks || 1;
    const homeRatio  = this.homePossTicks / totalTicks;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 3);
    ctx.fill();

    ctx.fillStyle = '#00ff87';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * homeRatio, barH, 3);
    ctx.fill();

    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.roundRect(barX + barW * homeRatio, barY, barW * (1 - homeRatio), barH, 3);
    ctx.fill();
    ctx.restore();
  }

  _updateUI() {
    const clockEl = document.getElementById('matchClockText');
    if (clockEl) clockEl.textContent = `${this.minute}'`;

    const scoreEl = document.getElementById('matchScoreDisplay');
    if (scoreEl && !scoreEl.style.color) {
      scoreEl.textContent = `${this.homeScore} – ${this.awayScore}`;
    }

    const totalTicks  = this.homePossTicks + this.awayPossTicks || 1;
    const homePoss    = Math.round((this.homePossTicks / totalTicks) * 100);
    const awayPoss    = 100 - homePoss;

    const statsEl = document.getElementById('matchLiveStats');
    if (statsEl) {
      const hs = this.stats.home, as_ = this.stats.away;
      statsEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:0.35rem 0.8rem;font-size:0.84rem;align-items:center;">
          <span style="text-align:right;color:var(--accent-lime);font-weight:800;">${homePoss}%</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">Possession</span>
          <span style="color:var(--accent-cyan);font-weight:800;">${awayPoss}%</span>

          <span style="text-align:right;font-weight:700;">${hs.shots}</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">Shots</span>
          <span style="font-weight:700;">${as_.shots}</span>

          <span style="text-align:right;font-weight:700;">${hs.sot}</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">On Target</span>
          <span style="font-weight:700;">${as_.sot}</span>

          <span style="text-align:right;font-weight:700;">${hs.xG.toFixed(2)}</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">xG</span>
          <span style="font-weight:700;">${as_.xG.toFixed(2)}</span>

          <span style="text-align:right;font-weight:700;color:var(--accent-cyan);">${hs.freeKicks || 0}</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">Free Kicks</span>
          <span style="font-weight:700;color:var(--accent-cyan);">${as_.freeKicks || 0}</span>

          <span style="text-align:right;font-weight:700;">${hs.fouls || 0}</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">Fouls</span>
          <span style="font-weight:700;">${as_.fouls || 0}</span>

          <span style="text-align:right;font-weight:800;color:#ffd43b;">🟨 ${hs.yellowCards || 0} &nbsp; 🟥 ${hs.redCards || 0}</span>
          <span style="color:var(--text-muted);font-size:0.7rem;text-align:center;text-transform:uppercase;letter-spacing:1px;">Cards</span>
          <span style="font-weight:800;color:#ffd43b;">🟨 ${as_.yellowCards || 0} &nbsp; 🟥 ${as_.redCards || 0}</span>
        </div>`;
    }

    const feedEl = document.getElementById('matchCommentaryFeed');
    if (feedEl && this.commentary.length) {
      feedEl.innerHTML = this.commentary.map(c => {
        const cls = { goal:'goal-entry', save:'save-entry', miss:'miss-entry', kickoff:'kickoff-entry', halftime:'halftime-entry', tactic:'tactic-entry', 'yellow-card':'yellow-card-entry', 'red-card':'red-card-entry', 'free-kick':'free-kick-entry', normal:'normal-entry' }[c.type] || 'normal-entry';
        const iconMap = { goal:'⚽', save:'🧤', miss:'💨', kickoff:'🏁', halftime:'🔔', tactic:'📋', 'yellow-card':'🟨', 'red-card':'🟥', 'free-kick':'🎯', normal:'💬' };
        return `<div class="comm-entry ${cls}">
          <span class="comm-min">${c.min}'</span>
          <span class="comm-icon">${iconMap[c.type] || '💬'}</span>
          <span class="comm-text">${c.text}</span>
        </div>`;
      }).join('');
      feedEl.scrollTop = 0;
    }

    this._updateGoalTimeline();
  }

  _updateGoalTimeline() {
    const el = document.getElementById('matchGoalTimeline');
    if (!el) return;
    const timeline = [
      ...this.goalEvents.map(g => ({ ...g, kind: 'GOAL' })),
      ...this.cardEvents.map(c => ({ ...c, kind: 'CARD' }))
    ].sort((a, b) => a.minute - b.minute);
    if (!timeline.length) return;
    el.innerHTML = timeline.map(ev => {
      const cls = ev.side === 'home' ? 'home-goal' : 'away-goal';
      if (ev.kind === 'GOAL') {
        const fkTag = ev.isFreeKick ? ' <span style="color:var(--accent-cyan);font-size:0.72rem;font-weight:800;">(FK)</span>' : '';
        return `<div class="goal-event ${cls}">
          <span class="goal-min">${ev.minute}'</span>
          <span class="goal-scorer">⚽ ${ev.scorer}${fkTag}</span>
          <span class="goal-score">${ev.home}–${ev.away}</span>
        </div>`;
      }
      const badge = ev.card === 'YELLOW' ? '🟨' : ev.card === 'SECOND_YELLOW' ? '🟨🟥' : '🟥';
      return `<div class="goal-event ${cls}" style="opacity:0.92;">
        <span class="goal-min">${ev.minute}'</span>
        <span class="goal-scorer">${badge} ${ev.player}</span>
        <span class="goal-score" style="font-size:0.7rem;color:${ev.card === 'YELLOW' ? '#ffd43b' : '#ff4d6d'};">${ev.card === 'YELLOW' ? 'YC' : 'RC'}</span>
      </div>`;
    }).join('');
  }

  _addComm(text, type = 'normal') {
    this.commentary.unshift({ min: this.minute, text, type });
    if (this.commentary.length > MAX_COMM) this.commentary.pop();
  }

  _finishMatch() {
    this.stop();
    state.playSound?.('whistle');

    const isKnockout = Boolean(state.isKnockoutFixture?.(this.fixture));
    if (isKnockout && this.homeScore === this.awayScore && !this.penaltyShootout) {
      this._addComm(`⏱️ FULL TIME (${this.homeScore}–${this.awayScore}) — Knockout tie is level! Going to a PENALTY SHOOTOUT!`, 'halftime');
      this._updateUI();
      this._startInteractivePenaltyShootout();
      return;
    }

    this._finalizeCompletedMatch();
  }

  _startInteractivePenaltyShootout() {
    const modal = document.getElementById('matchDecisionModal');
    if (!modal) {
      this.penaltyShootout = state.simulatePenaltyShootout(this.fixture);
      this._finalizeCompletedMatch();
      return;
    }

    const getKickers = (clubId) => {
      const roster = clubId === state.myClubId && state.starters?.length
        ? state.starters.filter(p => p.pos !== 'GK')
        : (state.players || []).filter(p => p.clubId === clubId && p.pos !== 'GK');
      const sorted = [...roster].sort((a, b) => ((Number(b.sho) || Number(b.ovr) || 75) - (Number(a.sho) || Number(a.ovr) || 75)));
      return sorted.length ? sorted : [{ name: 'Taker', ovr: 78, sho: 78, pos: 'ST' }];
    };
    const getGk = (clubId) => {
      const roster = clubId === state.myClubId && state.starters?.length ? state.starters : (state.players || []).filter(p => p.clubId === clubId);
      return roster.find(p => p.pos === 'GK') || { name: 'Goalkeeper', ovr: 78, pos: 'GK' };
    };

    const homeKickers = getKickers(this.home.id);
    const awayKickers = getKickers(this.away.id);
    const homeGk = getGk(this.home.id);
    const awayGk = getGk(this.away.id);

    const so = {
      homePen: 0,
      awayPen: 0,
      homeKicks: [],
      awayKicks: [],
      turn: 'home', // 'home' kicks first, then 'away'
      round: 1
    };

    const mdBadge = document.getElementById('mdBadge');
    const mdTitle = document.getElementById('mdTitle');
    const mdSubtitle = document.getElementById('mdSubtitle');
    const mdPlayerName = document.getElementById('mdPlayerName');
    const mdPlayerStats = document.getElementById('mdPlayerStats');
    const mdChancePercent = document.getElementById('mdChancePercent');
    const mdGrid = document.getElementById('mdGridContainer');
    const mdBanner = document.getElementById('mdResultBanner');

    const renderDots = (kicks) => {
      const totalSlots = Math.max(5, kicks.length);
      let html = '';
      for (let i = 0; i < totalSlots; i++) {
        if (i < kicks.length) {
          html += kicks[i].scored
            ? '<span style="display:inline-block;width:13px;height:13px;border-radius:50%;background:#00ff87;box-shadow:0 0 8px #00ff87;margin:0 3px;"></span>'
            : '<span style="display:inline-block;width:13px;height:13px;border-radius:50%;background:#ff4d6d;box-shadow:0 0 8px #ff4d6d;margin:0 3px;"></span>';
        } else {
          html += '<span style="display:inline-block;width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,0.28);margin:0 3px;"></span>';
        }
      }
      return html;
    };

    const isShootoutOver = () => {
      const hTaken = so.homeKicks.length;
      const aTaken = so.awayKicks.length;
      if (hTaken <= 5 && aTaken <= 5) {
        const hRem = 5 - hTaken;
        const aRem = 5 - aTaken;
        if (so.homePen > so.awayPen + aRem) return true;
        if (so.awayPen > so.homePen + hRem) return true;
        if (hTaken === 5 && aTaken === 5 && so.homePen !== so.awayPen) return true;
        return false;
      }
      // Sudden death: both teams must have taken equal kicks in the round
      return hTaken === aTaken && so.homePen !== so.awayPen;
    };

    const finishShootout = () => {
      const winnerSide = so.homePen > so.awayPen ? 'home' : 'away';
      const winnerClub = winnerSide === 'home' ? this.home : this.away;
      this.penaltyShootout = {
        homePen: so.homePen,
        awayPen: so.awayPen,
        winnerSide,
        winnerId: winnerClub.id,
        winnerName: winnerClub.name,
        homeKicks: so.homeKicks,
        awayKicks: so.awayKicks,
        suddenDeath: so.homeKicks.length > 5 || so.awayKicks.length > 5,
        summary: `${so.homePen}–${so.awayPen} on pens`
      };

      if (mdBanner) {
        mdBanner.style.display = 'block';
        const userWon = winnerSide === this.userSide;
        mdBanner.style.background = userWon ? 'rgba(0, 255, 137, 0.22)' : 'rgba(255, 77, 109, 0.22)';
        mdBanner.style.color = userWon ? 'var(--accent-lime)' : '#ff4d6d';
        mdBanner.style.border = `1px solid ${userWon ? 'rgba(0,255,137,0.5)' : 'rgba(255,77,109,0.5)'}`;
        mdBanner.innerHTML = `🏆 ${winnerClub.name.toUpperCase()} WIN ${so.homePen}–${so.awayPen} ON PENALTIES!`;
      }
      if (mdGrid) mdGrid.innerHTML = '';

      setTimeout(() => {
        modal.classList.remove('active');
        if (mdGrid) mdGrid.style.pointerEvents = 'auto';
        this._finalizeCompletedMatch();
      }, 1700);
    };

    const quickFinishRemaining = () => {
      while (!isShootoutOver() && so.round <= 20) {
        const isHome = so.turn === 'home';
        const kickIdx = isHome ? so.homeKicks.length : so.awayKicks.length;
        const kicker = isHome ? homeKickers[kickIdx % homeKickers.length] : awayKickers[kickIdx % awayKickers.length];
        const oppGk = isHome ? awayGk : homeGk;
        const prob = Math.max(0.62, Math.min(0.88, 0.76 + ((Number(kicker.sho) || Number(kicker.ovr) || 76) - (Number(oppGk.ovr) || 78)) * 0.005));
        const scored = Math.random() < prob;
        if (isHome) {
          if (scored) so.homePen++;
          so.homeKicks.push({ player: kicker.name, scored });
          so.turn = 'away';
        } else {
          if (scored) so.awayPen++;
          so.awayKicks.push({ player: kicker.name, scored });
          so.turn = 'home';
          so.round++;
        }
      }
      if (so.homePen === so.awayPen) so.homePen++;
      finishShootout();
    };

    const renderStep = () => {
      if (isShootoutOver()) {
        finishShootout();
        return;
      }

      const isHomeTurn = so.turn === 'home';
      const isUserKicking = so.turn === this.userSide;
      const kickIdx = isHomeTurn ? so.homeKicks.length : so.awayKicks.length;
      const roundNum = kickIdx + 1;
      const isSuddenDeath = roundNum > 5;
      const kicker = isHomeTurn ? homeKickers[kickIdx % homeKickers.length] : awayKickers[kickIdx % awayKickers.length];
      const keeper = isHomeTurn ? awayGk : homeGk;

      if (mdBanner) mdBanner.style.display = 'none';
      if (mdBadge) mdBadge.innerHTML = `🎯 PENALTY SHOOTOUT • ${isSuddenDeath ? '🔥 SUDDEN DEATH ' : ''}ROUND ${roundNum}`;
      if (mdTitle) mdTitle.innerHTML = `${this.home.name} <span style="color:var(--accent-lime);">${so.homePen}</span> – <span style="color:var(--accent-cyan);">${so.awayPen}</span> ${this.away.name}`;
      if (mdSubtitle) {
        mdSubtitle.innerHTML = `
          <div style="display:flex;justify-content:center;gap:1.5rem;align-items:center;margin:0.45rem 0 0.35rem;flex-wrap:wrap;">
            <div><strong style="color:var(--accent-lime);font-size:0.78rem;">${this.home.shortName || this.home.name}</strong> ${renderDots(so.homeKicks)}</div>
            <div><strong style="color:var(--accent-cyan);font-size:0.78rem;">${this.away.shortName || this.away.name}</strong> ${renderDots(so.awayKicks)}</div>
          </div>
          <div>${isUserKicking ? `${kicker.name} steps up to the spot! Pick your corner:` : `${kicker.name} steps up for ${isHomeTurn ? this.home.name : this.away.name}! Direct ${keeper.name}:`}</div>
        `;
      }
      if (mdPlayerName) mdPlayerName.textContent = isUserKicking ? kicker.name : keeper.name;
      if (mdPlayerStats) mdPlayerStats.textContent = isUserKicking
        ? `${kicker.pos} • ${kicker.ovr} OVR • Penalty Taker`
        : `${keeper.pos} • ${keeper.ovr} OVR • Goalkeeper`;

      const kickScoreProb = Math.max(0.64, Math.min(0.88, 0.77 + ((Number(kicker.sho) || Number(kicker.ovr) || 76) - (Number(keeper.ovr) || 78)) * 0.005));
      const saveProb = Number((1 - kickScoreProb).toFixed(2));
      if (mdChancePercent) mdChancePercent.textContent = isUserKicking
        ? `${Math.round(kickScoreProb * 100)}% Conversion Rate`
        : `${Math.round(saveProb * 100)}% Save Chance`;

      const options = isUserKicking
        ? [
            { label: '🎯 Top Left Corner', mod: 1.04 },
            { label: '🎯 Top Right Corner', mod: 1.04 },
            { label: '⚽ Low Bottom Left', mod: 1.02 },
            { label: '⚽ Low Bottom Right', mod: 1.02 },
            { label: '👑 Panenka Center', mod: 0.92 }
          ]
        : [
            { label: '🧤 Dive Left', mod: 1.08 },
            { label: '🧤 Dive Right', mod: 1.08 },
            { label: '🧤 Stay Center', mod: 0.96 }
          ];

      if (mdGrid) {
        mdGrid.style.pointerEvents = 'auto';
        mdGrid.innerHTML = options.map((opt, idx) => `
          <button class="btn-secondary md-pen-btn" data-idx="${idx}" style="padding:0.9rem 0.5rem;font-size:0.84rem;font-weight:800;border-radius:8px;background:rgba(0,0,0,0.55);border:1px solid rgba(0,255,137,0.35);color:#fff;cursor:pointer;">
            ${opt.label}
          </button>
        `).join('') + `
          <button class="btn-secondary" id="btnQuickSimShootout" style="grid-column:1/-1;padding:0.65rem;font-size:0.8rem;font-weight:800;border-radius:8px;background:rgba(0,240,255,0.12);border:1px solid rgba(0,240,255,0.4);color:var(--accent-cyan);cursor:pointer;">
            ⚡ Quick Sim Remaining Shootout
          </button>
        `;

        const quickBtn = document.getElementById('btnQuickSimShootout');
        if (quickBtn) quickBtn.onclick = quickFinishRemaining;

        mdGrid.querySelectorAll('.md-pen-btn').forEach(btn => {
          btn.onclick = () => {
            mdGrid.style.pointerEvents = 'none';
            const opt = options[parseInt(btn.dataset.idx, 10)];
            let scored;
            if (isUserKicking) {
              scored = Math.random() < Math.min(0.93, kickScoreProb * opt.mod);
            } else {
              const saved = Math.random() < Math.min(0.45, saveProb * opt.mod);
              scored = !saved;
            }

            if (isHomeTurn) {
              if (scored) so.homePen++;
              so.homeKicks.push({ player: kicker.name, scored });
              so.turn = 'away';
            } else {
              if (scored) so.awayPen++;
              so.awayKicks.push({ player: kicker.name, scored });
              so.turn = 'home';
              so.round++;
            }

            if (mdBanner) {
              mdBanner.style.display = 'block';
              const goodForUser = (isUserKicking && scored) || (!isUserKicking && !scored);
              mdBanner.style.background = goodForUser ? 'rgba(0,255,137,0.2)' : 'rgba(255,77,109,0.2)';
              mdBanner.style.color = goodForUser ? 'var(--accent-lime)' : '#ff4d6d';
              mdBanner.style.border = `1px solid ${goodForUser ? 'rgba(0,255,137,0.4)' : 'rgba(255,77,109,0.4)'}`;
              mdBanner.innerHTML = scored
                ? `⚽ SCORED! ${kicker.name} buries the spot kick! (${so.homePen}–${so.awayPen})`
                : `🧤 SAVED / MISSED! ${keeper.name} keeps out ${kicker.name}! (${so.homePen}–${so.awayPen})`;
            }
            state.playSound?.(scored ? 'goal' : 'whistle');

            setTimeout(() => renderStep(), 900);
          };
        });
      }
    };

    modal.classList.add('active');
    renderStep();
  }

  _finalizeCompletedMatch() {
    const penSuffix = this.penaltyShootout ? ` (${this.penaltyShootout.homePen}–${this.penaltyShootout.awayPen} pens)` : '';
    const result = `${this.homeScore}–${this.awayScore}${penSuffix}`;
    const scoreEl = document.getElementById('matchScoreDisplay');
    if (scoreEl) scoreEl.textContent = result;

    this._addComm(`🏁 FULL TIME — ${this.home.name} ${result} ${this.away.name}`, 'kickoff');
    this._updateUI();

    state.markFixturePlayed?.(this.fixture, this.homeScore, this.awayScore);
    if (this.penaltyShootout && this.fixture.result) {
      this.fixture.result.penalties = this.penaltyShootout;
    }
    this._updateStandings();

    // Update player stats for LiveMatchEngine (goals and apps)
    this.goalEvents.forEach(g => {
      const clubId = g.side === 'home' ? this.home.id : this.away.id;
      const player = state.players.find(p => p.clubId === clubId && p.name.includes(g.scorer));
      if (player) {
        player.goals = (player.goals || 0) + 1;
        player.formModifier = Math.max(-3, Math.min(3, (Number(player.formModifier) || 0) + 1));
      }
    });

    const homeLost = this.homeScore < this.awayScore || (this.homeScore === this.awayScore && this.penaltyShootout?.winnerSide === 'away');
    const awayLost = this.awayScore < this.homeScore || (this.homeScore === this.awayScore && this.penaltyShootout?.winnerSide === 'home');
    if (homeLost) applyLossForm(this.home.id, state);
    if (awayLost) applyLossForm(this.away.id, state);
    
    [this.home, this.away].forEach(club => {
       const starters = state.players.filter(p => p.clubId === club.id).slice(0, 11);
       starters.forEach(p => {
         if (!p._lastApp || p._lastApp !== this.fixture.id) {
           p.apps = (p.apps || 0) + 1;
           p._lastApp = this.fixture.id;
         }
       });
    });

    state.processTournamentResult?.(this.fixture, this.homeScore, this.awayScore, this.penaltyShootout);
    state.applyMatchInjuries?.(this.fixture);

    if (this.onFinished) {
      setTimeout(() => this.onFinished(this.homeScore, this.awayScore, this.stats.home, this.stats.away, this.penaltyShootout), 500);
    }
  }

    _updateStandings() {
    const dataset = this.fixture.competition === 'UEFA Champions League'
      ? state.uclStandings
      : this.fixture.competition === 'UEFA Europa League'
        ? state.uelStandings
        : state.standings;
    const hr = dataset?.find(s => s.clubId === this.home.id);
    const ar = dataset?.find(s => s.clubId === this.away.id);
    if (!hr || !ar) return;

    hr.played++; ar.played++;
    hr.gf += this.homeScore; hr.ga += this.awayScore;
    ar.gf += this.awayScore; ar.ga += this.homeScore;
    hr.gd = hr.gf - hr.ga;
    ar.gd = ar.gf - ar.ga;

    if (this.homeScore > this.awayScore) {
      hr.won++; hr.pts += 3; ar.lost++;
    } else if (this.homeScore < this.awayScore) {
      ar.won++; ar.pts += 3; hr.lost++;
    } else {
      hr.drawn++; hr.pts += 1; ar.drawn++; ar.pts += 1;
    }

    dataset.sort((a, b) => state.compareStandings(a, b));
  }
}

function engineQuickSim(fixture, calculateTeamRatingsFn, stateRef) {
  if (!fixture) return null;
  const myRatings = calculateTeamRatingsFn();
  const getClubRating = club => {
    const squad = (stateRef.players || []).filter(player => player.clubId === club.id && !player.injury)
      .sort((a, b) => (stateRef.getEffectivePlayerOvr?.(b) ?? b.ovr ?? 0) - (stateRef.getEffectivePlayerOvr?.(a) ?? a.ovr ?? 0)).slice(0, 11);
    if (!squad.length) return club.rating || 75;
    return Math.round(squad.reduce((total, player) => total + (stateRef.getEffectivePlayerOvr?.(player) ?? Number(player.ovr) ?? 75), 0) / squad.length);
  };
  const homeRating = fixture.homeClub.id === stateRef.myClubId ? myRatings.ovr || getClubRating(fixture.homeClub) : getClubRating(fixture.homeClub);
  const awayRating = fixture.awayClub.id === stateRef.myClubId ? myRatings.ovr || getClubRating(fixture.awayClub) : getClubRating(fixture.awayClub);

  // Talent matters, but restrained rating gaps and match variance leave room for upsets.
  const diff = homeRating - awayRating;
  const homeLuck = 0.88 + Math.random() * 0.24;
  const awayLuck = 0.88 + Math.random() * 0.24;
  const hExp = Math.max(0.35, Math.min(2.8, (1.35 + diff * 0.043 + 0.14) * homeLuck));
  const aExp = Math.max(0.35, Math.min(2.8, (1.25 - diff * 0.038) * awayLuck));

  const poissonRand = (lambda) => {
    let L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  };

  let homeScore = poissonRand(hExp);
  let awayScore = poissonRand(aExp);

  // Only knockout fixtures need a tie-break — use authentic 5-kick + sudden death penalty shootout!
  const isKnockout = Boolean(stateRef.isKnockoutFixture?.(fixture)) ||
    /cup_(?:r16|qf|sf|final)/i.test(fixture.id || '') ||
    /(?:ucl|uel)_(?:po|playoff|r16|qf|sf|final)(?:_|$)/i.test(fixture.id || '') ||
    /Round of 16|Quarter|Semi|Final|Playoffs?|QF|SF/i.test(typeof fixture.matchday === 'string' ? fixture.matchday : '');
  let penalties = null;
  if (isKnockout && homeScore === awayScore) {
    penalties = stateRef.simulatePenaltyShootout
      ? stateRef.simulatePenaltyShootout(fixture)
      : { homePen: 4, awayPen: 3, winnerSide: 'home', winnerId: fixture.homeClub.id, winnerName: fixture.homeClub.name, homeKicks: [], awayKicks: [], summary: '4–3 on pens' };
  }

  // Generate Goal Scorers
  const getScorers = (clubId, side, score) => {
    const scorers = [];
    let pool = [];
    if (side === 'home' && stateRef.starters?.length && fixture.homeClub.id === stateRef.myClubId) {
      pool = stateRef.starters.filter(p => p.pos !== 'GK' && !p.injury);
    } else if (side === 'away' && stateRef.starters?.length && fixture.awayClub.id === stateRef.myClubId) {
      pool = stateRef.starters.filter(p => p.pos !== 'GK' && !p.injury);
    } else {
      pool = stateRef.players.filter(p => p.clubId === clubId && p.pos !== 'GK' && !p.injury);
    }
    if (!pool.length) pool = [{ name: 'Striker', pos: 'ST' }];

    const pickScorer = () => {
      const rand = Math.random();
      let targetPos = ['ST', 'CF', 'LW', 'RW'];
      if (rand >= 0.60) targetPos = ['CAM', 'CM', 'CDM', 'LM', 'RM'];
      if (rand >= 0.90) targetPos = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
      
      const posPool = pool.filter(p => targetPos.includes(p.pos));
      if (posPool.length) return posPool[Math.floor(Math.random() * posPool.length)];
      return pool[Math.floor(Math.random() * pool.length)];
    };

    for (let i = 0; i < score; i++) {
      const p = pickScorer();
      if (p.id) {
        const playerRef = stateRef.players.find(x => x.id === p.id) || p;
        playerRef.goals = (playerRef.goals || 0) + 1;
        playerRef.formModifier = Math.max(-3, Math.min(3, (Number(playerRef.formModifier) || 0) + 1));
      }
      const min = Math.floor(Math.random() * 88) + 2;
      const isFreeKick = Math.random() < 0.16;
      scorers.push({ name: p.name, min, side, isFreeKick });
    }

    pool.forEach(p => {
      if (p.id) {
        const playerRef = stateRef.players.find(x => x.id === p.id) || p;
        if (!playerRef._lastApp || playerRef._lastApp !== fixture.id) {
          playerRef.apps = (playerRef.apps || 0) + 1;
          playerRef._lastApp = fixture.id;
        }
      }
    });

    return scorers;
  };

  const homeScorers = getScorers(fixture.homeClub.id, 'home', homeScore);
  const awayScorers = getScorers(fixture.awayClub.id, 'away', awayScore);
  if (homeScore < awayScore) applyLossForm(fixture.homeClub.id, stateRef);
  if (awayScore < homeScore) applyLossForm(fixture.awayClub.id, stateRef);
  const allScorers = [...homeScorers, ...awayScorers].sort((a, b) => a.min - b.min);

  // Dynamic Match Stats Calculation
  const homeShots = homeScore + Math.floor(Math.random() * 9) + 3;
  const awayShots = awayScore + Math.floor(Math.random() * 9) + 3;
  const homeSot   = Math.min(homeShots, homeScore + Math.floor(Math.random() * 4) + 1);
  const awaySot   = Math.min(awayShots, awayScore + Math.floor(Math.random() * 4) + 1);
  
  const homePoss  = Math.min(72, Math.max(28, Math.round(50 + diff * 1.1 + 3 + (Math.random() * 10 - 5))));
  const awayPoss  = 100 - homePoss;
  
  const homeXG    = (homeScore * 0.52 + Math.random() * 0.7).toFixed(2);
  const awayXG    = (awayScore * 0.52 + Math.random() * 0.7).toFixed(2);

  // Generate realistic Fouls, Direct Free Kicks, Yellow Cards, and Red Cards
  const genDiscipline = (clubId, side, clubName) => {
    const fouls = 7 + Math.floor(Math.random() * 9);
    const freeKicks = Math.max(allScorers.filter(s => s.side === side && s.isFreeKick).length, 1 + Math.floor(Math.random() * 4));
    const yRoll = Math.random();
    const yellowCount = yRoll < 0.32 ? 0 : yRoll < 0.76 ? 1 : yRoll < 0.95 ? 2 : 3;
    const hasStraightRed = Math.random() < 0.04;
    const cards = [];
    let redCount = 0;
    let pool = (side === 'home' && fixture.homeClub.id === stateRef.myClubId && stateRef.starters?.length)
      ? stateRef.starters.filter(p => p.pos !== 'GK')
      : (side === 'away' && fixture.awayClub.id === stateRef.myClubId && stateRef.starters?.length)
        ? stateRef.starters.filter(p => p.pos !== 'GK')
        : (stateRef.players || []).filter(p => p.clubId === clubId && p.pos !== 'GK');
    if (!pool.length) pool = [{ name: 'Defender', pos: 'CB' }];
    const bookedMap = new Map();

    for (let i = 0; i < yellowCount; i++) {
      const p = pool[Math.floor(Math.random() * pool.length)];
      const prev = bookedMap.get(p.name) || 0;
      const min = Math.floor(Math.random() * 86) + 4;
      const playerRef = p.id ? (stateRef.players || []).find(x => x.id === p.id) : null;
      if (prev >= 1 && redCount === 0 && Math.random() < 0.35) {
        redCount++;
        if (playerRef) {
          playerRef.yellowCards = (playerRef.yellowCards || 0) + 1;
          playerRef.redCards = (playerRef.redCards || 0) + 1;
        }
        cards.push({ name: p.name, min, side, clubName, card: 'SECOND_YELLOW' });
      } else {
        bookedMap.set(p.name, prev + 1);
        if (playerRef) playerRef.yellowCards = (playerRef.yellowCards || 0) + 1;
        cards.push({ name: p.name, min, side, clubName, card: 'YELLOW' });
      }
    }
    if (hasStraightRed && redCount === 0) {
      const p = pool[Math.floor(Math.random() * pool.length)];
      redCount++;
      const playerRef = p.id ? (stateRef.players || []).find(x => x.id === p.id) : null;
      if (playerRef) playerRef.redCards = (playerRef.redCards || 0) + 1;
      cards.push({ name: p.name, min: Math.floor(Math.random() * 75) + 12, side, clubName, card: 'RED' });
    }
    return { fouls, freeKicks, yellowCards: yellowCount, redCards: redCount, cards };
  };

  const homeDisc = genDiscipline(fixture.homeClub.id, 'home', fixture.homeClub.name);
  const awayDisc = genDiscipline(fixture.awayClub.id, 'away', fixture.awayClub.name);
  const cardEvents = [...homeDisc.cards, ...awayDisc.cards].sort((a, b) => a.min - b.min);

  stateRef.markFixturePlayed?.(fixture, homeScore, awayScore);
  if (!stateRef.markFixturePlayed) {
    fixture.played = true;
    fixture.result = { homeScore, awayScore };
  }
  if (penalties && fixture.result) {
    fixture.result.penalties = penalties;
  }
  stateRef.applyMatchInjuries?.(fixture);

  // Keep domestic and European league-phase tables separate.
  const isUclMatch = fixture.competition === 'UEFA Champions League' || (fixture.id && fixture.id.includes('ucl_'));
  const isUelMatch = fixture.competition === 'UEFA Europa League' || (fixture.id && fixture.id.includes('uel_'));
  const dataset = isUclMatch ? stateRef.uclStandings : isUelMatch ? stateRef.uelStandings : stateRef.standings;
  const isDomesticLeagueMatch = !isUclMatch && !isUelMatch &&
    fixture.competition === fixture.homeClub.league && fixture.competition === fixture.awayClub.league;
  const isEuropeanLeaguePhase = (isUclMatch || isUelMatch) && Number.isFinite(Number(fixture.matchday));
  const shouldUpdateTable = isDomesticLeagueMatch || isEuropeanLeaguePhase;
  const homeRow = shouldUpdateTable ? dataset?.find(s => s.clubId === fixture.homeClub.id) : null;
  const awayRow = shouldUpdateTable ? dataset?.find(s => s.clubId === fixture.awayClub.id) : null;

  if (homeRow && awayRow) {
    homeRow.played++; awayRow.played++;
    homeRow.gf += homeScore; homeRow.ga += awayScore;
    awayRow.gf += awayScore; awayRow.ga += homeScore;
    homeRow.gd = homeRow.gf - homeRow.ga;
    awayRow.gd = awayRow.gf - awayRow.ga;

    if (homeScore > awayScore) { homeRow.won++; homeRow.pts += 3; awayRow.lost++; }
    else if (homeScore < awayScore) { awayRow.won++; awayRow.pts += 3; homeRow.lost++; }
    else { homeRow.drawn++; homeRow.pts++; awayRow.drawn++; awayRow.pts++; }

    dataset.sort((a, b) => stateRef.compareStandings?.(a, b) ?? (b.pts - a.pts || b.gd - a.gd || b.gf - a.gf));
  }

  stateRef.processTournamentResult?.(fixture, homeScore, awayScore, penalties);
  stateRef.playSound?.('whistle');
  
  const penLabel = penalties ? ` (${penalties.homePen}–${penalties.awayPen} pens)` : '';
  stateRef.news.unshift({
    headline: `FULL TIME: ${fixture.homeClub.name} ${homeScore}–${awayScore}${penLabel} ${fixture.awayClub.name}`,
    date: stateRef.getFormattedDate?.() || '',
    category: 'MATCH RESULT',
  });
  stateRef.news = stateRef.news.slice(0, 40);

  return {
    fixture,
    homeScore,
    awayScore,
    penalties,
    allScorers,
    cardEvents,
    stats: {
      homePoss, awayPoss,
      homeShots, awayShots,
      homeSot, awaySot,
      homeXG, awayXG,
      homeFreeKicks: homeDisc.freeKicks,
      awayFreeKicks: awayDisc.freeKicks,
      homeFouls: homeDisc.fouls,
      awayFouls: awayDisc.fouls,
      homeYellow: homeDisc.yellowCards,
      awayYellow: awayDisc.yellowCards,
      homeRed: homeDisc.redCards,
      awayRed: awayDisc.redCards
    }
  };
}
