/* Squad Hub Interactive Pitch Component */




function renderPitch(containerElement, selectedSlotIndex = null, onSelectSlot) {
  const formation = FORMATIONS[state.selectedFormationKey] || FORMATIONS['4-3-3'];
  const starters = state.starters;

  let slotsHtml = '';
  formation.positions.forEach((posConfig, idx) => {
    const player = starters[idx];
    const isSelected = selectedSlotIndex === idx;
    const ovr = player ? state.getEffectivePlayerOvr(player) : '--';
    const name = player ? `${player.name.split(' ').pop()}${player.injury ? ` · ${player.injury.daysRemaining}d` : ''}` : 'Empty';
    const role = posConfig.role;

    slotsHtml += `
      <div class="pitch-player-slot" 
           style="left: ${posConfig.x}%; top: ${posConfig.y}%;" 
           data-slot-index="${idx}">
        <div class="slot-node ${isSelected ? 'selected' : ''}">
          ${ovr}
        </div>
        <div class="slot-info">
          <div class="slot-name">${name}</div>
          <div class="slot-pos-badge">${role}</div>
        </div>
      </div>
    `;
  });

  containerElement.innerHTML = `
    <div class="pitch-lines"></div>
    <div class="pitch-half-line"></div>
    <div class="pitch-center-circle"></div>
    <div class="pitch-penalty-area-top"></div>
    <div class="pitch-penalty-area-bottom"></div>
    ${slotsHtml}
  `;

  // Attach click listeners to player slots
  containerElement.querySelectorAll('.pitch-player-slot').forEach(slotEl => {
    slotEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(slotEl.dataset.slotIndex, 10);
      onSelectSlot(idx);
    });
  });
}

// Calculate team rating metrics
function calculateTeamRatings() {
  const available = state.players.filter(player => player.clubId === state.myClubId && !player.injury)
    .sort((a, b) => state.getEffectivePlayerOvr(b) - state.getEffectivePlayerOvr(a)).slice(0, 11);
  if (!available.length) return { att: 60, mid: 60, def: 60, ovr: 60 };

  const forwards = available.filter(p => ['ST', 'LW', 'RW', 'CF'].includes(p.pos));
  const midfielders = available.filter(p => ['CAM', 'CM', 'CDM', 'LM', 'RM'].includes(p.pos));
  const defenders = available.filter(p => ['CB', 'LB', 'RB', 'LWB', 'RWB', 'GK'].includes(p.pos));
  const avg = arr => arr.length ? Math.round(arr.reduce((sum, player) => sum + state.getEffectivePlayerOvr(player), 0) / arr.length) : 60;

  const att = avg(forwards.length ? forwards : available);
  const mid = avg(midfielders.length ? midfielders : available);
  const def = avg(defenders.length ? defenders : available);
  const ovr = Math.round((att + mid + def) / 3);
  return { att, mid, def, ovr };
}
