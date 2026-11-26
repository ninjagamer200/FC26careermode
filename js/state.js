/* FIFA Career Mode State Engine & Multi-Competition Manager */



class CareerState {
  constructor() {
    this.currentDate = new Date(2026, 6, 1); // 01 July 2026
    this.seasonIndex = 0;
    this.season = '2026/27';
    this.myClubId = 'real_madrid';
    this.managerName = 'Carlo Ancelotti';
    this.managerRating = 88;
    this.selectedFormationKey = '4-3-3';
    this.activeCompetition = 'LEAGUE'; // 'LEAGUE' | 'UCL' | 'UEL'
    
    this.clubs = JSON.parse(JSON.stringify(INITIAL_CLUBS));
    this.players = JSON.parse(JSON.stringify(INITIAL_PLAYERS));
    
    this.myClub = this.clubs.find(c => c.id === this.myClubId) || this.clubs[0];
    
    // Squad lineup state
    this.starters = [];
    this.bench = [];
    
    // Incoming Transfer Bids from rival clubs
    this.incomingOffers = [];

    // History of finished seasons
    this.seasonHistory = [];

    // Point #2: Financial Depth & Tiered Sponsorships
    this.activeSponsor = null;
    this.sponsorOffers = [];
    this.sponsorBonusEarned = 0;

    // Point #5: End-of-Season Awards History
    this.awardsHistory = [];

    // Guard against accidental double-rollover
    this._isAdvancingSeason = false;

    // Inbox / Notifications
    this.inbox = [
      { id: 'm1', title: 'Welcome to the New Season!', sender: 'Board of Directors', date: '01 Jul 2026', body: 'Build a season plan that fits your squad, club reputation, and board expectations.' },
      { id: 'm2', title: 'European places are earned', sender: 'UEFA Board', date: '01 Jul 2026', body: 'Finish 1st or 2nd in your domestic league for the Champions League, or 3rd or 4th for the Europa League. Places apply from the following season.' }
    ];
    
    // News Ticker
    this.news = [
      { headline: 'EUROPEAN PREVIEW: Top 2 teams locked for UCL, 3rd & 4th fighting for Europa League!', date: '01 Jul 2026', category: 'UEFA COMPETITIONS' },
      { headline: 'Transfer Window officially OPEN across European leagues.', date: '01 Jul 2026', category: 'TRANSFERS' }
    ];

    this.hasSavedCareer = false;
    this._savedYouth = null;

    // League Table, UCL, UEL & Fixtures Initialization
    this.initLeagueTable();
    this.initEuropeanCompetitions();
    this.initDomesticCup();
    this.initFixtures();
    this.deduplicateSquads();
    this.initSquad();
    this.initSponsorOffers();
    this.initAudio();
  }

  // Exact method names required by index.html and app.js
  saveState() {
    return this.save();
  }

  loadState() {
    return this.load();
  }

  resetCareer() {
    this.hasSavedCareer = false;
    localStorage.removeItem('fifa_career_save_state');
    location.reload();
  }


  deduplicateSquads() {
    if (!Array.isArray(this.players)) return;
    const seenIds = new Set();
    const seenClubNames = new Set();
    const unique = [];
    // Sort so higher goals/apps/ovr wins if duplicate exists
    const sorted = [...this.players].sort((a, b) =>
      ((b.goals || 0) + (b.apps || 0)) - ((a.goals || 0) + (a.apps || 0)) || (b.ovr || 0) - (a.ovr || 0)
    );
    for (const p of sorted) {
      if (!p || !p.id) continue;
      if (seenIds.has(p.id)) continue;
      const clubKey = `${p.clubId || 'FREE'}::${String(p.name || '').trim().toLowerCase()}`;
      if (seenClubNames.has(clubKey)) continue;
      seenIds.add(p.id);
      seenClubNames.add(clubKey);
      unique.push(p);
    }
    this.players = unique;

    const validIds = new Set(this.players.map(p => p.id));
    const usedStarterIds = new Set();
    if (Array.isArray(this.starters)) {
      this.starters = this.starters.filter(s => {
        if (!s || !validIds.has(s.id) || usedStarterIds.has(s.id)) return false;
        usedStarterIds.add(s.id);
        return true;
      });
    }
    if (Array.isArray(this.bench)) {
      const usedBenchIds = new Set();
      this.bench = this.bench.filter(b => {
        if (!b || !validIds.has(b.id) || usedStarterIds.has(b.id) || usedBenchIds.has(b.id)) return false;
        usedBenchIds.add(b.id);
        return true;
      });
    }
  }

  save() {
    if (!this.hasSavedCareer) return; // Don't save before the user picks a club
    try {
      const stateData = {
        hasSavedCareer: true,
        currentDate: this.currentDate.toISOString(),
        seasonIndex: this.seasonIndex,
        season: this.season,
        myClubId: this.myClubId,
        managerName: this.managerName,
        managerRating: this.managerRating,
        selectedFormationKey: this.selectedFormationKey,
        activeCompetition: this.activeCompetition,
        clubs: this.clubs,
        players: this.players,
        starterIds: this.starters.map(p => p.id),
        benchIds: this.bench.map(p => p.id),
        incomingOffers: this.incomingOffers,
        seasonHistory: this.seasonHistory,
        previousSeasonStandings: this.previousSeasonStandings,
        inbox: this.inbox,
        news: this.news,
        standings: this.standings,
        uclStandings: this.uclStandings,
        uclFixtures: this.uclFixtures,
        uclTree: this.uclTree,
        uelStandings: this.uelStandings,
        uelFixtures: this.uelFixtures,
        uelTree: this.uelTree,
        cupTree: this.cupTree,
        cupFixtures: this.cupFixtures,
        domesticCupTitle: this.domesticCupTitle,
        fixtures: this.fixtures,
        trophyCabinet: this.trophyCabinet,
        activeSponsor: this.activeSponsor,
        sponsorOffers: this.sponsorOffers,
        sponsorBonusEarned: this.sponsorBonusEarned,
        awardsHistory: this.awardsHistory,
        // Save Youth Academy state if youthEngine is active
        youth: typeof youthEngine !== 'undefined' ? {
          academy: youthEngine.academy || [],
          standings: youthEngine.standings || [],
          recentResults: youthEngine.recentResults || []
        } : this._savedYouth
      };
      localStorage.setItem('fifa_career_save_state', JSON.stringify(stateData));
    } catch (e) {
      console.error('Failed to save career state:', e);
    }
  }

  load() {
    try {
      const saved = localStorage.getItem('fifa_career_save_state');
      if (!saved) return false;
      const data = JSON.parse(saved);
      if (!data.hasSavedCareer) return false;

      this.hasSavedCareer = true;
      this.currentDate = new Date(data.currentDate);
      this.seasonIndex = data.seasonIndex ?? this.seasonIndex;
      this.season = data.season ?? this.season;
      this.myClubId = data.myClubId ?? this.myClubId;
      this.managerName = data.managerName ?? this.managerName;
      this.managerRating = data.managerRating ?? this.managerRating;
      this.selectedFormationKey = data.selectedFormationKey ?? this.selectedFormationKey;
      this.activeCompetition = data.activeCompetition ?? this.activeCompetition;
      this.clubs = data.clubs ?? this.clubs;
      this.players = data.players ?? this.players;
      this.myClub = this.clubs.find(c => c.id === this.myClubId) || this.clubs[0];
      this.deduplicateSquads();

      // Relink starters and bench directly to this.players objects
      if (data.starterIds && data.benchIds) {
        this.starters = data.starterIds.map(id => this.players.find(p => p.id === id)).filter(Boolean);
        this.bench = data.benchIds.map(id => this.players.find(p => p.id === id)).filter(Boolean);
      } else {
        this.initSquad();
      }

      this.incomingOffers = (data.incomingOffers ?? []).filter(offer => {
        if (offer.status !== 'PENDING') return true;
        const player = this.players.find(p => p.id === offer.playerId);
        const biddingClub = this.clubs.find(club => club.id === offer.biddingClubId);
        if (!player || !biddingClub) return false;
        const effectiveVal = this.getRealisticPlayerValue(player);
        const minRating = this.getMinimumBidderRating(player, effectiveVal);
        if (Number(biddingClub.rating || biddingClub.ovr || 0) < minRating) return false;
        if (offer.type === 'TRANSFER' && (Number(offer.bidAmount) || 0) < Math.round(effectiveVal * 0.85)) return false;
        return true;
      }).map(offer => {
        const biddingClub = this.clubs.find(club => club.id === offer.biddingClubId);
        if (!biddingClub) return offer;
        const ceiling = this.getTransferOfferCeiling(biddingClub);
        if (offer.type === 'TRANSFER' && offer.bidAmount > ceiling) return { ...offer, bidAmount: ceiling };
        if (offer.type === 'LOAN_OPTION' && offer.buyOptionFee > ceiling) return { ...offer, buyOptionFee: ceiling };
        return offer;
      });
      this.seasonHistory = data.seasonHistory ?? [];
      this.previousSeasonStandings = data.previousSeasonStandings ?? [];
      this.inbox = data.inbox ?? [];
      this.news = data.news ?? [];
      this.standings = data.standings ?? [];
      this.uclStandings = data.uclStandings ?? [];
      this.uclFixtures = (data.uclFixtures || []).map(f => ({ ...f, date: new Date(f.date) }));
      this.uclTree = data.uclTree ?? this.uclTree;
      this.uelStandings = data.uelStandings ?? [];
      this.uelFixtures = (data.uelFixtures || []).map(f => ({ ...f, date: new Date(f.date) }));
      this.uelTree = data.uelTree ?? this.uelTree;
      this.cupTree = data.cupTree ?? this.cupTree;
      this.cupFixtures = (data.cupFixtures || []).map(f => ({ ...f, date: new Date(f.date) }));
      this.domesticCupTitle = data.domesticCupTitle ?? this.domesticCupTitle;
      this.fixtures = (data.fixtures || []).map(f => ({ ...f, date: new Date(f.date) }));
      const europeanFixturesById = new Map([...this.uclFixtures, ...this.uelFixtures].map(fixture => [fixture.id, fixture]));
      this.fixtures = this.fixtures.map(savedFixture => {
        const europeanFixture = europeanFixturesById.get(savedFixture.id);
        if (!europeanFixture) return savedFixture;
        Object.assign(europeanFixture, savedFixture);
        return europeanFixture;
      });
      const scheduledIds = new Set(this.fixtures.map(fixture => fixture.id));
      [...this.uclFixtures, ...this.uelFixtures].forEach(fixture => {
        if (!scheduledIds.has(fixture.id)) this.fixtures.push(fixture);
      });
      const fixturesById = new Map();
      [...this.fixtures, ...this.uclFixtures, ...this.uelFixtures].forEach(fixture => {
        if (fixture.result && Number.isFinite(Number(fixture.result.homeScore)) && Number.isFinite(Number(fixture.result.awayScore))) {
          fixture.played = true;
        }
        if (fixture.id) {
          const existing = fixturesById.get(fixture.id);
          if (existing?.played || fixture.played) {
            const completedFixture = fixture.played ? fixture : existing;
            fixturesById.set(fixture.id, completedFixture);
          } else {
            fixturesById.set(fixture.id, fixture);
          }
        }
      });
      this.fixtures = this.fixtures.map(fixture => fixturesById.get(fixture.id) || fixture);
      this.uclFixtures = this.uclFixtures.map(fixture => fixturesById.get(fixture.id) || fixture);
      this.uelFixtures = this.uelFixtures.map(fixture => fixturesById.get(fixture.id) || fixture);
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
      this.trophyCabinet = data.trophyCabinet ?? [];
      this.activeSponsor = data.activeSponsor ?? null;
      this.sponsorOffers = data.sponsorOffers ?? [];
      this.sponsorBonusEarned = data.sponsorBonusEarned ?? 0;
      this.awardsHistory = data.awardsHistory ?? [];
      if (!this.activeSponsor && (!this.sponsorOffers || !this.sponsorOffers.length)) {
        this.initSponsorOffers();
      }
      this._savedYouth = data.youth || null;

      // Auto-repair saves corrupted by the previous double-click season rollover bug
      // where a phantom 0-played season overwrote previousSeasonStandings.
      let repairedDoubleRollover = false;
      if (
        this.previousSeasonStandings?.length > 0 &&
        this.previousSeasonStandings.every(row => (Number(row.played) || 0) === 0) &&
        this.seasonHistory.length >= 2
      ) {
        const phantomEntry = this.seasonHistory[0];
        const realEntry = this.seasonHistory[1];
        if (realEntry && Number.isFinite(Number(realEntry.userFinish)) && Number(realEntry.userFinish) > 0) {
          this.seasonHistory.shift();
          this.seasonIndex = Math.max(1, (this.seasonIndex || 1) - 1);
          const startYear = 2026 + this.seasonIndex;
          const endYearShort = String(startYear + 1).slice(-2);
          this.season = `${startYear}/${endYearShort}`;
          this.previousSeasonStandings = [];
          repairedDoubleRollover = true;
        }
      }

      if (this.repairLegacyEuropeanSchedule() || repairedDoubleRollover) this.save();

      return true;
    } catch (e) {
      console.error(' :', e);
      return false;
    }
  }

  selectUserClub(clubId) {
    const club = this.clubs.find(c => c.id === clubId);
    if (!club) return;
    
    this.hasSavedCareer = true;
    this.myClubId = clubId;
    this.myClub = club;
    this.currentDate = new Date(2026, 6, 1);
    
    this.initSquad();
    this.initLeagueTable();
    this.initEuropeanCompetitions();
    this.initDomesticCup();
    this.initFixtures();
    this.initTrophies();
    this.activeSponsor = null;
    this.sponsorBonusEarned = 0;
    this.awardsHistory = [];
    this.initSponsorOffers();
    if (typeof youthEngine !== 'undefined') {
      youthEngine.initYouthLeague();
    }

    this.news.unshift({
      headline: `APPOINTMENT: ${this.managerName} announced as Manager of ${club.name}! The board's targets will reflect the club's level.`,
      date: this.getFormattedDate(),
      category: 'BREAKING NEWS'
    });
  }

