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

**Krampus talks and can hear you**: five lines (see README) from `tools/krampus_voice.py`, and an optional real-microphone mode (`micStart`/`micTick`/`micHear` in `src/game.js`). The mic learns the room's background for two seconds, then compares loudness against it; game sound leaking from speakers raises the bar. `window.__micTest = 0..1` fakes a loudness level for tests. Also fixed: timed events (`later()`) never ran during the hunt, because `tick()` didn't run them.

**Hunt voices**: `HV` and `huntVoices()` in `src/game.js` (store announcements, Leo muffled, staff at the glass, rescue/escape lines), `voiceAt()` plays a line from a place with an optional muffled or speaker effect. Ambience in `ambTick()`. Audio restarts itself after a phone pauses it (`audioKick`), and Skip can never leave the game muted.

**Krampus's look**: long goat-demon skull (`SKULL` keys), slanted ember eyes under a heavy brow, snarl and two rows of teeth, ridged dark horns, matte cracked hide (material `HIDE`) and horn (`HORN`) in `src/render3.js`, hanging matted fur, a hump and mane. The jumpscare opens his jaws at you.

**Mic, round 2**: `micTick` now has a hard minimum (`MIC_MIN_DB`), learns how much game sound leaks into the mic (`MIC.leak`) and ignores anything that isn't clearly louder than that echo, and needs a quarter second of sound. **Faces**: the person head in `src/actors.js` is a shaped skull (`headN`), features are placed on the real surface (`fz`), hair and beards are offset shells with a soft hairline (`hairShell`), brows and lips are smooth tubes. `wide` and `maw` smiles are thin, bloodless, too wide, with needle teeth. **Black screen guard**: Jump/Try again reset fade, slow motion and the jumpscare; the frame loop schedules itself first; a lost graphics context shows a Reload message.

**Round 3**: needle teeth thicker and brighter, and the closed `wide` smile shows clenched teeth between parted lips. Opening scene: the car parks alongside the kerb at (40.6, -10.7) and the family steps out on the store side. The barrel stare has a 22-second loop in `actors.js` (`gs.name === 'peer'`): head tilt, twitches, tongue licking the teeth (`k._lick`), a laugh (`k_laugh.mp3`), leaning in to sniff; `game.js` plays `slurp`/`sniff`/laugh on the same clock and lights his face from the barrel. Leo's things are bigger, easier to grab (1.6 m), shimmer (circling sparks, rising motes, a pulsing floor ring), twinkle when you're within 10 m, and show on the map on Easy/Normal (Hard: within 15 m). Bodies: shorter legs, shaped limbs (lathe profiles), rounded shoulders, a relaxed weight-on-one-leg stance, belts/ribbing/ties that follow the body (`band()`), a straight-falling coat.

**Round 4**: people's arms and legs are one smooth limb each, rebuilt every frame through the joints (`limb`/`drawLimbs` in actors.js); aprons are smooth sheets; shoes are shaped. Mic mimic: a 6 s rolling buffer (`MIC.ring`, ScriptProcessor), phrases cut where the mic counted you, played back by `mimic()`. New scares: light flicker near him (`pickLights`), hoofprints (`G.prints`, `hoofMesh`), chains, `musicBox()` (Silent Night, 1818), whispers (WHISPER voice in tools/voices.py: random-phase STFT), Leo lure (`HV.lure`, unmuffled), staff gathering at the glass (`staffOutside`), frost/breath overlays.

**Mic, round 3**: `micTick` now works per frequency band (`MIC_BANDS`): mic vs the game's own output, per-band room floor (`nB`), learned speaker-to-mic leak (`lB`, quick to rise while the game is busy), game peak-hold (`pB`), 4 of 7 bands must agree, `MIC_MIN_DB = -38`, 0.35 s sustained, hearing radius 3 + 24 m x level. Tested with `/home/claude/work/microom2.py`-style simulation (game speech/bells/music box leaking at 0.25 and 0.7).

**Performance + head shape**: people more than 7 m from the camera use a lighter copy of every part (`loGeo` proxy, `'|lo'` key suffix, `setEye`), limbs use 6 sides far away, hair/beard shells only span the part of the head they cover, people behind the camera or past 55 m aren't drawn, desktop render scale capped at 1.15x. Frame mesh building went from 19-33 ms to ~8 ms in the test browser. Heads: `hsz` 0.95, rx 0.98, jaw `J` 0.24/0.3/0.16 turning in late (s2 from 0.52), softer eye sockets, flatter crown. `window.__prof` (debug) times logic / mesh building / limbs / draw.

