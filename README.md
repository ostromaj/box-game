# BOX — Krampus

A first-person horror hide-and-seek game set in a two-floor home-goods store called **Box**. The store is invented: it has an atrium, a big staircase and a round skylight, but the layout is deliberately not a copy of any real store, and there are no real names, signage or brands.

You're a kid locked in the store after closing. Krampus came through the skylight and carried your little brother upstairs in a sack.

## Play
Open `index.html` in a browser. It's one self-contained file (Three.js and the textures are built in), and it works offline. Sound matters, so turn it on.

- **Computer:** WASD/arrows to move, mouse to look (click the view first), Shift to run (loud), C to crouch, E to hide in or look inside a pot or hamper, M for the map, Esc to pause.
- **Phone/tablet:** left thumb moves, right thumb looks. Hide, Crouch and Run buttons are on the right. Landscape works best.

## How a round goes
1. **Grace period.** Krampus is upstairs hiding your brother in a random hamper or big planter.
2. **The hunt.** He patrols both floors. His bells jingle as he walks, louder the closer he is, so you track him by ear. He sees in a cone with real line of sight and hears you run.
3. **Find your brother** by following the muffled crying. Three of his things (mitten, toy train, scarf) each make the crying carry farther, and the third names the area he's in. A small marker at the edge of the screen shows which way the crying is.
4. **Escalation.** Every clue makes Krampus faster and sharper-eyed, kills the lights in three sections of the store, and adds two bell traps. Lights also die on a timer. Dark sections make you harder to see.
5. **Bell traps** are strings of bells across walkways. Walk into one and he comes running. Crouch to duck under.
6. **Hide** by crouching behind furniture or climbing into a pot or hamper. If he's chasing and watches you climb in, he pulls you out. Get about 13 m ahead of him and he loses you. The first time he grabs you, you tear free (twice on Easy, never on Hard).
   **The staff** watch from outside the glass. Stand around near a door and they knock to tell him where you are.
7. **Get the store keys** from one of the registers.
8. **The escape.** Opening the right hamper starts the finale: alarm lights, the bells go silent, and he charges straight at you. Your brother follows you. Run down the stairs to the front doors. They only open if you have the keys. Leo falls at the bottom of the stairs: go back for him.

## Code
- `src/render3.js`: the Three.js drawing layer (PBR materials, textures, shadows, AO, bloom, depth of field, grain)
- `src/engine.js`: geometry builder (boxes, lathes, tubes), math, collision, line of sight
- `src/level.js`: the store (furniture builders and layout)
- `src/actors.js`: the family, the staff, Krampus, the car
- `src/game.js`: player, Krampus (A* across both floors), brother, clues, traps, lights, cutscenes, HUD, audio, touch controls
- `tools/build.py`: bundles Three.js + `render3.js` (esbuild), embeds `assets/textures`, inlines `src/` into `index.html`.
  Run `npm install` once, then `python3 tools/build.py` after editing anything in `src/`.
- `tools/playthrough.py`: plays the whole story on autopilot and writes a transcript; `tools/hunt_sim.py` and `tools/escape_sim.py` play the hunt and the finale many times
- `tools/shots.py`, `tools/scenes.py`, `tools/scares.py`, `tools/sim.py`: older headless checks (Playwright + Chrome)
- `assets/models/*.glb`, `assets/sounds/*.mp3`, `assets/textures/*.jpg` are all embedded in `index.html` by the build
- `assets/CREDITS.md`: where the models, textures and the voice line came from

## Krampus
- While you get your bearings he walks across the upstairs with the sack. Watch where he goes.
- He says **"I can hear you"** when you're hiding and he's close.
- Sometimes he then walks over, bends down and **stares into your hiding place** for about half a minute. Don't climb out.
- If he catches you there's a **jumpscare** before the end screen.

## Story
The full script is in `docs/script.md`. "Play the story" runs all of it: the opening cutscenes, about ten minutes walking the store with Leo while the staff slowly stop acting like people, the balcony, the crash, the doors, then the hunt and the ending. "Jump to the hunt" skips to the hunt. During the walk-around, Pause has a button to skip to closing time.

## Tuning
Difficulty numbers are in `DIFF` at the top of `src/game.js`. `tools/hunt_sim.py [easy|normal|hard] [trials]` plays whole hunts with an autopilot that walks, hides and runs when chased; it wins about 7 in 10 on Easy, 1 in 3 on Normal and rarely on Hard. It knows where everything is and panics in corners, so treat it as a rough guide. `tools/escape_sim.py` autopilots the finale alone; with clean steering every run escapes, with Krampus closing to about 3 m.