  initSquad() {
    const myPlayers = this.players.filter(p => p.clubId === this.myClubId);
    const starters = [];

    const findPos = (posList) => myPlayers.find(p => posList.includes(p.pos) && !starters.includes(p));
    
    const roleMap = [
      ['GK'],
      ['LB', 'LWB'],
      ['CB'],
      ['CB'],
      ['RB', 'RWB'],
      ['CDM', 'CM'],
      ['CM'],
      ['CAM', 'CM'],
      ['LW', 'LM'],
      ['ST', 'CF'],
      ['RW', 'RM']
    ];

    roleMap.forEach(roles => {
      const found = findPos(roles) || myPlayers.find(p => !starters.includes(p));
      if (found) starters.push(found);
    });

    this.starters = starters.slice(0, 11);
    this.bench = myPlayers.filter(p => !this.starters.includes(p));
  }

  compareStandings(a, b) {
    return (b.pts || 0) - (a.pts || 0) || (b.gd || 0) - (a.gd || 0) ||
      (b.gf || 0) - (a.gf || 0) || (b.won || 0) - (a.won || 0) ||
      String(a.name || '').localeCompare(String(b.name || ''));
  }

  getEffectivePlayerOvr(player) {
    const moraleAdjustment = Math.max(-3, Math.min(3, Math.round(((player.morale ?? 70) - 70) / 10)));
    const formModifier = Math.max(-3, Math.min(3, Number(player.formModifier) || 0));
    return Math.max(40, Math.min(99, (Number(player.ovr) || 60) - (player.injury?.ovrPenalty || 0) + moraleAdjustment + formModifier));
  }

  progressInjuries(days = 1) {
    if (!Number.isFinite(days) || days <= 0) return;
    this.players.forEach(player => {
      if (!player.injury) return;
      player.injury.daysRemaining = Math.max(0, (player.injury.daysRemaining || 0) - days);
      if (player.injury.daysRemaining === 0) {
        player.morale = Math.min(99, (player.morale ?? 70) + (player.injury.moralePenalty || 0));
        this.news.unshift({ headline: `FITNESS UPDATE: ${player.name} has recovered and is available again.`, date: this.getFormattedDate(), category: 'MEDICAL' });
        delete player.injury;
      }
    });
  }

  applyMatchInjuries(fixture) {
    const teams = [fixture.homeClub, fixture.awayClub];
    const injuryTypes = [
      { type: 'Bruised ankle', min: 2, max: 5, penalty: 2, morale: 2 },
      { type: 'Muscle knock', min: 4, max: 9, penalty: 3, morale: 3 },
      { type: 'Ankle sprain', min: 10, max: 21, penalty: 5, morale: 5 },
      { type: 'Hamstring tear', min: 24, max: 45, penalty: 7, morale: 8 },
      { type: 'ACL / Knee ligament injury', min: 60, max: 120, penalty: 10, morale: 10 }
    ];
    teams.forEach(club => {
      const injuryChance = club.id === this.myClubId ? 0.22 : 0.07;
      if (Math.random() > injuryChance) return;
      const candidates = this.players.filter(player => player.clubId === club.id && !player.injury)
        .sort((a, b) => this.getEffectivePlayerOvr(b) - this.getEffectivePlayerOvr(a)).slice(0, 18);
      if (!candidates.length) return;
      const player = candidates[Math.floor(Math.random() * candidates.length)];
      const roll = Math.random();
      const type = roll < 0.46 ? injuryTypes[0] : roll < 0.75 ? injuryTypes[1] : roll < 0.91 ? injuryTypes[2] : roll < 0.985 ? injuryTypes[3] : injuryTypes[4];
      const daysRemaining = type.min + Math.floor(Math.random() * (type.max - type.min + 1));
      player.injury = { type: type.type, daysRemaining, ovrPenalty: type.penalty, moralePenalty: type.morale };
      player.morale = Math.max(10, (player.morale ?? 70) - type.morale);
      if (club.id === this.myClubId) {
        const headline = `${player.name} injured: ${type.type} — estimated ${daysRemaining} days out.`;
        this.news.unshift({ headline, date: this.getFormattedDate(), category: 'MEDICAL' });
        const id = `injury_${player.id}_${Date.now()}`;
        this.inbox.unshift({ id, title: `Injury alert: ${player.name}`, sender: 'Club Medical Team', date: this.getFormattedDate(), body: `${player.name} has suffered a ${type.type.toLowerCase()}. The medical team expects ${daysRemaining} days of recovery. Their effective OVR and morale will recover as they heal.` });
      }
    });
  }

  initLeagueTable() {
    const targetLeague = this.myClub ? this.myClub.league : 'La Liga';
    const leagueClubs = this.clubs.filter(c => c.league === targetLeague);
    
    this.standings = leagueClubs.map(club => ({
      clubId: club.id,
      name: club.name,
      shortName: club.shortName,
      crest: club.crest,
      league: club.league,
      played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0
    }));
  }

