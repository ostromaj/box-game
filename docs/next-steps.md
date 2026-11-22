# Next steps

## Where things stand (`cutscenes-wip`)
The whole story plays start to finish: opening → walk-around with Leo → balcony → crash → doors → hunt → rescue →
escape → ending. `tools/playthrough.py` runs all of it on autopilot and writes a transcript.

### Done in the overnight pass (three run-throughs, five rounds each)
**Bugs that would have stopped a real play-through**
- The game froze when the balcony or crash cutscene started from the walk-around.
- Krampus and Leo got stuck at the foot of the stairs whenever they re-pathed (he could never chase you upstairs).
- Heads turned the wrong way when a character looked at something.
- The jumpscare scream was being replaced by a quiet yelp.

**The staff** go from tired retail to wrong over four acts in the walk-around (see `docs/script.md`), look up at
you from the balcony scene, bow when Krampus lands, walk your parents out, and watch from the glass in the hunt.

**The hunt**
- Fair chases: get about 11 m ahead and he loses you; he grabs your coat twice before a catch counts (three times on Easy, once on Hard).
- He never teleports. He starts the hunt where he walked to with the sack, has to walk over to pull you out of a pot, and in the finale he rages where he stands until you have a head start.
- He is smaller (about one and a half times Dad), hunched, with long hanging arms and a lurching walk.
- Hide-and-seek starts only after Leo has seen everything on his list. Easy shows Leo's things and the keys on the map.
- He is slow to notice you far away and quick up close. He carries the sack across the upstairs while you get your bearings.
- One-time hints, a goal line, a "crying" direction marker (and a "bells" marker on Easy and on phones).
- Staff knock on the glass if you loiter by a door.
- Leo falls at the bottom of the stairs in the finale; Krampus is slow on the staircase.
- "I can hear you" is now a recorded line (`assets/sounds/hear.mp3`), the same on every device.

**Models**: Poly Haven chairs, armchairs, coffee and side tables, potted plants and a night sky (`assets/CREDITS.md`).

**Voices**: every character line is spoken (`assets/sounds/v_*.mp3`). After changing any dialogue, run `python3 tools/voices.py --model DIR` (Kokoro; see the top of that file for the two model files) and rebuild. Narration captions are not voiced.

## Still to do
1. **People and Krampus are still hand-built.** Rigged CC0 packs (Quaternius) would need their faces and gestures rebuilt
   for the cutscenes: the stare, the wide smile, the owl head-turn and the bow all live in `src/actors.js`. Worth doing only
   if the result keeps those.
2. **Sofas, beds and shelves are still hand-built.** Poly Haven's sofas are antique styles that don't suit this store.
   A modern CC0 sofa and bed would slot straight in: add the `.glb` to `assets/models/` and wrap the builder in `model(...)`
   in `src/level.js` the way `chair()` does.
3. **Listen to the Krampus line** on a real device. It was generated and processed blind (text-to-speech pitched down, with
   gravel and reverb). If it is mush, re-run with less processing or record one.
4. **Balance with real players.** The autopilot (`tools/hunt_sim.py`) wins about 7 in 10 on Easy, 1 in 3 on Normal and
   rarely on Hard, but it knows where everything is and panics in corners. Tune `DIFF` at the top of `src/game.js`.
5. Keep the "Box" name and the shuffled layout; no real store name or private store details.

## Tools
- `python3 tools/build.py` after any change in `src/` (needs `npm install` once).
- `tools/playthrough.py OUT [easy|normal|hard] [--fast] [--noshots]`: the whole story, with a transcript.
- `tools/hunt_sim.py [difficulty] [trials]`: many hunts; `TRACE=1` prints the last seconds of each loss.
- `tools/escape_sim.py [difficulty] [trials] [reaction secs]`: the finale only.
- `tools/sim.py`, `tools/scenes.py`, `tools/scares.py`, `tools/shots.py`: older single-purpose checks.