**Round 5 (real bodies, reveal, three additions)**:
- *Bodies*: people are MakeHuman meshes (CC0) baked by `tools/humans.py` (`python3 tools/humans.py /path/to/makehuman-data`, a checkout of makehuman-js/makehuman-data with `targets.bin` pulled from LFS). Per character it shapes the body with the macro targets (gender/age/muscle/weight/race, `CAST` table), fits a clothes proxy and shoes, tints them (AO keeps folds), puffs winter coats with baffles, adds boot shafts and mittens, drops the head, collapses the skin weights onto the rig's 16 joints, simplifies to ~9k and ~2.6k triangles, and packs `assets/humans.bin` (embedded as `window.BOX_HUM`). In `actors.js`, `dims()` measures the rig off the real joints (`d.real`, z offsets `pz/cz/nz/hz/sz`, `shY`), `bindOf()` fits the rig to MakeHuman's A-pose once per character, and `emitBody()` skins on the CPU every frame (about 2 ms for the whole cast in the test browser). Aprons, ties, lanyards and the purse strap read the body's measured front (`d.pf`, `frontP`, `frontC`). The game's own heads sit at `d.hoff`.
- *Reveal (`sceneCrash`)*: every kid shot is through your eyes at 1.3 m (`pov()`, a follow camera with a handheld wobble): walking up to your parents, eyes snapping up to the bursting skylight and riding him down, a dolly-zoom as he turns, his stare, the rush, and the floor-level view as he bounds to the balcony. The kids now stand clear of the stairs (27.5, 26.0) so the sightlines work.
- *New*: hold your breath (`breathTick`, `#lungs`, `#btnBreath`), close calls (`closeTick`, `body.close` vignette), and a report card on both end screens (`reportCard`).

**Krampus, traditional look**: long shaggy goat-hair locks that hang and sway (`tufts`, 3-sided tubes), a big mane framing the face and a long beard, bigger curling ram horns, a birch Rute tied with a red rag in his left hand, big six-sided iron cowbells on the chain belt, a shorter, broader muzzle (`squashFace`, applied to the finished head and jaw vertices), slightly bigger ember eyes. Fixes: the jaw opens downward (`jrot`), the tongue lies in the mouth and hangs with gravity in the jaw's frame, and his face turns down into the hiding place during the stare.

## Still to do
0a. **Black screen on "Jump to the hunt"**: couldn't reproduce in headless Chrome (fresh, after caught, after a win, mic on/off). Ask which device/browser if it comes back.
0. **Cutscene camera pass**: Joseph says the scenes' camera views and movement still feel a little off. Go shot by shot.
1. **Krampus is still hand-built.** People have real bodies now. Fingers are in MakeHuman's open rest pose; a slight curl
   baked in `tools/humans.py` (rotate finger verts about the knuckle joints) would read more relaxed.
2. **Sofas, beds and shelves are still hand-built.** Poly Haven's sofas are antique styles that don't suit this store.
   A modern CC0 sofa and bed would slot straight in: add the `.glb` to `assets/models/` and wrap the builder in `model(...)`
   in `src/level.js` the way `chair()` does.
3. **Try the mic mode with a real voice.** It was tuned with simulated loudness. If he hears too much or too little, change the
   margin in `micTick` (higher = deafer) or the hearing radius in `micHear`.
4. **Balance with real players.** The autopilot (`tools/hunt_sim.py`) wins about 7 in 10 on Easy, 1 in 3 on Normal and
   rarely on Hard, but it knows where everything is and panics in corners. Tune `DIFF` at the top of `src/game.js`.
5. Keep the "Box" name and the shuffled layout; no real store name or private store details.

## Tools
- `python3 tools/build.py` after any change in `src/` (needs `npm install` once).
- `tools/playthrough.py OUT [easy|normal|hard] [--fast] [--noshots]`: the whole story, with a transcript.
- `tools/hunt_sim.py [difficulty] [trials]`: many hunts; `TRACE=1` prints the last seconds of each loss.
- `tools/escape_sim.py [difficulty] [trials] [reaction secs]`: the finale only.
- `tools/sim.py`, `tools/scenes.py`, `tools/scares.py`, `tools/shots.py`: older single-purpose checks.
