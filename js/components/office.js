/* Office, Press Conferences & Board Objectives */



class OfficeEngine {
  getBoardObjectives() {
    if (!state.myClub) return [];

    const club = state.myClub;
    const rating = Number(club.rating) || 0;
    const leagueSize = state.clubs.filter(team => team.league === club.league).length || 16;
    const targetPosition = rating >= 90
      ? Math.min(2, leagueSize)
      : rating >= 85
        ? Math.min(4, leagueSize)
        : rating >= 80
          ? Math.min(8, leagueSize)
          : Math.max(1, leagueSize - 3);
    const rankedTable = [...state.standings].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const currentRank = rankedTable.findIndex(row => row.clubId === club.id) + 1;
    const hasLeagueStarted = rankedTable.some(row => row.played > 0);
    const youthProducts = state.players.filter(player => player.clubId === club.id && (player.isYouthProduct || String(player.id).startsWith('y_') || /^y[0-9]/.test(String(player.id)))).length;
    const budget = Number(club.budget) || 0;
    const priority = rating >= 88 ? 'High' : rating >= 80 ? 'Medium' : 'Development';

    return [
      {
        title: rating < 76
          ? `Avoid the bottom three in ${club.league || 'your league'}`
          : `Finish in the top ${targetPosition} of ${club.league || 'your league'}`,
        detail: hasLeagueStarted ? `Current position: ${currentRank || 'unranked'} · Club strength: ${rating} OVR` : `Season target based on ${club.name}'s ${rating} OVR squad.`,
        status: hasLeagueStarted && currentRank > 0 && currentRank <= targetPosition ? 'On target' : hasLeagueStarted ? `Needs improvement · #${currentRank}` : 'Season not started',
        priority
      },
      {
        title: 'Keep the transfer budget above zero',
        detail: `Available transfer budget: €${Math.max(0, budget / 1000000).toFixed(1)}M`,
        status: budget > 0 ? 'Budget available' : 'Budget exhausted',
        priority: 'Financial'
      },
      {
        title: 'Promote an academy player to the first team',
        detail: 'One academy graduate is a realistic development target for this season.',
        status: youthProducts > 0 ? `${youthProducts} graduate${youthProducts === 1 ? '' : 's'} promoted` : '0/1 promoted',
        priority: 'Development'
      }
    ];
  }

  generatePressConference(opponentName, context = {}) {
    const positionText = context.currentRank
      ? `You are currently ${context.currentRank}${context.currentRank === 1 ? 'st' : context.currentRank === 2 ? 'nd' : context.currentRank === 3 ? 'rd' : 'th'} in ${context.league}. `
      : `The league season is underway. `;
    const opponentText = opponentName
      ? `against ${opponentName}${context.isHome ? ' at home' : ' away'}`
      : 'in the next league fixture';

    return {
      title: `Pre-match briefing · ${opponentName || 'Next fixture'}`,
      questions: [{
        id: 'match-plan',
        text: `Reporter: "${positionText}What is the plan ${opponentText}?"`,
        options: [
          { text: 'Respect the opposition, keep our shape, and take our chances.', moraleImpact: 1, boardImpact: 1 },
          { text: 'Back the squad and play to our strengths.', moraleImpact: 2, boardImpact: 0 },
          { text: 'Focus on a disciplined performance and build momentum.', moraleImpact: 1, boardImpact: 1 }
        ]
      }]
    };
  }

  answerQuestion(option) {
    state.managerRating = Math.max(0, Math.min(99, state.managerRating + option.boardImpact));
    state.starters.forEach(p => {
      p.morale = Math.max(0, Math.min(99, p.morale + option.moraleImpact));
    });
    state.playSound('click');
  }
}

const officeEngine = new OfficeEngine();