  initEuropeanCompetitions(customUCLClubIds = null) {
    if (!(this.seasonIndex > 0 && this.previousSeasonStandings?.length)) {
      this.uclStandings = [];
      this.uelStandings = [];
      this.uclFixtures = [];
      this.uelFixtures = [];
      this.uclTree = null;
      this.uelTree = null;
      return;
    }

    let uclClubIds = customUCLClubIds;
    let uelClubIds = [];

    if (!uclClubIds || !uclClubIds.length) {
      if (this.seasonIndex > 0 && this.previousSeasonStandings?.length) {
        // Subsequent Seasons: Dynamic qualification based on previous season league standings
        uclClubIds = [];
        const userLeague = this.myClub ? this.myClub.league : 'La Liga';
        const allLeagues = ['La Liga', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1'];

        allLeagues.forEach(leagueName => {
          const leagueClubs = this.clubs.filter(c => c.league === leagueName);
          if (leagueName === userLeague) {
            const sorted = [...this.previousSeasonStandings].sort((a, b) => this.compareStandings(a, b));
            if (sorted.length >= 2) uclClubIds.push(sorted[0].clubId, sorted[1].clubId);
            if (sorted.length >= 4) uelClubIds.push(sorted[2].clubId, sorted[3].clubId);
          } else {
            const sortedForeign = [...leagueClubs].sort((a, b) => (b.rating || 80) - (a.rating || 80));
            if (sortedForeign.length >= 2) uclClubIds.push(sortedForeign[0].id, sortedForeign[1].id);
            if (sortedForeign.length >= 4) uelClubIds.push(sortedForeign[2].id, sortedForeign[3].id);
          }
        });

        const remainingClubs = this.clubs.filter(c => c.league !== userLeague && !uclClubIds.includes(c.id) && !uelClubIds.includes(c.id))
          .sort((a, b) => (b.rating || 80) - (a.rating || 80));
        while (uclClubIds.length < 13 && remainingClubs.length > 0) {
          uclClubIds.push(remainingClubs.shift().id);
        }
        uclClubIds = uclClubIds.slice(0, 13);

        uelClubIds = uelClubIds.filter(id => !uclClubIds.includes(id)).slice(0, 10);
        const uelRemaining = this.clubs.filter(c => c.league !== userLeague && !uclClubIds.includes(c.id) && !uelClubIds.includes(c.id))
          .sort((a, b) => (b.rating || 80) - (a.rating || 80));
        while (uelClubIds.length < 10 && uelRemaining.length > 0) {
          uelClubIds.push(uelRemaining.shift().id);
        }

        // Strict guarantee: if user qualified for UCL (1st-2nd) or UEL (3rd-4th), lock them in
        const expectedQual = this.getEuropeanQualification();
        if (expectedQual === 'UCL') {
          uelClubIds = uelClubIds.filter(id => id !== this.myClubId);
          if (!uclClubIds.includes(this.myClubId)) {
            uclClubIds[Math.max(0, uclClubIds.length - 1)] = this.myClubId;
          }
        } else if (expectedQual === 'UEL') {
          uclClubIds = uclClubIds.filter(id => id !== this.myClubId);
          if (!uelClubIds.includes(this.myClubId)) {
            uelClubIds[Math.max(0, uelClubIds.length - 1)] = this.myClubId;
          }
        }
      }
    } else {
      uclClubIds = [...uclClubIds];
    }

    // 1. UCL Setup (13 teams, 8 matchdays)
    const uclClubs = this.clubs.filter(c => uclClubIds.includes(c.id));
    this.uclStandings = uclClubs.map(club => ({
      clubId: club.id,
      name: club.name,
      shortName: club.shortName,
      crest: club.crest,
      league: 'UEFA Champions League',
      played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0
    }));

    this.uclTree = {
      playoffs: [],
      qf: [],
      sf: [],
      final: null,
      generatedKnockouts: false
    };

    // Generate full fixtures for ALL 13 UCL Clubs (8 matchdays)
    this.uclFixtures = [];
    let uclDate = new Date(this.currentDate);
    uclDate.setDate(uclDate.getDate() + 10);

    const uclList = [...uclClubs];
    if (uclList.length % 2 !== 0) uclList.push({ id: 'bye', name: 'Bye' });
    const uclNum = uclList.length;

    let uclFixCounter = 1;
    for (let md = 0; md < 8; md++) {
      for (let i = 0; i < uclNum / 2; i++) {
        const homeIdx = (md + i) % (uclNum - 1);
        let awayIdx = (uclNum - 1 - i + md) % (uclNum - 1);
        if (i === 0) awayIdx = uclNum - 1;

        const home = uclList[homeIdx];
        const away = uclList[awayIdx];

        if (home.id !== 'bye' && away.id !== 'bye') {
          const hClub = (md % 2 === 0) ? home : away;
          const aClub = (md % 2 === 0) ? away : home;
          this.uclFixtures.push({
            id: `ucl_fix_${uclFixCounter++}`,
            matchday: md + 1,
            date: new Date(uclDate),
            competition: 'UEFA Champions League',
            homeClub: hClub,
            awayClub: aClub,
            played: false,
            result: null
          });
        }
      }
      uclDate.setDate(uclDate.getDate() + 14);
    }

    // 2. UEL Setup (10 teams, 6 matchdays)
    const uelClubs = this.clubs.filter(c => uelClubIds.includes(c.id));
    this.uelStandings = uelClubs.map(club => ({
      clubId: club.id,
      name: club.name,
      shortName: club.shortName,
      crest: club.crest,
      league: 'UEFA Europa League',
      played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0
    }));

    this.uelTree = {
      playoffs: [],
      qf: [],
      sf: [],
      final: null,
      generatedKnockouts: false
    };

    // Generate full fixtures for ALL 10 UEL Clubs (6 matchdays)
    this.uelFixtures = [];
    let uelDate = new Date(this.currentDate);
    uelDate.setDate(uelDate.getDate() + 12);

    const uelList = [...uelClubs];
    const uelNum = uelList.length;
    let uelFixCounter = 1;

    for (let md = 0; md < 6; md++) {
      for (let i = 0; i < uelNum / 2; i++) {
        const homeIdx = (md + i) % (uelNum - 1);
        let awayIdx = (uelNum - 1 - i + md) % (uelNum - 1);
        if (i === 0) awayIdx = uelNum - 1;

        const home = uelList[homeIdx];
        const away = uelList[awayIdx];

        if (home.id !== 'bye' && away.id !== 'bye') {
          const hClub = (md % 2 === 0) ? home : away;
          const aClub = (md % 2 === 0) ? away : home;
          this.uelFixtures.push({
            id: `uel_fix_${uelFixCounter++}`,
            matchday: md + 1,
            date: new Date(uelDate),
            competition: 'UEFA Europa League',
            homeClub: hClub,
            awayClub: aClub,
            played: false,
            result: null
          });
        }
      }
      uelDate.setDate(uelDate.getDate() + 14);
    }
  }

  initDomesticCup() {
    const userLeague = this.myClub ? this.myClub.league : 'La Liga';
    const cupTitles = {
      'Premier League': 'FA Cup',
      'La Liga': 'Copa del Rey',
      'Serie A': 'Coppa Italia',
      'Bundesliga': 'DFB-Pokal',
      'Ligue 1': 'Coupe de France'
    };
    this.domesticCupTitle = cupTitles[userLeague] || 'Domestic Cup';

    const leagueClubs = this.clubs.filter(c => c.league === userLeague);
    const shuffled = [...leagueClubs].sort(() => Math.random() - 0.5);
    const cupClubs = shuffled.slice(0, 16);

    if (this.myClub && !cupClubs.some(c => c.id === this.myClubId)) {
      cupClubs[15] = this.myClub;
    }

    // Build 16-Team Tournament Tree (8 R16 ties)
    const r16 = [];
    for (let i = 0; i < 16; i += 2) {
      r16.push({
        id: `cup_r16_${i/2 + 1}`,
        home: cupClubs[i],
        away: cupClubs[i+1],
        scoreHome: null,
        scoreAway: null,
        winner: null,
        isUserTie: (cupClubs[i].id === this.myClubId || cupClubs[i+1].id === this.myClubId)
      });
    }

    this.cupTree = {
      r16: r16,
      qf: Array(4).fill(null).map((_, idx) => ({ id: `cup_qf_${idx+1}`, home: { name: 'TBD' }, away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null })),
      sf: Array(2).fill(null).map((_, idx) => ({ id: `cup_sf_${idx+1}`, home: { name: 'TBD' }, away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null })),
      final: { id: 'cup_final', home: { name: 'TBD' }, away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null }
    };
    
    this.cupFixtures = [];
    let d = new Date(this.currentDate);
    d.setDate(d.getDate() + 45); 

    this.cupTree.r16.forEach(match => {
      this.cupFixtures.push({
        id: match.id,
        matchday: 'Round of 16',
        date: new Date(d),
        competition: this.domesticCupTitle,
        homeClub: match.home,
        awayClub: match.away,
        played: false,
        result: null
      });
      d.setDate(d.getDate() + 1); // stagger them slightly
    });
  }

  initFixtures() {
    const targetLeague = this.myClub ? this.myClub.league : 'La Liga';
    const leagueClubs = this.clubs.filter(c => c.league === targetLeague);
    if (!leagueClubs.length) return;

    const clubs = [...leagueClubs];
    const n = clubs.length;
    if (n % 2 !== 0) clubs.push({ id: 'bye', name: 'Bye' });
    const numTeams = clubs.length;
    const rounds = numTeams - 1;

    let fixtureDate = new Date(this.currentDate);
    fixtureDate.setDate(fixtureDate.getDate() + 4);

    const leagueFix = [];
    let fixIdCounter = 1;

    // First Half of Season
    for (let round = 0; round < rounds; round++) {
      const matchdayNumber = round + 1;
      for (let i = 0; i < numTeams / 2; i++) {
        const homeIdx = (round + i) % (numTeams - 1);
        let awayIdx = (numTeams - 1 - i + round) % (numTeams - 1);
        if (i === 0) awayIdx = numTeams - 1;

        const home = clubs[homeIdx];
        const away = clubs[awayIdx];

        if (home.id !== 'bye' && away.id !== 'bye') {
          const finalHome = (round % 2 === 0) ? home : away;
          const finalAway = (round % 2 === 0) ? away : home;

          leagueFix.push({
            id: `fix_lg_${fixIdCounter++}`,
            matchday: `MD ${matchdayNumber}`,
            date: new Date(fixtureDate),
            competition: targetLeague,
            homeClub: finalHome,
            awayClub: finalAway,
            played: false,
            result: null
          });
        }
      }
      fixtureDate.setDate(fixtureDate.getDate() + 7);
    }

    // Second Half of Season (Reverse Fixtures)
    for (let round = 0; round < rounds; round++) {
      const matchdayNumber = rounds + round + 1;
      for (let i = 0; i < numTeams / 2; i++) {
        const homeIdx = (round + i) % (numTeams - 1);
        let awayIdx = (numTeams - 1 - i + round) % (numTeams - 1);
        if (i === 0) awayIdx = numTeams - 1;

        const home = clubs[homeIdx];
        const away = clubs[awayIdx];

        if (home.id !== 'bye' && away.id !== 'bye') {
          const finalHome = (round % 2 === 0) ? away : home;
          const finalAway = (round % 2 === 0) ? home : away;

          leagueFix.push({
            id: `fix_lg_${fixIdCounter++}`,
            matchday: `MD ${matchdayNumber}`,
            date: new Date(fixtureDate),
            competition: targetLeague,
            homeClub: finalHome,
            awayClub: finalAway,
            played: false,
            result: null
          });
        }
      }
      fixtureDate.setDate(fixtureDate.getDate() + 7);
    }

    const europeanFixtures = [...(this.uclFixtures || []), ...(this.uelFixtures || [])];
    const cupFix = this.cupFixtures || [];
    const allUnplayed = [...leagueFix, ...europeanFixtures, ...cupFix];
    allUnplayed.sort((a, b) => new Date(a.date) - new Date(b.date));

    this.fixtures = allUnplayed;
  }

  getPreviousSeasonFinish() {
    const rawPrev = this.previousSeasonStandings || [];
    const hasPlayedMatches = rawPrev.some(row => (Number(row.played) || 0) > 0);
    if (rawPrev.length && hasPlayedMatches) {
      const previousStandings = [...rawPrev].sort((a, b) => this.compareStandings(a, b));
      const previousRank = previousStandings.findIndex(row => row.clubId === this.myClubId);
      if (previousRank >= 0) return previousRank + 1;
    }

    const historyFinish = Number(this.seasonHistory?.[0]?.userFinish);
    if (Number.isFinite(historyFinish) && historyFinish > 0) return historyFinish;

    if (rawPrev.length) {
      const previousStandings = [...rawPrev].sort((a, b) => this.compareStandings(a, b));
      const previousRank = previousStandings.findIndex(row => row.clubId === this.myClubId);
      if (previousRank >= 0) return previousRank + 1;
    }
    return null;
  }

  getEuropeanQualification() {
    const previousFinish = this.getPreviousSeasonFinish();
    if (!previousFinish) return null;
    if (previousFinish <= 2) return 'UCL';
    if (previousFinish <= 4) return 'UEL';
    return null;
  }

  hasEuropeanQualification() {
    const competition = this.getEuropeanQualification();
    if (!competition) return false;
    const table = competition === 'UCL' ? this.uclStandings : this.uelStandings;
    return table.some(row => row.clubId === this.myClubId);
  }

  getNextEuropeanFixture() {
    const competition = this.getEuropeanQualification();
    if (!competition || !this.hasEuropeanQualification()) return null;
    const expectedCompetition = competition === 'UCL' ? 'UEFA Champions League' : 'UEFA Europa League';
    return this.fixtures.find(f => !f.played && !f.result && f.competition === expectedCompetition && (f.homeClub.id === this.myClubId || f.awayClub.id === this.myClubId)) || null;
  }

  markFixturePlayed(fixture, homeScore, awayScore) {
    if (!fixture?.id) return fixture;
    const result = { homeScore, awayScore };
    const matchingFixtures = [...this.fixtures, ...(this.uclFixtures || []), ...(this.uelFixtures || [])]
      .filter(candidate => candidate.id === fixture.id);
    matchingFixtures.forEach(candidate => {
      candidate.played = true;
      candidate.result = result;
      candidate.homeScore = homeScore;
      candidate.awayScore = awayScore;
    });
    fixture.played = true;
    fixture.result = result;
    fixture.homeScore = homeScore;
    fixture.awayScore = awayScore;
    return fixture;
  }

  getEuropeanTournamentNextStage() {
    const competition = this.getEuropeanQualification();
    if (!competition) return null;

    const tree = competition === 'UCL' ? this.uclTree : this.uelTree;
    if (!tree) return null;

    const rounds = [
      ['playoffs', 'Playoffs'],
      ['qf', 'Quarter-Finals'],
      ['sf', 'Semi-Finals'],
      ['final', 'Final']
    ];

    for (const [roundName, label] of rounds) {
      const matches = Array.isArray(tree[roundName]) ? tree[roundName] : [tree[roundName]];
      if (matches.some(match => match && !match.winner && [match.home, match.away].some(club => club?.id === this.myClubId))) {
        return label;
      }
    }

    const hasUserTie = roundName => {
      const matches = Array.isArray(tree[roundName]) ? tree[roundName] : [tree[roundName]];
      return matches.some(match => match && [match.home, match.away].some(club => club?.id === this.myClubId));
    };
    if (tree.sf?.some(match => match?.winner?.id === this.myClubId) && !tree.final?.winner) return 'Final';
    if (tree.qf?.some(match => match?.winner?.id === this.myClubId) && !hasUserTie('sf')) return 'Semi-Finals';
    if (tree.playoffs?.some(match => match?.winner?.id === this.myClubId) && !hasUserTie('qf')) return 'Quarter-Finals';
    return null;
  }

  repairLegacyEuropeanSchedule() {
    const qualification = this.getEuropeanQualification();
    const isEuropean = fixture => /ucl_|uel_|champions league|europa league/i.test(`${fixture.id || ''} ${fixture.competition || ''}`);
    const inUcl = this.uclStandings?.some(row => row.clubId === this.myClubId);
    const inUel = this.uelStandings?.some(row => row.clubId === this.myClubId);
    const correctlyPlaced = qualification === 'UCL' ? inUcl : qualification === 'UEL' ? inUel : false;
    const incorrectlyPlaced = qualification === 'UCL' ? inUel : qualification === 'UEL' ? inUcl : inUcl || inUel;
    if ((correctlyPlaced && !incorrectlyPlaced) || (!qualification && !incorrectlyPlaced)) return false;
    if (this.fixtures.some(fixture => isEuropean(fixture) && fixture.played)) return false;

    let previousStandings = [...(this.previousSeasonStandings || [])];
    const prevAllZero = previousStandings.length > 0 && previousStandings.every(row => (Number(row.played) || 0) === 0);
    if (!previousStandings.some(row => row.clubId === this.myClubId) || prevAllZero) {
      const userPosition = Number(this.seasonHistory?.[0]?.userFinish);
      if (!Number.isFinite(userPosition) || userPosition < 1) {
        this.uclStandings = [];
        this.uelStandings = [];
        this.uclFixtures = [];
        this.uelFixtures = [];
        this.uclTree = null;
        this.uelTree = null;
        this.fixtures = this.fixtures.filter(fixture => !isEuropean(fixture));
        return true;
      }

      const leagueClubs = this.clubs.filter(club => club.league === this.myClub?.league && club.id !== this.myClubId)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));
      leagueClubs.splice(Math.max(0, Math.min(leagueClubs.length, userPosition - 1)), 0, this.myClub);
      previousStandings = leagueClubs.map((club, index) => ({ clubId: club.id, pts: leagueClubs.length - index, gd: 0, gf: 0 }));
      this.previousSeasonStandings = previousStandings;
    }

