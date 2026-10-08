- Spawn exactly once: a single reply containing exactly four spawn_agent calls and nothing else. The four owners and their files:
  1. TRACK owner: js/track.js (track geometry, coastal scenery, gates, start grid).
  2. PLAYER+CAMERA owner: js/player.js and js/camera.js.
  3. AI owner: js/ai.js.
  4. RACE+HUD owner: js/race.js and js/hud.js.
- Each brief must contain: the owner role, the exact owned files and exports, the full text of game/contracts.md, and the relevant TASK requirements. Tell each builder it may edit only its owned files, must not run whole-game playtests, must validate with check_modules after each change, and should finish naturally when its module is ready.
- Never spawn a PRD, reviewer, tester, polish, or replacement agent, and never spawn a second group.