    const domesticFixtures = this.fixtures.filter(fixture => !isEuropean(fixture));
    this.seasonIndex = Math.max(1, this.seasonIndex || 0);
    this.initEuropeanCompetitions();
    this.fixtures = [...domesticFixtures, ...this.uclFixtures, ...this.uelFixtures]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return true;
  }

  getNextFixture() {
    return this.fixtures.find(f => !f.played && !/ucl_|uel_|champions league|europa league/i.test(`${f.id || ''} ${f.competition || ''}`) && (f.homeClub.id === this.myClubId || f.awayClub.id === this.myClubId)) || null;
  }

  simCpuMatches() {
    const maxDate = new Date(this.currentDate);

    // Simulate every non-user fixture up to today so parallel competition tables stay current.
    const cpuFixes = this.fixtures.filter(f => !f.played && f.homeClub.id !== this.myClubId && f.awayClub.id !== this.myClubId && new Date(f.date) <= maxDate);

    cpuFixes.forEach(fix => {
      if (typeof engineQuickSim === 'function' && typeof calculateTeamRatings === 'function') {
        engineQuickSim(fix, calculateTeamRatings, this);
      } else {
        fix.played = true;
        const h = Math.floor(Math.random() * 3);
        const a = Math.floor(Math.random() * 3);
        const penalties = (this.isKnockoutFixture(fix) && h === a)
          ? this.simulatePenaltyShootout(fix)
          : null;
        fix.result = { homeScore: h, awayScore: a, penalties };
        this.processTournamentResult(fix, h, a, penalties);
      }
    });
  }

  initTrophies() {
    this.trophyCabinet = this.trophyCabinet || [];
    if (this.trophyCabinet.length > 0) return;

    const club = this.myClub;
    if (!club) return;

    const honours = {
      'real_madrid': [
        { id: 'h_ucl_24', name: 'UEFA Champions League', type: 'UCL', year: '2023/24', clubName: 'Real Madrid' },
        { id: 'h_lg_24', name: 'La Liga Title', type: 'LEAGUE', year: '2023/24', clubName: 'Real Madrid' },
        { id: 'h_cup_23', name: 'Copa del Rey', type: 'CUP', year: '2022/23', clubName: 'Real Madrid' }
      ],
      'barcelona': [
        { id: 'h_lg_23', name: 'La Liga Title', type: 'LEAGUE', year: '2022/23', clubName: 'FC Barcelona' },
        { id: 'h_cup_21', name: 'Copa del Rey', type: 'CUP', year: '2020/21', clubName: 'FC Barcelona' }
      ],
      'man_city': [
        { id: 'h_lg_24_mc', name: 'Premier League Title', type: 'LEAGUE', year: '2023/24', clubName: 'Manchester City' },
        { id: 'h_ucl_23_mc', name: 'UEFA Champions League', type: 'UCL', year: '2022/23', clubName: 'Manchester City' },
        { id: 'h_cup_23_mc', name: 'FA Cup', type: 'CUP', year: '2022/23', clubName: 'Manchester City' }
      ],
      'arsenal': [
        { id: 'h_cup_20_ars', name: 'FA Cup', type: 'CUP', year: '2019/20', clubName: 'Arsenal' }
      ],
      'liverpool': [
        { id: 'h_cup_22_liv', name: 'FA Cup', type: 'CUP', year: '2021/22', clubName: 'Liverpool' },
        { id: 'h_lg_20_liv', name: 'Premier League Title', type: 'LEAGUE', year: '2019/20', clubName: 'Liverpool' }
      ],
      'inter_milan': [
        { id: 'h_lg_24_int', name: 'Serie A Title', type: 'LEAGUE', year: '2023/24', clubName: 'Inter Milan' },
        { id: 'h_cup_23_int', name: 'Coppa Italia', type: 'CUP', year: '2022/23', clubName: 'Inter Milan' }
      ],
      'bayern_munich': [
        { id: 'h_lg_23_bay', name: 'Bundesliga Title', type: 'LEAGUE', year: '2022/23', clubName: 'Bayern München' },
        { id: 'h_ucl_20_bay', name: 'UEFA Champions League', type: 'UCL', year: '2019/20', clubName: 'Bayern München' }
      ],
      'psg': [
        { id: 'h_lg_24_psg', name: 'Ligue 1 Title', type: 'LEAGUE', year: '2023/24', clubName: 'Paris Saint-Germain' },
        { id: 'h_cup_24_psg', name: 'Coupe de France', type: 'CUP', year: '2023/24', clubName: 'Paris Saint-Germain' }
      ]
    };

    if (honours[club.id]) {
      this.trophyCabinet = [...honours[club.id]];
    }
  }

  isKnockoutFixture(fixture) {
    if (!fixture) return false;
    const fixtureId = String(fixture.id || '');
    const matchdayLabel = typeof fixture.matchday === 'string' ? fixture.matchday : '';
    return /cup_(?:r16|qf|sf|final)/i.test(fixtureId) ||
      /(?:ucl|uel)_(?:po|playoff|r16|qf|sf|final)(?:_|$)/i.test(fixtureId) ||
      /Round of 16|Quarter|Semi|Final|Playoffs?|QF|SF/i.test(matchdayLabel);
  }

  simulatePenaltyShootout(fixture) {
    const getKickers = (clubId) => {
      const roster = (this.players || []).filter(p => p.clubId === clubId && !p.injury);
      const sorted = [...roster].sort((a, b) => ((Number(b.sho) || Number(b.ovr) || 70) - (Number(a.sho) || Number(a.ovr) || 70)));
      return sorted.length ? sorted : [{ name: 'Taker 1', ovr: 78, sho: 78 }];
    };
    const getGkOvr = (clubId) => {
      const gk = (this.players || []).find(p => p.clubId === clubId && p.pos === 'GK');
      return Number(gk?.ovr) || 78;
    };

    const homeKickers = getKickers(fixture.homeClub.id);
    const awayKickers = getKickers(fixture.awayClub.id);
    const homeGk = getGkOvr(fixture.homeClub.id);
    const awayGk = getGkOvr(fixture.awayClub.id);

    let homePen = 0;
    let awayPen = 0;
    const homeKicks = [];
    const awayKicks = [];
    const rounds = [];

    const takeKick = (kicker, oppGkOvr) => {
      const skill = Number(kicker?.sho) || Number(kicker?.ovr) || 76;
      const prob = Math.max(0.62, Math.min(0.88, 0.76 + (skill - oppGkOvr) * 0.005));
      return Math.random() < prob;
    };

    // Best-of-5 alternating kicks with authentic mathematical early clinch
    for (let i = 0; i < 5; i++) {
      const hPlayer = homeKickers[i % homeKickers.length];
      const hScored = takeKick(hPlayer, awayGk);
      if (hScored) homePen++;
      homeKicks.push({ player: hPlayer.name, scored: hScored });

      const homeRemAfterH = 4 - i;
      const awayRemAfterH = 5 - i;
      if (homePen > awayPen + awayRemAfterH || awayPen > homePen + homeRemAfterH) {
        rounds.push({ round: i + 1, home: { player: hPlayer.name, scored: hScored }, away: null });
        break;
      }

      const aPlayer = awayKickers[i % awayKickers.length];
      const aScored = takeKick(aPlayer, homeGk);
      if (aScored) awayPen++;
      awayKicks.push({ player: aPlayer.name, scored: aScored });
      rounds.push({ round: i + 1, home: { player: hPlayer.name, scored: hScored }, away: { player: aPlayer.name, scored: aScored } });

      const rem = 4 - i;
      if (homePen > awayPen + rem || awayPen > homePen + rem) {
        break;
      }
    }

    // Sudden death if still level after 5 kicks each
    let sdRound = 6;
    while (homePen === awayPen && sdRound <= 20) {
      const hPlayer = homeKickers[(sdRound - 1) % homeKickers.length];
      const aPlayer = awayKickers[(sdRound - 1) % awayKickers.length];
      const hScored = takeKick(hPlayer, awayGk);
      const aScored = takeKick(aPlayer, homeGk);
      if (hScored) homePen++;
      if (aScored) awayPen++;
      homeKicks.push({ player: hPlayer.name, scored: hScored });
      awayKicks.push({ player: aPlayer.name, scored: aScored });
      rounds.push({ round: sdRound, suddenDeath: true, home: { player: hPlayer.name, scored: hScored }, away: { player: aPlayer.name, scored: aScored } });
      sdRound++;
    }

    if (homePen === awayPen) homePen++;

    const winnerSide = homePen > awayPen ? 'home' : 'away';
    const winnerClub = winnerSide === 'home' ? fixture.homeClub : fixture.awayClub;
    return {
      homePen,
      awayPen,
      winnerSide,
      winnerId: winnerClub.id,
      winnerName: winnerClub.name,
      homeKicks,
      awayKicks,
      rounds,
      suddenDeath: rounds.some(r => r.suddenDeath),
      summary: `${homePen}–${awayPen} on pens`
    };
  }

  processTournamentResult(fixture, homeScore, awayScore, penaltyResult = null) {
    if (!fixture.id.includes('cup_') && !fixture.id.includes('ucl_') && !fixture.id.includes('uel_')) return;

    let penalties = penaltyResult || fixture.result?.penalties || null;
    if (this.isKnockoutFixture(fixture) && homeScore === awayScore) {
      if (!penalties) {
        penalties = this.simulatePenaltyShootout(fixture);
      }
      fixture.result = { ...(fixture.result || {}), homeScore, awayScore, penalties };
    }

    const winner = homeScore > awayScore
      ? fixture.homeClub
      : awayScore > homeScore
        ? fixture.awayClub
        : (penalties?.winnerSide === 'away' ? fixture.awayClub : fixture.homeClub);

    const updateNode = (tree) => {
      ['playoffs', 'r16', 'qf', 'sf'].forEach(round => {
        if (tree[round]) {
          const match = tree[round].find(m => m.id === fixture.id);
          if (match) {
            match.scoreHome = homeScore;
            match.scoreAway = awayScore;
            match.penHome = penalties ? penalties.homePen : null;
            match.penAway = penalties ? penalties.awayPen : null;
            match.winner = winner;
          }
        }
      });
      if (tree.final && tree.final.id === fixture.id) {
        tree.final.scoreHome = homeScore;
        tree.final.scoreAway = awayScore;
        tree.final.penHome = penalties ? penalties.homePen : null;
        tree.final.penAway = penalties ? penalties.awayPen : null;
        tree.final.winner = winner;

        if (winner && winner.id === this.myClubId) {
          let trophyName = 'Tournament Trophy';
          let trophyType = 'CUP';
          if (fixture.id.includes('ucl_')) {
            trophyName = 'UEFA Champions League';
            trophyType = 'UCL';
          } else if (fixture.id.includes('uel_')) {
            trophyName = 'UEFA Europa League';
            trophyType = 'UEL';
          } else if (fixture.id.includes('cup_')) {
            trophyName = this.domesticCupTitle || 'Domestic Cup';
            trophyType = 'CUP';
          }

          this.trophyCabinet = this.trophyCabinet || [];
          if (!this.trophyCabinet.some(t => t.id === fixture.id)) {
            this.trophyCabinet.unshift({
              id: fixture.id,
              name: trophyName,
              type: trophyType,
              year: this.season,
              date: this.getFormattedDate?.() || '',
              clubName: this.myClub?.name || ''
            });
            this.playSound?.('fanfare');
            this.news.unshift({
              headline: `🏆 CHAMPIONS: ${this.myClub?.name} WIN THE ${trophyName.toUpperCase()}!`,
              date: this.getFormattedDate?.() || '',
              category: 'TROPHY WIN'
            });
          }
        }
      }
    };

    if (fixture.id.includes('cup_') && this.cupTree) updateNode(this.cupTree);
    if (fixture.id.includes('ucl_') && this.uclTree) updateNode(this.uclTree);
    if (fixture.id.includes('uel_') && this.uelTree) updateNode(this.uelTree);
  }

  checkTournamentProgression() {
    this.simCpuMatches();

    const generateNextRound = (tree, currentRound, nextRound, prefix, title) => {
      if (!tree[currentRound] || !tree[nextRound]) return;
      
      const allDone = tree[currentRound].every(m => m.winner);
      const isPlaceholder = tree[nextRound][0] && tree[nextRound][0].home && tree[nextRound][0].home.name === 'TBD';

      if (allDone && isPlaceholder) {
        let d = new Date(this.currentDate);
        d.setDate(d.getDate() + 14);
        const matches = tree[currentRound];
        for (let i = 0; i < tree[nextRound].length; i++) {
          const m1 = matches[i * 2], m2 = matches[i * 2 + 1];
          tree[nextRound][i].id = `${prefix}_gen_${i+1}`;
          tree[nextRound][i].home = m1.winner; 
          tree[nextRound][i].away = m2.winner;
          tree[nextRound][i].isUserTie = (m1.winner.id === this.myClubId || m2.winner.id === this.myClubId);
          
          this.fixtures.push({
            id: tree[nextRound][i].id,
            matchday: nextRound.toUpperCase(),
            date: new Date(d),
            competition: title,
            homeClub: m1.winner,
            awayClub: m2.winner,
            played: false,
            result: null
          });
          d.setDate(d.getDate() + 1);
        }
        this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
    };

    // 1. Domestic Cup Progression
    if (this.cupTree) {
      generateNextRound(this.cupTree, 'r16', 'qf', 'cup_qf', this.domesticCupTitle);
      generateNextRound(this.cupTree, 'qf', 'sf', 'cup_sf', this.domesticCupTitle);
      
      if (this.cupTree.sf.every(m => m.winner) && this.cupTree.final.home.name === 'TBD') {
        this.cupTree.final.id = 'cup_final_gen';
        this.cupTree.final.home = this.cupTree.sf[0].winner;
        this.cupTree.final.away = this.cupTree.sf[1].winner;
        this.cupTree.final.isUserTie = (this.cupTree.final.home.id === this.myClubId || this.cupTree.final.away.id === this.myClubId);
        
        let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
        this.fixtures.push({
          id: this.cupTree.final.id,
          matchday: 'FINAL',
          date: new Date(d),
          competition: this.domesticCupTitle,
          homeClub: this.cupTree.final.home,
          awayClub: this.cupTree.final.away,
          played: false,
          result: null
        });
        this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
    }

    // 2. UCL League Phase Completion & Playoff Generation
    const userUclDone = !this.uclFixtures || this.uclFixtures.length === 0 || this.uclFixtures.every(f => f.played);
    
    if (this.uclStandings?.length && userUclDone && (!this.uclTree || !this.uclTree.generatedKnockouts)) {
      this.uclTree = this.uclTree || { playoffs: [], qf: [], sf: [], final: null, generatedKnockouts: false };
      this.uclTree.generatedKnockouts = true;

      // Simulate rest of UCL group stage for all AI teams if needed
      this.uclStandings.forEach(s => {
        while (s.played < 8) {
          s.played++;
          const h = Math.floor(Math.random() * 3);
          const a = Math.floor(Math.random() * 2);
          s.gf += h; s.ga += a; s.gd = s.gf - s.ga;
          if (h > a) { s.won++; s.pts += 3; }
          else if (h < a) { s.lost++; }
          else { s.drawn++; s.pts += 1; }
        }
      });

      const sorted = [...this.uclStandings].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      const top8 = sorted.slice(0, 8).map(s => this.clubs.find(c => c.id === s.clubId));
      this.uclTree.top8Clubs = top8;

      // 1st & 2nd Bye to SF; 3rd & 4th Bye to QF; 5th vs 8th, 6th vs 7th in Playoffs
      this.uclTree.playoffs = [
        { id: 'ucl_po_gen_1', home: top8[4], away: top8[7], scoreHome: null, scoreAway: null, winner: null, isUserTie: top8[4].id === this.myClubId || top8[7].id === this.myClubId },
        { id: 'ucl_po_gen_2', home: top8[5], away: top8[6], scoreHome: null, scoreAway: null, winner: null, isUserTie: top8[5].id === this.myClubId || top8[6].id === this.myClubId }
      ];
      this.uclTree.qf = [
        { id: 'ucl_qf_stub_1', home: top8[2], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false },
        { id: 'ucl_qf_stub_2', home: top8[3], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false }
      ];
      this.uclTree.sf = [
        { id: 'ucl_sf_stub_1', home: top8[0], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false },
        { id: 'ucl_sf_stub_2', home: top8[1], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false }
      ];
      this.uclTree.final = { id: 'ucl_final_stub', home: { name: 'TBD' }, away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.uclTree.playoffs.forEach(match => {
        this.fixtures.push({ id: match.id, matchday: 'UCL PLAYOFFS', date: new Date(d), competition: 'UEFA Champions League', homeClub: match.home, awayClub: match.away, played: false, result: null });
        d.setDate(d.getDate() + 1);
      });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // 3. UCL Playoffs -> QF
    if (this.uclTree && this.uclTree.playoffs?.length === 2 && this.uclTree.playoffs.every(m => m.winner) && (!this.uclTree.qf[0] || this.uclTree.qf[0].away.name === 'TBD')) {
      const top8 = this.uclTree.top8Clubs || [];
      const po1Winner = this.uclTree.playoffs[0].winner; // 5th vs 8th winner
      const po2Winner = this.uclTree.playoffs[1].winner; // 6th vs 7th winner

      this.uclTree.qf[0] = { id: 'ucl_qf_gen_1', home: top8[2], away: po2Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top8[2].id === this.myClubId || po2Winner.id === this.myClubId };
      this.uclTree.qf[1] = { id: 'ucl_qf_gen_2', home: top8[3], away: po1Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top8[3].id === this.myClubId || po1Winner.id === this.myClubId };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.uclTree.qf.forEach(match => {
        this.fixtures.push({ id: match.id, matchday: 'UCL QF', date: new Date(d), competition: 'UEFA Champions League', homeClub: match.home, awayClub: match.away, played: false, result: null });
        d.setDate(d.getDate() + 1);
      });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // 4. UCL QF -> SF (1st & 2nd waiting in SF!)
    if (this.uclTree && this.uclTree.qf?.length === 2 && this.uclTree.qf.every(m => m.winner) && (!this.uclTree.sf[0] || this.uclTree.sf[0].away.name === 'TBD')) {
      const top8 = this.uclTree.top8Clubs || [];
      const qf1Winner = this.uclTree.qf[0].winner;
      const qf2Winner = this.uclTree.qf[1].winner;

      this.uclTree.sf[0] = { id: 'ucl_sf_gen_1', home: top8[0], away: qf1Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top8[0].id === this.myClubId || qf1Winner.id === this.myClubId };
      this.uclTree.sf[1] = { id: 'ucl_sf_gen_2', home: top8[1], away: qf2Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top8[1].id === this.myClubId || qf2Winner.id === this.myClubId };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.uclTree.sf.forEach(match => {
        this.fixtures.push({ id: match.id, matchday: 'UCL SF', date: new Date(d), competition: 'UEFA Champions League', homeClub: match.home, awayClub: match.away, played: false, result: null });
        d.setDate(d.getDate() + 1);
      });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // 5. UCL SF -> Final
    if (this.uclTree && this.uclTree.sf?.length === 2 && this.uclTree.sf.every(m => m.winner) && (!this.uclTree.final || this.uclTree.final.home.name === 'TBD')) {
      const sf1Winner = this.uclTree.sf[0].winner;
      const sf2Winner = this.uclTree.sf[1].winner;

      this.uclTree.final = { id: 'ucl_final_gen', home: sf1Winner, away: sf2Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: sf1Winner.id === this.myClubId || sf2Winner.id === this.myClubId };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.fixtures.push({ id: this.uclTree.final.id, matchday: 'UCL FINAL', date: new Date(d), competition: 'UEFA Champions League', homeClub: sf1Winner, awayClub: sf2Winner, played: false, result: null });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // 6. UEL League Phase Completion & Playoff/Knockout Generation (10 Teams)
    const userUelDone = !this.uelFixtures || this.uelFixtures.length === 0 || this.uelFixtures.every(f => f.played);
    
    if (this.uelStandings?.length && userUelDone && (!this.uelTree || !this.uelTree.generatedKnockouts)) {
      this.uelTree = this.uelTree || {};
      this.uelTree.generatedKnockouts = true;

      // Simulate rest of UEL group stage for all AI teams if needed
      this.uelStandings.forEach(s => {
        while (s.played < 6) {
          s.played++;
          const h = Math.floor(Math.random() * 3);
          const a = Math.floor(Math.random() * 2);
          s.gf += h; s.ga += a; s.gd = s.gf - s.ga;
          if (h > a) { s.won++; s.pts += 3; }
          else if (h < a) { s.lost++; }
          else { s.drawn++; s.pts += 1; }
        }
      });

      const sortedUel = [...this.uelStandings].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      const top7 = sortedUel.slice(0, 7).map(s => this.clubs.find(c => c.id === s.clubId));
      this.uelTree.top7Clubs = top7;

      // 1st & 2nd Bye to SF; 3rd, 4th & 5th Bye to QF; 6th vs 7th in Playoff
      this.uelTree.playoffs = [
        { id: 'uel_po_gen_1', home: top7[5], away: top7[6], scoreHome: null, scoreAway: null, winner: null, isUserTie: top7[5].id === this.myClubId || top7[6].id === this.myClubId }
      ];
      this.uelTree.qf = [
        { id: 'uel_qf_stub_1', home: top7[2], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false },
        { id: 'uel_qf_stub_2', home: top7[3], away: top7[4], scoreHome: null, scoreAway: null, winner: null, isUserTie: top7[3].id === this.myClubId || top7[4].id === this.myClubId }
      ];
      this.uelTree.sf = [
        { id: 'uel_sf_stub_1', home: top7[0], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false },
        { id: 'uel_sf_stub_2', home: top7[1], away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null, isUserTie: false }
      ];
      this.uelTree.final = { id: 'uel_final_stub', home: { name: 'TBD' }, away: { name: 'TBD' }, scoreHome: null, scoreAway: null, winner: null };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.uelTree.playoffs.forEach(match => {
        this.fixtures.push({ id: match.id, matchday: 'UEL PLAYOFFS', date: new Date(d), competition: 'UEFA Europa League', homeClub: match.home, awayClub: match.away, played: false, result: null });
        d.setDate(d.getDate() + 1);
      });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // UEL Playoffs -> QF
    if (this.uelTree && this.uelTree.playoffs?.length === 1 && this.uelTree.playoffs.every(m => m.winner) && (!this.uelTree.qf[0] || this.uelTree.qf[0].away.name === 'TBD')) {
      const top7 = this.uelTree.top7Clubs || [];
      const poWinner = this.uelTree.playoffs[0].winner;

      this.uelTree.qf[0] = { id: 'uel_qf_gen_1', home: top7[2], away: poWinner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top7[2].id === this.myClubId || poWinner.id === this.myClubId };
      this.uelTree.qf[1] = { id: 'uel_qf_gen_2', home: top7[3], away: top7[4], scoreHome: null, scoreAway: null, winner: null, isUserTie: top7[3].id === this.myClubId || top7[4].id === this.myClubId };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.uelTree.qf.forEach(match => {
        this.fixtures.push({ id: match.id, matchday: 'UEL QF', date: new Date(d), competition: 'UEFA Europa League', homeClub: match.home, awayClub: match.away, played: false, result: null });
        d.setDate(d.getDate() + 1);
      });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // UEL QF -> SF
    if (this.uelTree && this.uelTree.qf?.length === 2 && this.uelTree.qf.every(m => m.winner) && (!this.uelTree.sf[0] || this.uelTree.sf[0].away.name === 'TBD')) {
      const top7 = this.uelTree.top7Clubs || [];
      const qf1Winner = this.uelTree.qf[0].winner;
      const qf2Winner = this.uelTree.qf[1].winner;

      this.uelTree.sf[0] = { id: 'uel_sf_gen_1', home: top7[0], away: qf1Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top7[0].id === this.myClubId || qf1Winner.id === this.myClubId };
      this.uelTree.sf[1] = { id: 'uel_sf_gen_2', home: top7[1], away: qf2Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: top7[1].id === this.myClubId || qf2Winner.id === this.myClubId };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.uelTree.sf.forEach(match => {
        this.fixtures.push({ id: match.id, matchday: 'UEL SF', date: new Date(d), competition: 'UEFA Europa League', homeClub: match.home, awayClub: match.away, played: false, result: null });
        d.setDate(d.getDate() + 1);
      });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // UEL SF -> Final
    if (this.uelTree && this.uelTree.sf?.length === 2 && this.uelTree.sf.every(m => m.winner) && (!this.uelTree.final || this.uelTree.final.home.name === 'TBD')) {
      const sf1Winner = this.uelTree.sf[0].winner;
      const sf2Winner = this.uelTree.sf[1].winner;

      this.uelTree.final = { id: 'uel_final_gen', home: sf1Winner, away: sf2Winner, scoreHome: null, scoreAway: null, winner: null, isUserTie: sf1Winner.id === this.myClubId || sf2Winner.id === this.myClubId };

      let d = new Date(this.currentDate); d.setDate(d.getDate() + 14);
      this.fixtures.push({ id: this.uelTree.final.id, matchday: 'UEL FINAL', date: new Date(d), competition: 'UEFA Europa League', homeClub: sf1Winner, awayClub: sf2Winner, played: false, result: null });
      this.fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    this.simCpuMatches();
  }

  simRestOfLeagueMatchday(isEuropean = false, type = 'UCL') {
    // No-op: League and European fixtures are now fully scheduled and simulated via simCpuMatches()
    return;
  }

  toggleTransferList(playerId) {
    const p = this.players.find(x => x.id === playerId);
    if (p) {
      p.isTransferListed = !p.isTransferListed;
      if (p.isTransferListed) p.isLoanListed = false; // Mutually exclusive list
      this.playSound?.('click');
      return p.isTransferListed;
    }
    return false;
  }

  toggleLoanList(playerId) {
    const p = this.players.find(x => x.id === playerId);
    if (p) {
      p.isLoanListed = !p.isLoanListed;
      if (p.isLoanListed) p.isTransferListed = false;
      this.playSound?.('click');
      return p.isLoanListed;
    }
    return false;
  }

  getRealisticPlayerValue(player) {
    const baseVal = Number(player?.val) || 1000000;
    const ovr = Number(player?.ovr) || 70;
    const age = Number(player?.age) || 25;
    const isIcon = Boolean(player?.isSecretLegend || player?.id === 'legend_messi' || player?.id === 'legend_ronaldo');
    let ovrFloor = 0;
    if (isIcon || ovr >= 95) ovrFloor = 150000000;
    else if (ovr >= 91) ovrFloor = 115000000;
    else if (ovr >= 88) ovrFloor = 85000000;
    else if (ovr >= 85) ovrFloor = 55000000;
    else if (ovr >= 82) ovrFloor = 34000000;
    else if (ovr >= 79) ovrFloor = 20000000;
    // Slight veteran discount only for non-icons aged 33+
    if (!isIcon && age >= 33) ovrFloor = Math.round(ovrFloor * 0.65);
    return Math.max(baseVal, ovrFloor);
  }

  getMinimumBidderRating(player, effectiveVal = null) {
    const val = effectiveVal ?? this.getRealisticPlayerValue(player);
    const ovr = Number(player?.ovr) || 70;
    const isIcon = Boolean(player?.isSecretLegend || ovr >= 95);
    if (isIcon || ovr >= 90 || val >= 110000000) return 86;
    if (ovr >= 86 || val >= 65000000) return 83;
    if (ovr >= 82 || val >= 35000000) return 79;
    if (ovr >= 78 || val >= 18000000) return 76;
    return 0;
  }

  getTransferOfferCeiling(club) {
    const rating = Number(club?.rating || club?.ovr || 0);
    // Top European superclubs can finance marquee signings via installments & commercial power
    if (rating >= 89) return 260000000;
    if (rating >= 87) return 230000000;
    if (rating >= 85) return 175000000;
    if (rating >= 83) return 110000000;
    if (rating >= 80) return 65000000;
    if (rating >= 77) return 38000000;
    const budget = Number(club?.budget || 0);
    return Math.min(24000000, Math.max(8000000, Math.floor((budget || 18000000) * 0.85)));
  }

  // ── POINT #2: FINANCIAL DEPTH & TIERED SPONSORSHIPS ──────────────────────
  getCommercialTier(club = this.myClub) {
    const rating = Number(club?.rating || club?.ovr || 80);
    if (rating >= 88) return { tier: 1, label: 'Tier 1 • Global Superclub', multiplier: 1.8, color: 'var(--accent-gold)' };
    if (rating >= 83) return { tier: 2, label: 'Tier 2 • Continental Giant', multiplier: 1.35, color: 'var(--accent-cyan)' };
    if (rating >= 78) return { tier: 3, label: 'Tier 3 • Top-Flight Contender', multiplier: 1.0, color: 'var(--accent-lime)' };
    return { tier: 4, label: 'Tier 4 • Rising Challenger', multiplier: 0.7, color: '#ff9f43' };
  }

  initSponsorOffers() {
    const club = this.myClub;
    if (!club) return;
    const tier = this.getCommercialTier(club);
    const m = tier.multiplier;
    const roundM = v => Math.round((v * m) / 500000) * 500000;

    this.sponsorOffers = [
      {
        id: `sp_safe_${this.seasonIndex}`,
        name: tier.tier === 1 ? 'Emirates Global Airways' : 'Nordic Air Partners',
        category: 'Airline & Travel',
        riskLabel: 'Safe Partner',
        tierLabel: tier.label,
        upfrontFee: roundM(14000000),
        objectiveType: 'TOP_4',
        objectiveLabel: `Finish in the Top 4 of ${club.league}`,
        bonusAmount: roundM(10000000),
        matchWinBonus: 250000
      },
      {
        id: `sp_balanced_${this.seasonIndex}`,
        name: tier.tier <= 2 ? 'Apex Performance Sportswear' : 'Veloce Athletics',
        category: 'Kit & Apparel',
        riskLabel: 'Balanced Growth',
        tierLabel: tier.label,
        upfrontFee: roundM(10000000),
        objectiveType: 'TOP_2_UCL',
        objectiveLabel: `Qualify for the Champions League (Top 2 in ${club.league})`,
        bonusAmount: roundM(18000000),
        matchWinBonus: 400000
      },
      {
        id: `sp_elite_${this.seasonIndex}`,
        name: tier.tier === 1 ? 'Quantum FinTech Global' : 'Hyperion Digital Bank',
        category: 'Global Finance',
        riskLabel: 'High-Stakes Elite',
        tierLabel: tier.label,
        upfrontFee: roundM(6000000),
        objectiveType: 'WIN_LEAGUE_OR_60_GOALS',
        objectiveLabel: `Win ${club.league} Title OR score 55+ league goals`,
        bonusAmount: roundM(30000000),
        matchWinBonus: 600000
      }
    ];
  }

  signSponsor(sponsorId) {
    if (this.activeSponsor) return false;
    const offer = (this.sponsorOffers || []).find(s => s.id === sponsorId);
    if (!offer || !this.myClub) return false;

    this.activeSponsor = { ...offer, signedSeason: this.season, paidOut: false };
    this.myClub.budget += offer.upfrontFee;
    this.sponsorBonusEarned = (this.sponsorBonusEarned || 0) + offer.upfrontFee;

    this.news.unshift({
      headline: `💼 COMMERCIAL DEAL: ${this.myClub.name} sign ${offer.name} (+€${(offer.upfrontFee / 1000000).toFixed(1)}M upfront)!`,
      date: this.getFormattedDate(),
      category: 'FINANCE'
    });
    this.inbox.unshift({
      id: `sp_msg_${Date.now()}`,
      title: `Sponsor Deal Signed: ${offer.name}`,
      sender: 'Commercial Director',
      date: this.getFormattedDate(),
      body: `We have signed a seasonal partnership with ${offer.name} (${offer.tierLabel}). €${(offer.upfrontFee / 1000000).toFixed(1)}M has been added to your transfer budget. Complete "${offer.objectiveLabel}" to unlock the €${(offer.bonusAmount / 1000000).toFixed(1)}M end-of-season bonus!`
    });
    this.playSound?.('goal');
    return true;
  }

  evaluateSponsorObjective(sortedLeagueStandings = null) {
    if (!this.activeSponsor) return { met: false, bonusAmount: 0, progressText: 'No active sponsor' };
    const table = sortedLeagueStandings || [...(this.standings || [])].sort((a, b) => this.compareStandings(a, b));
    const rankIdx = table.findIndex(r => r.clubId === this.myClubId);
    const rank = rankIdx >= 0 ? rankIdx + 1 : 99;
    const myRow = rankIdx >= 0 ? table[rankIdx] : { gf: 0, played: 0 };
    const gf = Number(myRow.gf) || 0;

    let met = false;
    let progressText = '';
    if (this.activeSponsor.objectiveType === 'TOP_4') {
      met = rank <= 4;
      progressText = `Current Rank: #${rank <= 20 ? rank : '-'} (Target: Top 4)`;
    } else if (this.activeSponsor.objectiveType === 'TOP_2_UCL') {
      met = rank <= 2;
      progressText = `Current Rank: #${rank <= 20 ? rank : '-'} (Target: Top 2 UCL)`;
    } else {
      met = rank === 1 || gf >= 55;
      progressText = `Rank #${rank <= 20 ? rank : '-'} · ${gf}/55 league goals`;
    }

    return {
      met,
      bonusAmount: met ? this.activeSponsor.bonusAmount : 0,
      progressText
    };
  }

  // ── POINT #4: TRANSFER WINDOW, DEADLINE DAY CHAOS & MULTI-OFFER ENGINE ──
  getTransferWindowStatus() {
    const month = this.currentDate.getMonth(); // 0=Jan, 6=Jul, 7=Aug
    const day = this.currentDate.getDate();

    if (month === 6 || month === 7) {
      const endOfSummer = new Date(this.currentDate.getFullYear(), 7, 31);
      const daysLeft = Math.max(0, Math.ceil((endOfSummer - this.currentDate) / 86400000));
      return {
        isOpen: true,
        windowName: 'Summer Transfer Window',
        daysLeft,
        isDeadlineDay: month === 7 && day >= 29
      };
    }
    if (month === 0) {
      const endOfWinter = new Date(this.currentDate.getFullYear(), 0, 31);
      const daysLeft = Math.max(0, Math.ceil((endOfWinter - this.currentDate) / 86400000));
      return {
        isOpen: true,
        windowName: 'Winter Transfer Window',
        daysLeft,
        isDeadlineDay: day >= 29
      };
    }
    return {
      isOpen: false,
      windowName: 'Transfer Window Closed',
      daysLeft: 0,
      isDeadlineDay: false
    };
  }

  getPlayerPerformanceScore(player) {
    const goals = Number(player.goals) || 0;
    const apps = Number(player.apps) || 0;
    const lastGoals = Number(player.lastSeasonGoals) || 0;
    const lastApps = Number(player.lastSeasonApps) || 0;
    const form = Number(player.formModifier) || 0;
    const gpg = apps > 0 ? goals / apps : 0;

    let score = 10;
    score += goals * 4.5;
    score += lastGoals * 2.0;
    score += gpg >= 0.5 && apps >= 3 ? 22 : 0;
    score += Math.max(0, form) * 6;
    score += (Number(player.ovr) || 70) >= 85 ? 14 : (Number(player.ovr) || 70) >= 80 ? 8 : 2;
    score += (player.age <= 22 && (player.pot || 0) >= 84) ? 14 : 0;
    score += (player.isTransferListed || player.isLoanListed) ? 28 : 0;

    const isHotForm = goals >= 5 || (gpg >= 0.55 && apps >= 4) || lastGoals >= 12 || form >= 2;
    let reason = '';
    if (goals >= 5) reason = `🔥 Hot Form: ${goals}G in ${apps} apps`;
    else if (lastGoals >= 10) reason = `📈 Last Season: ${lastGoals}G in ${lastApps} apps`;
    else if (player.isTransferListed) reason = '🏷️ Transfer Listed';
    else if (player.isLoanListed) reason = '🔄 Loan Listed';
    else if (player.age <= 22 && (player.pot || 0) >= 84) reason = `⭐ Wonderkid (${player.pot} POT)`;

    return { score, isHotForm, reason };
  }

  generateIncomingOffer(options = {}) {
    const myPlayers = this.players.filter(p => p.clubId === this.myClubId && !p.isLoaned);
    if (!myPlayers.length) return 0;

    const winStatus = this.getTransferWindowStatus();
    const isDeadlineDay = Boolean(options.forceDeadlineDay || winStatus.isDeadlineDay);

    // Allow up to 3 concurrent pending offers per player from DIFFERENT clubs
    const eligiblePlayers = myPlayers.filter(p => {
      const activeForPlayer = this.incomingOffers.filter(o => o.playerId === p.id && o.status === 'PENDING');
      return activeForPlayer.length < 3;
    });
    if (!eligiblePlayers.length) return 0;

    // Performance-weighted selection (hot form, current goals, lastSeasonGoals, listed players)
    const weightedPool = eligiblePlayers.map(p => ({
      player: p,
      perf: this.getPlayerPerformanceScore(p)
    }));
    const totalWeight = weightedPool.reduce((sum, item) => sum + item.perf.score, 0);
    let roll = Math.random() * totalWeight;
    let picked = weightedPool[0];
    for (const item of weightedPool) {
      roll -= item.perf.score;
      if (roll <= 0) {
        picked = item;
        break;
      }
    }

    const player = picked.player;
    const perf = picked.perf;
    const existingPending = this.incomingOffers.filter(o => o.playerId === player.id && o.status === 'PENDING');
    const existingBidderIds = new Set(existingPending.map(o => o.biddingClubId));

    const playerValue = this.getRealisticPlayerValue(player);
    // Keep player.val synced if an elite player had an undervalued figure
    if (playerValue > (Number(player.val) || 0)) player.val = playerValue;
    const minimumBidderRating = this.getMinimumBidderRating(player, playerValue);

    // STRICT financial + prestige filter: weak clubs can NEVER bid on elite superstars / Icons
    const qualifiedBidders = this.clubs.filter(c =>
      c.id !== this.myClubId &&
      !existingBidderIds.has(c.id) &&
      Number(c.rating || c.ovr || 0) >= minimumBidderRating &&
      this.getTransferOfferCeiling(c) >= Math.round(playerValue * 0.95)
    );
    const biddingPool = qualifiedBidders.sort(() => Math.random() - 0.5);
    if (!biddingPool.length) return 0;

    // Decide how many concurrent competing offers arrive right now (1 to 3 based on performance & Deadline Day)
    const maxNewOffers = Math.min(3 - existingPending.length, biddingPool.length);
    let offerCount = 1;
    if (maxNewOffers >= 2 && (options.forceBiddingWar || perf.isHotForm || isDeadlineDay || player.isTransferListed)) {
      const warChance = options.forceBiddingWar ? 1.0 : (isDeadlineDay ? 0.72 : (perf.isHotForm ? 0.58 : 0.30));
      if (Math.random() < warChance) {
        offerCount = Math.min(maxNewOffers, (perf.isHotForm && isDeadlineDay) || Math.random() < 0.35 ? 3 : 2);
      }
    }

    // Determine offer type: LOAN vs TRANSFER
    let baseOfferType = 'TRANSFER';
    if (player.isLoanListed || (!perf.isHotForm && player.age <= 21 && player.ovr < 77) || (player.ovr < 74 && Math.random() < 0.55)) {
      baseOfferType = Math.random() < 0.45 ? 'LOAN_OPTION' : 'LOAN';
    }

    const createdOffers = [];
    const highestExistingBid = existingPending.reduce((max, o) => Math.max(max, Number(o.bidAmount) || 0), 0);
    let runningHighBid = highestExistingBid;

    for (let i = 0; i < offerCount; i++) {
      const biddingClub = biddingPool[i];
      if (!biddingClub) break;

      const ceiling = this.getTransferOfferCeiling(biddingClub);
      const isBiddingWar = (existingPending.length + offerCount) >= 2;
      const isReleaseClause = Boolean(
        baseOfferType === 'TRANSFER' &&
        isDeadlineDay &&
        i === 0 &&
        Number(player.ovr) >= 83 &&
        ceiling >= Math.round(playerValue * 1.35) &&
        Math.random() < 0.28
      );

      if (baseOfferType === 'TRANSFER') {
        const baseMult = player.isTransferListed ? (1.02 + Math.random() * 0.22) : (1.15 + Math.random() * 0.25);
        const formBoost = perf.isHotForm ? (0.08 + Math.random() * 0.12) : 0;
        const deadlineBoost = isDeadlineDay ? (0.12 + Math.random() * 0.12) : 0;
        const warEscalation = i * (0.04 + Math.random() * 0.05);
        const totalMult = isReleaseClause ? 1.40 : (baseMult + formBoost + deadlineBoost + warEscalation);

        const isIcon = Boolean(player.isSecretLegend || (Number(player.ovr) || 0) >= 95);
        const iconBoost = isIcon ? (0.08 + Math.random() * 0.14) : 0;
        let rawBid = Math.round((playerValue * (totalMult + iconBoost)) / 100000) * 100000;
        if (runningHighBid > 0 && rawBid <= runningHighBid && ceiling > runningHighBid) {
          rawBid = Math.min(ceiling, Math.round((runningHighBid * (1.04 + Math.random() * 0.06)) / 100000) * 100000);
        }
        const minRespectfulBid = Math.round((playerValue * (isIcon ? 1.05 : 0.95)) / 100000) * 100000;
        const bidAmount = Math.max(minRespectfulBid, Math.min(ceiling, 260000000, rawBid));
        runningHighBid = Math.max(runningHighBid, bidAmount);

        const offer = {
          id: `offer_${Date.now()}_${i}_${Math.floor(Math.random() * 10000)}`,
          type: 'TRANSFER',
          playerId: player.id,
          playerName: player.name,
          playerPos: player.pos,
          playerOvr: player.ovr,
          playerAge: player.age,
          playerVal: player.val,
          biddingClubId: biddingClub.id,
          biddingClubName: biddingClub.name,
          bidAmount,
          date: this.getFormattedDate(),
          status: 'PENDING',
          performanceTag: perf.reason,
          isHotForm: perf.isHotForm,
          isBiddingWar,
          isDeadlineDay,
          isReleaseClause
        };

        this.incomingOffers.unshift(offer);
        createdOffers.push(offer);

        const prefix = isReleaseClause
          ? '🚨 RELEASE CLAUSE ACTIVATED'
          : isDeadlineDay
            ? '⚡ DEADLINE DAY PANIC BID'
            : isBiddingWar
              ? '🔥 BIDDING WAR'
              : 'TRANSFER BID';

        this.news.unshift({
          headline: `${prefix}: ${biddingClub.name} submit €${(bidAmount / 1000000).toFixed(1)}M for ${player.name}${perf.isHotForm ? ' (Hot Form!)' : ''}!`,
          date: this.getFormattedDate(),
          category: isDeadlineDay ? 'DEADLINE DAY' : 'TRANSFERS'
        });

        this.inbox.unshift({
          id: `msg_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`,
          offerId: offer.id,
          type: 'OFFER_TRANSFER',
          title: `${isReleaseClause ? '🚨 Release Clause: ' : isBiddingWar ? '🔥 Bidding War: ' : 'Transfer Offer: '}${player.name} (${biddingClub.name})`,
          sender: biddingClub.name + ' Representative',
          date: this.getFormattedDate(),
          body: `${biddingClub.name} have submitted a €${(bidAmount / 1000000).toFixed(1)}M offer for ${player.name} (${player.pos} - ${player.ovr} OVR).${perf.reason ? ` Driven by ${perf.reason}.` : ''}${isReleaseClause ? ' They have triggered his sudden release clause!' : isDeadlineDay ? ' Submitted as a Deadline Day panic bid!' : ''}`
        });
      } else {
        const wageSplit = [60, 70, 80, 100][Math.floor(Math.random() * 4)];
        const buyOptionFee = Math.min(ceiling, 250000000, Math.round((playerValue * (1.10 + Math.random() * 0.25)) / 100000) * 100000);

        const offer = {
          id: `offer_${Date.now()}_${i}_${Math.floor(Math.random() * 10000)}`,
          type: baseOfferType,
          playerId: player.id,
          playerName: player.name,
          playerPos: player.pos,
          playerOvr: player.ovr,
          playerAge: player.age,
          playerVal: player.val,
          biddingClubId: biddingClub.id,
          biddingClubName: biddingClub.name,
          wageSplit,
          buyOptionFee: baseOfferType === 'LOAN_OPTION' ? buyOptionFee : 0,
          date: this.getFormattedDate(),
          status: 'PENDING',
          performanceTag: perf.reason,
          isHotForm: perf.isHotForm,
          isBiddingWar,
          isDeadlineDay,
          isReleaseClause: false
        };

        this.incomingOffers.unshift(offer);
        createdOffers.push(offer);

        const desc = baseOfferType === 'LOAN_OPTION'
          ? `1-Season Loan with €${(buyOptionFee / 1000000).toFixed(1)}M Option to Buy (${wageSplit}% wage covered)`
          : `1-Season Loan (${wageSplit}% wage covered)`;

        this.news.unshift({
          headline: `LOAN PROPOSAL: ${biddingClub.name} want ${player.name} on loan!`,
          date: this.getFormattedDate(),
          category: isDeadlineDay ? 'DEADLINE DAY' : 'TRANSFERS'
        });

        this.inbox.unshift({
          id: `msg_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`,
          offerId: offer.id,
          type: 'OFFER_LOAN',
          title: `Loan Proposal for ${player.name} (${biddingClub.name})`,
          sender: biddingClub.name + ' Manager',
          date: this.getFormattedDate(),
          body: `${biddingClub.name} have submitted a 1-season loan proposal for ${player.name} (${player.pos} - ${player.ovr} OVR). Terms: ${desc}.`
        });
      }
    }

    // Mark all existing pending offers for this player as part of a bidding war if 2+ clubs are now bidding
    const allPendingForPlayer = this.incomingOffers.filter(o => o.playerId === player.id && o.status === 'PENDING');
    if (allPendingForPlayer.length >= 2) {
      allPendingForPlayer.forEach(o => { o.isBiddingWar = true; });
    }

    this.playSound?.('click');
    return createdOffers.length;
  }

  triggerDeadlineDayFrenzy() {
    let totalGenerated = 0;
    totalGenerated += this.generateIncomingOffer({ forceDeadlineDay: true, forceBiddingWar: true });
    totalGenerated += this.generateIncomingOffer({ forceDeadlineDay: true, forceBiddingWar: false });
    this.simulateCpuTransfer();
    this.news.unshift({
      headline: `🚨 DEADLINE DAY FRENZY: Rival clubs are launching panic bids and bidding wars across Europe!`,
      date: this.getFormattedDate(),
      category: 'DEADLINE DAY'
    });
    return totalGenerated;
  }

  acceptIncomingOffer(offerId) {
    const offer = this.incomingOffers.find(o => o.id === offerId);
    if (!offer || offer.status !== 'PENDING') return false;

    const player = this.players.find(p => p.id === offer.playerId);
    if (!player || player.clubId !== this.myClubId || player.isLoaned) {
      // Player already left or loaned out — invalidate stale offer
      offer.status = 'WITHDRAWN';
      return false;
    }

    if (offer.type === 'TRANSFER') {
      offer.status = 'ACCEPTED';
      this.myClub.budget += offer.bidAmount;
      const buyer = this.clubs.find(club => club.id === offer.biddingClubId);
      if (buyer) buyer.budget = Math.max(0, (Number(buyer.budget) || 0) - offer.bidAmount);

      this.starters = this.starters.filter(p => p.id !== player.id);
      this.bench = this.bench.filter(p => p.id !== player.id);
      player.clubId = offer.biddingClubId;

      this.news.unshift({
        headline: `🔴 SOLD: ${player.name} transferred to ${offer.biddingClubName} for €${(offer.bidAmount / 1000000).toFixed(1)}M!`,
        date: this.getFormattedDate(),
        category: 'DONE DEAL'
      });
    } else {
      offer.status = 'ACCEPTED';
      player.isLoaned = true;
      player.loanClub = offer.biddingClubName;
      player.loanType = offer.type;
      player.loanBuyFee = offer.buyOptionFee;

      this.starters = this.starters.filter(p => p.id !== player.id);
      this.bench = this.bench.filter(p => p.id !== player.id);

      this.news.unshift({
        headline: `🔄 LOAN AGREED: ${player.name} joins ${offer.biddingClubName} on loan for 1 season!`,
        date: this.getFormattedDate(),
        category: 'DONE DEAL'
      });
    }

    // Clear / withdraw ALL competing pending offers for the same player so they can never be sold twice
    const competingOffers = this.incomingOffers.filter(
      o => o.playerId === offer.playerId && o.id !== offer.id && o.status === 'PENDING'
    );
    competingOffers.forEach(comp => {
      comp.status = 'WITHDRAWN';
    });
    if (competingOffers.length > 0) {
      this.news.unshift({
        headline: `🔥 BIDDING WAR OVER: ${offer.biddingClubName} beat ${competingOffers.length} rival club${competingOffers.length > 1 ? 's' : ''} to sign ${player.name}!`,
        date: this.getFormattedDate(),
        category: 'TRANSFERS'
      });
    }

    this.playSound?.('goal');
    return true;
  }

  // ── POINT #5: END-OF-SEASON AWARDS (BALLON D'OR, GOLDEN BOOT, MANAGER) ──
  getBallonDorRankings(limit = 5) {
    const sortedLeague = [...(this.standings || [])].sort((a, b) => this.compareStandings(a, b));
    const leagueLeaderId = sortedLeague[0]?.clubId || null;
    const uclWinnerId = this.uclTree?.final?.winner?.id || null;
    const uelWinnerId = this.uelTree?.final?.winner?.id || null;

    // Estimate season progress (0.15 early season -> 1.0 at 38 games)
    const userStandingsRow = sortedLeague.find(r => r.clubId === this.myClubId);
    const playedMatches = Math.max(Number(userStandingsRow?.played) || 0, 1);
    const seasonProgress = Math.min(1, Math.max(0.18, playedMatches / 38));

    // Deterministic season hash so AI rivals across Europe have consistent, evolving stats
    const seedStr = `${this.season || '2025/26'}`;
    const hashUnit = (key) => {
      let h = 2166136261;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) % 1000) / 1000;
    };

    const clubMap = new Map(this.clubs.map(c => [c.id, c]));
    const myLeague = this.myClub?.league || '';

    const scoredCandidates = this.players
      .filter(p => (!p.isSecretLegend || p.clubId === this.myClubId) && (Number(p.ovr) || 0) >= 83 && p.clubId && clubMap.has(p.clubId))
      .map(player => {
        const club = clubMap.get(player.clubId);
        const ovr = Number(player.ovr) || 75;
        const pos = player.pos || 'CM';
        const isAttacker = ['ST', 'CF', 'LW', 'RW'].includes(pos);
        const isMid = ['CAM', 'CM', 'CDM', 'LM', 'RM'].includes(pos);
        const isDefOrGk = ['CB', 'LB', 'RB', 'LWB', 'RWB', 'GK'].includes(pos);
        const isUserClub = player.clubId === this.myClubId;
        const isSameLeague = club.league === myLeague;

        const r1 = hashUnit(`${seedStr}_${player.id}_g`);
        const r2 = hashUnit(`${seedStr}_${player.id}_a`);
        const r3 = hashUnit(`${seedStr}_${player.id}_f`);

        let goals = Number(player.goals) || 0;
        let apps = Number(player.apps) || 0;
        let assists = 0;

        if (!isUserClub) {
          // Top European rivals play across domestic + UCL/cups even when in other leagues
          const expectedApps = Math.max(apps, Math.round((28 + r3 * 12) * seasonProgress));
          apps = expectedApps;
          const ovrFactor = Math.max(0, ovr - 82);
          if (!isSameLeague || goals === 0) {
            const fullSeasonGoals = isAttacker
              ? Math.round(14 + ovrFactor * 2.1 + r1 * 13)
              : isMid
                ? Math.round(6 + ovrFactor * 1.1 + r1 * 8)
                : Math.round(1 + r1 * 4);
            goals = Math.max(goals, Math.round(fullSeasonGoals * seasonProgress));
          }
          const fullSeasonAssists = isMid
            ? Math.round(9 + ovrFactor * 1.1 + r2 * 9)
            : isAttacker
              ? Math.round(6 + ovrFactor * 0.8 + r2 * 8)
              : Math.round(2 + r2 * 5);
          assists = Math.round(fullSeasonAssists * seasonProgress);
        } else {
          // Estimate assists proportionally for user players
          const baseAst = isMid ? Math.round(apps * (0.24 + r2 * 0.16)) : isAttacker ? Math.round(goals * (0.28 + r2 * 0.18)) : Math.round(apps * (0.06 + r2 * 0.08));
          assists = Math.max(0, baseAst);
        }

        const clubRating = Number(club.rating || club.ovr || 80);
        const wonLeague = player.clubId === leagueLeaderId || (!isSameLeague && clubRating >= 88 && r3 > 0.65);
        const wonUcl = player.clubId === uclWinnerId;
        const uclRunnerUpId = this.uclTree?.final?.home?.id === uclWinnerId
          ? this.uclTree?.final?.away?.id
          : (this.uclTree?.final?.away?.id === uclWinnerId ? this.uclTree?.final?.home?.id : null);
        const isUclFinalist = Boolean(uclRunnerUpId && player.clubId === uclRunnerUpId);
        const wonUel = player.clubId === uelWinnerId;

        // Logical Ballon d'Or scoring: real G+A output + UCL/League trophies lead; OVR & form break ties
        const goalWeight = isAttacker ? 1.85 : isMid ? 2.05 : 2.25;
        const assistWeight = isMid ? 1.65 : 1.45;
        const defCleanBonus = isDefOrGk ? (ovr >= 88 ? 14 : 7) * seasonProgress : 0;
        // UCL winner's top performers get a major trophy boost so a great UCL campaign can win Ballon d'Or
        const uclPerfMultiplier = (wonUcl && (goals + assists >= 8 || isDefOrGk && ovr >= 86)) ? 1.0 : 0.65;
        const teamSuccessBonus = (wonUcl ? Math.round(24 * uclPerfMultiplier) : 0)
          + (isUclFinalist ? 9 : 0)
          + (wonLeague ? 8 : 0)
          + (wonUel ? 5 : 0);
        const formBoost = (Number(player.formModifier) || 0) * 1.2;

        const rawScore = ovr * 0.65 + goals * goalWeight + assists * assistWeight + defCleanBonus + teamSuccessBonus + formBoost;
        const score = Math.round(rawScore * 10) / 10;
        const avgRating = Number(Math.min(9.6, Math.max(6.8, 6.85 + (ovr - 80) * 0.065 + (goals + assists) / Math.max(apps, 6) * 0.6 + (wonUcl ? 0.35 : 0))).toFixed(2));

        return { player, club, score, goals, assists, apps, avgRating };
      })
      .sort((a, b) => b.score - a.score || (b.goals + b.assists) - (a.goals + a.assists) || b.goals - a.goals || b.player.ovr - a.player.ovr);

    // Enforce authentic Ballon d'Or club diversity: max 2 players from any single club in Top 5
    // (and a 2nd player from the same club must be genuinely elite 88+ OVR)
    const selected = [];
    const clubCounts = {};
    for (const item of scoredCandidates) {
      const cid = item.club.id;
      const count = clubCounts[cid] || 0;
      if (count >= 2) continue;
      if (count === 1 && (Number(item.player.ovr) || 0) < 88) continue;
      selected.push(item);
      clubCounts[cid] = count + 1;
      if (selected.length >= limit) break;
    }

    // Compute realistic France Football jury Vote Share %
    if (selected.length) {
      const minS = selected[selected.length - 1].score - 12;
      const weights = selected.map((item, idx) => Math.pow(Math.max(2, item.score - minS), 1.45) * (idx === 0 ? 1.15 : 1));
      const totalW = weights.reduce((s, w) => s + w, 0) || 1;
      selected.forEach((item, idx) => {
        item.voteShare = Number(((weights[idx] / totalW) * 100).toFixed(1));
      });
    }

    return selected;
  }

  computeSeasonAwards(sortedLeagueStandings = null) {
    const table = sortedLeagueStandings || [...(this.standings || [])].sort((a, b) => this.compareStandings(a, b));
    const champRow = table[0];
    const champClub = this.clubs.find(c => c.id === champRow?.clubId);
    const userRank = table.findIndex(r => r.clubId === this.myClubId) + 1;
    const uclWinner = this.uclTree?.final?.winner || null;

    const ballonDorTop = this.getBallonDorRankings(1)[0] || null;
    const goldenBootPlayer = [...this.players]
      .sort((a, b) => (b.goals || 0) - (a.goals || 0) || (b.ovr || 0) - (a.ovr || 0))[0] || null;
    const goldenBootClub = goldenBootPlayer
      ? (this.clubs.find(c => c.id === goldenBootPlayer.clubId) || { name: 'Free Agent' })
      : { name: 'Unknown' };

    const userWonLeague = champClub?.id === this.myClubId;
    const userWonUcl = uclWinner?.id === this.myClubId;
    const userOverperformed = userRank > 0 && userRank <= 2 && (Number(this.myClub?.rating) || 85) <= 84;
    const userWinsManagerAward = userWonLeague || userWonUcl || userOverperformed;

    const managerWinner = userWinsManagerAward
      ? { name: this.managerName || 'You', clubName: this.myClub?.name || 'Your Club', isUser: true }
      : { name: `${champClub?.name || 'League Champion'} Head Coach`, clubName: champClub?.name || 'Champion', isUser: false };

    return {
      season: this.season,
      ballonDor: ballonDorTop ? {
        playerName: ballonDorTop.player.name,
        clubName: ballonDorTop.club.name,
        ovr: ballonDorTop.player.ovr,
        goals: ballonDorTop.goals,
        isUserClub: ballonDorTop.player.clubId === this.myClubId
      } : null,
      goldenBoot: goldenBootPlayer ? {
        playerName: goldenBootPlayer.name,
        clubName: goldenBootClub.name,
        goals: goldenBootPlayer.goals || 0,
        apps: goldenBootPlayer.apps || 0,
        isUserClub: goldenBootPlayer.clubId === this.myClubId
      } : null,
      managerOfTheYear: managerWinner
    };
  }

  rejectIncomingOffer(offerId) {
    const offer = this.incomingOffers.find(o => o.id === offerId);
    if (!offer) return false;

    offer.status = 'REJECTED';
    this.news.unshift({
      headline: `REJECTED: Offer from ${offer.biddingClubName} for ${offer.playerName} rejected.`,
      date: this.getFormattedDate(),
      category: 'TRANSFERS'
    });
    this.playSound?.('click');
    return true;
  }

  simulateCpuTransfer() {
    const teams = this.clubs.filter(club => club.id !== this.myClubId);
    const squadSize = clubId => this.players.filter(player => player.clubId === clubId).length;
    const target = teams.filter(club => squadSize(club.id) < 30).sort((a, b) => squadSize(a.id) - squadSize(b.id))[0];
    if (!target) return;

    const donor = teams.filter(club => club.id !== target.id && squadSize(club.id) > 18)
      .sort((a, b) => squadSize(b.id) - squadSize(a.id))[0];
    if (!donor) return;

    const targetSquad = this.players.filter(player => player.clubId === target.id);
    const roleCounts = ['GK', 'CB', 'CM', 'ST'].map(pos => ({ pos, count: targetSquad.filter(player => player.pos === pos).length }));
    const neededRole = roleCounts.sort((a, b) => a.count - b.count)[0].pos;
    const signing = this.players.filter(player => player.clubId === donor.id && player.pos === neededRole &&
      this.players.filter(teammate => teammate.clubId === donor.id && teammate.pos === neededRole).length > 1)
      .sort((a, b) => b.ovr - a.ovr)[0];
    if (!signing) return;

    signing.clubId = target.id;
    const fee = Math.min(50000000, signing.val || 5000000);
    target.budget = Math.max(0, (target.budget || 0) - fee);
    donor.budget = (donor.budget || 0) + fee;
    this.news.unshift({ headline: `TRANSFER: ${target.name} sign ${signing.name} from ${donor.name} for €${(fee / 1000000).toFixed(1)}M.`, date: this.getFormattedDate(), category: 'TRANSFERS' });
  }

  advanceDay() {
    this.currentDate.setDate(this.currentDate.getDate() + 1);
    this.progressInjuries(1);
    if (this.currentDate.getDay() === 1) {
      this.players.forEach(player => {
        const form = Number(player.formModifier) || 0;
        if (form !== 0) player.formModifier = form - Math.sign(form);
      });
    }
    this.playSound('tick');
    this.checkTournamentProgression();
    if (this.currentDate.getDate() === 1) this.simulateCpuTransfer();
    
    // Dynamic transfer offer frequency: spikes heavily during Deadline Day!
    const winStatus = this.getTransferWindowStatus();
    const offerChance = winStatus.isDeadlineDay ? 0.55 : (winStatus.isOpen ? 0.14 : 0.04);
    if (Math.random() < offerChance) {
      this.generateIncomingOffer({ forceDeadlineDay: winStatus.isDeadlineDay });
    }
    if (winStatus.isDeadlineDay && Math.random() < 0.45) {
      this.simulateCpuTransfer();
    }


    if (Math.random() > 0.7) {
      const randomHeadlines = [
        'Scouting reports indicate rising wonderkids in South American academies.',
        'Champions League night approaching fast — tactical briefings underway.',
        'Manager rating praised by press ahead of European showdown.',
        'Transfer deadline day approaching fast!'
      ];
      const randomText = randomHeadlines[Math.floor(Math.random() * randomHeadlines.length)];
      this.news.unshift({
        headline: randomText,
        date: this.getFormattedDate(),
        category: 'UPDATE'
      });
      if (this.news.length > 8) this.news.pop();
    }
  }

  startNextSeason() {
    // Prevent accidental double-trigger rollover on an empty freshly-reset season
    if (this._isAdvancingSeason) return false;
    if (this.standings?.length > 0 && this.standings.every(s => (Number(s.played) || 0) === 0)) {
      return false;
    }
    this._isAdvancingSeason = true;

    try {
      this.trophyCabinet = this.trophyCabinet || [];
      this.awardsHistory = this.awardsHistory || [];

      // Snapshot the final standings BEFORE we reset anything
      const previousSeasonStandings = this.standings.map(row => ({ ...row }));
      const sortedLeagueStandings = [...previousSeasonStandings].sort((a, b) => this.compareStandings(a, b));

      const userRankIdx = sortedLeagueStandings.findIndex(s => s.clubId === this.myClubId);
      const previousFinish = Number(this.seasonHistory?.[0]?.userFinish);
      const userFinishPos = userRankIdx !== -1
        ? userRankIdx + 1
        : Number.isFinite(previousFinish) && previousFinish > 0
          ? previousFinish
          : Math.max(1, sortedLeagueStandings.length);
      const champClub = this.clubs.find(c => c.id === sortedLeagueStandings[0]?.clubId);

      if (champClub && champClub.id === this.myClubId) {
        this.trophyCabinet.unshift({
          id: `lg_${this.season}_${this.myClubId}`,
          name: this.myClub.league + ' Title',
          type: 'LEAGUE',
          year: this.season,
          clubName: this.myClub.name
        });
      }

      // Point #5: Compute & record End-of-Season Awards BEFORE resetting player goals
      const seasonAwards = this.computeSeasonAwards(sortedLeagueStandings);
      this.awardsHistory.unshift(seasonAwards);
      if (seasonAwards.ballonDor?.isUserClub) {
        this.trophyCabinet.unshift({
          id: `award_bdor_${this.season}`,
          name: `Ballon d'Or (${seasonAwards.ballonDor.playerName})`,
          type: 'AWARD',
          year: this.season,
          clubName: this.myClub.name
        });
      }
      if (seasonAwards.goldenBoot?.isUserClub && (seasonAwards.goldenBoot.goals || 0) > 0) {
        this.trophyCabinet.unshift({
          id: `award_gboot_${this.season}`,
          name: `Golden Boot (${seasonAwards.goldenBoot.playerName})`,
          type: 'AWARD',
          year: this.season,
          clubName: this.myClub.name
        });
      }
      if (seasonAwards.managerOfTheYear?.isUser) {
        this.trophyCabinet.unshift({
          id: `award_moty_${this.season}`,
          name: 'Manager of the Year',
          type: 'AWARD',
          year: this.season,
          clubName: this.myClub.name
        });
        this.managerRating = Math.min(99, (this.managerRating || 85) + 3);
      }

      // Point #2: Evaluate & pay out active sponsorship objective bonus
      const sponsorEval = this.evaluateSponsorObjective(sortedLeagueStandings);
      const sponsorBonus = sponsorEval.met ? sponsorEval.bonusAmount : 0;
      if (sponsorBonus > 0) {
        this.myClub.budget += sponsorBonus;
        this.sponsorBonusEarned = (this.sponsorBonusEarned || 0) + sponsorBonus;
      }

      // Board prize money
      const prizeMoney = userFinishPos === 1 ? 40000000 : (userFinishPos <= 4 ? 25000000 : 15000000);
      this.myClub.budget += prizeMoney;

      // Save season to history
      this.seasonHistory.unshift({
        season: this.season,
        champion: champClub ? champClub.name : 'Unknown',
        userFinish: userFinishPos,
        budgetBonus: prizeMoney + sponsorBonus,
        sponsorBonus,
        awards: seasonAwards
      });

      // Advance the season index & labels
      this.seasonIndex++;
      const startYear = 2026 + this.seasonIndex;
      const endYearShort = String(startYear + 1).slice(-2);
      this.season = `${startYear}/${endYearShort}`;
      this.currentDate = new Date(startYear, 6, 1); // 01 July of new season

      // Archive lastSeasonGoals/Apps BEFORE resetting for performance-weighted transfer offers
      this.players.forEach(p => {
        p.lastSeasonGoals = Number(p.goals) || 0;
        p.lastSeasonApps = Number(p.apps) || 0;
        p.goals = 0;
        p.apps = 0;
        p.yellowCards = 0;
        p.redCards = 0;
      });

    // Player Development: ageing, growth & fitness-based end-of-season retirements
    const retiredNotices = [];
    const retiringIds = new Set();
    this.players.forEach(p => {
      p.age += 1;
      if (p.age <= 23 && p.ovr < p.pot) {
        const growth = Math.floor(Math.random() * 3) + 1; // +1 to +3 OVR
        p.ovr = Math.min(p.pot, p.ovr + growth);
        p.val = Math.round(p.val * 1.15);
      } else if (p.age >= 34) {
        // Fit/elite veterans decline slower
        const stamina = Number(p.stamina ?? 80);
        const decline = (stamina >= 80 && p.ovr >= 85 && p.age <= 38) ? 0 : 1;
        if (decline > 0) {
          p.ovr = Math.max(64, p.ovr - decline);
          p.val = Math.round(p.val * 0.85);
        }
      }

      // Fitness-aware retirement check (never retire fit 35yo stars like CR7)
      if (p.age >= 35 && !p.isSecretLegend) {
        const stamina = Number(p.stamina ?? 78);
        const ovr = Number(p.ovr ?? 75);
        const hasInjury = Boolean(p.injury);
        const isHighFitnessStar = (ovr >= 84 && stamina >= 75 && !hasInjury && p.age <= 39);
        if (!isHighFitnessStar) {
          let retireChance = 0;
          if (p.age >= 41) retireChance = 0.85;
          else if (p.age >= 39) retireChance = (stamina < 72 || ovr < 78) ? 0.65 : 0.30;
          else if (p.age >= 37) retireChance = (hasInjury || stamina < 68) ? 0.45 : (ovr < 77 ? 0.28 : 0.10);
          else if (p.age >= 35) retireChance = (hasInjury && stamina < 65) ? 0.25 : (ovr < 73 && stamina < 65 ? 0.18 : 0);

          if (retireChance > 0 && Math.random() < retireChance) {
            retiringIds.add(p.id);
            const reason = (hasInjury || stamina < 68)
              ? 'due to recurring fitness and physical recovery issues'
              : (ovr >= 81 ? 'to step away at a high level after a memorable career' : 'due to age-related decline and to pursue coaching');
            const clubObj = this.clubs.find(c => c.id === p.clubId);
            if (p.clubId === this.myClubId || ovr >= 82) {
              retiredNotices.push(`${p.name} (Age ${p.age}, ${clubObj?.name || 'Free Agent'}) retired ${reason}.`);
            }
          }
        }
      }
    });

    if (retiringIds.size > 0) {
      this.players = this.players.filter(p => !retiringIds.has(p.id));
      this.starters = (this.starters || []).filter(s => !retiringIds.has(s.id));
      this.bench = (this.bench || []).filter(b => !retiringIds.has(b.id));
      this.incomingOffers = (this.incomingOffers || []).filter(o => !retiringIds.has(o.playerId));
      if (retiredNotices.length > 0) {
        this.news.unshift({
          headline: `RETIREMENTS: ${retiredNotices[0]}`,
          date: this.getFormattedDate(),
          category: 'SQUAD'
        });
      }
    }

    // Return loaned out players or decrement multi-season loans
    this.players.forEach(p => {
      if (p.isLoaned || p.isLoanedIn) {
        p.loanSeasonsLeft = (p.loanSeasonsLeft || 1) - 1;
        if (p.loanSeasonsLeft <= 0) {
          if (p.isLoanedIn) {
            p.isLoanedIn = false;
            p.clubId = p.loanParentClub || p.clubId;
            this.starters = this.starters.filter(s => s.id !== p.id);
            this.bench = this.bench.filter(s => s.id !== p.id);
          }
          if (p.isLoaned) {
            p.isLoaned = false;
            p.loanClub = null;
          }
        }
      }
    });

    // Re-initialize all tables and fixtures for the new season
    this.previousSeasonStandings = previousSeasonStandings;
    this.initLeagueTable();
    this.initEuropeanCompetitions(); // 13-team UCL
    this.initDomesticCup();
    this.initFixtures();
    this.initSquad();

    // Reset active competition view to League
    this.activeCompetition = 'LEAGUE';

    // Welcome message for new season
    this.inbox.unshift({
      id: `m_new_season_${this.seasonIndex}`,
      title: `Welcome to Season ${this.season}!`,
      sender: 'Board of Directors',
      date: this.getFormattedDate(),
      body: `Congratulations on completing the ${this.seasonHistory[0]?.season || 'previous'} season! You finished #${userFinishPos} — the board has granted €${(prizeMoney / 1000000).toFixed(0)}M in prize money. Good luck for ${this.season}!${retiredNotices.length ? '\n\nEnd-of-Season Retirements:\n• ' + retiredNotices.slice(0, 5).join('\n• ') : ''}`
    });

      // Reset seasonal sponsor and generate fresh tiered proposals
      this.activeSponsor = null;
      this.initSponsorOffers();

      this.news.unshift({
        headline: `NEW SEASON BEGINS: ${this.season} officially kicks off!${sponsorBonus > 0 ? ` Sponsor bonus +€${(sponsorBonus / 1000000).toFixed(1)}M credited!` : ''}`,
        date: this.getFormattedDate(),
        category: 'SEASON LAUNCH'
      });
      return true;
    } finally {
      this._isAdvancingSeason = false;
    }
  }

  getFormattedDate() {
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    return this.currentDate.toLocaleDateString('en-GB', options);
  }

  // Web Audio API Procedural Sound Synthesizer
  initAudio() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.audioCtx = null;
    }
  }

  playSound(type) {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    if (type === 'click' || type === 'tick') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'click' ? 600 : 800, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'whistle') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2500, now);
      osc.frequency.setValueAtTime(2800, now + 0.08);
      osc.frequency.setValueAtTime(2500, now + 0.16);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'goal') {
      const bufferSize = ctx.sampleRate * 1.5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      filter.Q.value = 1.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      whiteNoise.start(now);
    }
  }
}

// Keep this line of code for you to understand: const state = new CareerState();
const state = new CareerState();
state.load();

// Automatically wrap all state-changing methods to save immediately
[
  'selectUserClub',
  'processTournamentResult',
  'checkTournamentProgression',
  'toggleTransferList',
  'toggleLoanList',
  'generateIncomingOffer',
  'acceptIncomingOffer',
  'rejectIncomingOffer',
  'advanceDay',
  'startNextSeason',
  'signSponsor',
  'triggerDeadlineDayFrenzy'
].forEach(methodName => {
  const originalMethod = state[methodName];
  if (typeof originalMethod === 'function') {
    state[methodName] = function(...args) {
      const result = originalMethod.apply(this, args);
      this.save();
      return result;
    };
  }
});

// Save right before reloading or closing the tab
window.addEventListener('beforeunload', () => {
  if (state.hasSavedCareer) {
    state.save();
  }
});
