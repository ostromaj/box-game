# BOX — Krampus

**Play it:** https://ostromaj.github.io/box-game/ (GitHub Pages, served from `main`).

A first-person horror hide-and-seek game set in a two-floor home-goods store called **Box**. The store is invented: it has an atrium, a big staircase and a round skylight, but the layout is deliberately not a copy of any real store, and there are no real names, signage or brands.

You're a kid locked in the store after closing. Krampus came through the skylight and carried your little brother upstairs in a sack.

## Play
Open `index.html` in a browser. It's one self-contained file (Three.js and the textures are built in), and it works offline. Sound matters, so turn it on.

- **Computer:** WASD/arrows to move, mouse to look (click the view first), Shift to run, or R to toggle running (loud), C to crouch, E to hide in or look inside a pot or hamper, M for the map, Esc to pause.
- **Phone/tablet:** left thumb moves, right thumb looks. Hide, Crouch and Run buttons are on the right. Landscape works best.
- **Microphone (optional):** turn it on from the title screen or Pause. Krampus then hears your real room: a whisper carries a few metres, talking across a department, a scream across the floor. If he's staring into your hiding place and hears you, you get one warning on Normal (two on Easy, none on Hard). It ignores the game's own sound (it learns how much leaks from your speakers into the mic) and anything quieter than a soft speaking voice, so a silent room stays silent. Headphones still work best. Nothing is recorded or sent anywhere; the game only measures loudness. The mic needs the GitHub Pages link (or any https page); it won't work from inside a sandboxed preview.

## How a round goes
1. **Grace period.** Krampus is upstairs hiding your brother in a random hamper or big planter.
2. **The hunt.** He patrols both floors. His bells jingle as he walks, louder the closer he is, so you track him by ear. He sees in a cone with real line of sight and hears you run.
3. **Find your brother** by following the muffled crying. Three of his things (mitten, toy train, scarf) each make the crying carry farther, and the third names the area he's in. A small marker at the edge of the screen shows which way the crying is.
4. **Escalation.** Every clue makes Krampus faster and sharper-eyed, kills the lights in three sections of the store, and adds two bell traps. Lights also die on a timer. Dark sections make you harder to see.
5. **Bell traps** are strings of bells across walkways. Walk into one and he comes running. Crouch to duck under.
6. **Hide** by crouching behind furniture or climbing into a pot or hamper. If he's chasing and watches you climb in, he pulls you out. Get about 11 m ahead of him and he loses you. He grabs your coat and you tear free twice before a catch counts (three times on Easy, once on Hard). If he watches you climb into a pot, get out and run: he has to walk over to pull you out.
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
- He talks while he hunts (`tools/krampus_voice.py` makes the five lines):
  - **"I can hear you"**: when he hears a bell trap, you running nearby, or your real voice with the mic on.
  - **"I'm going to find you"**: when you lose him after a chase.
  - **"Come out, come out, wherever you are"**: every minute or so while he searches.
  - **"I can smell you, little one"**: when you're crouched or hiding close by and he hasn't seen you.
  - **"Your brother is waiting for you"**: after you pick up the first and third clue.
- With the mic on, Krampus says your own words back to you a few seconds after he hears them: slowed, pitched down and echoing, from wherever he is, or whispered down at you while he stares into your hiding place. The game keeps only the last few seconds in memory and never saves or sends anything.
- More things that are wrong with the store: faceless mannequins that are never quite where they were when you look back; lights that stutter wherever he walks; cloven hoofprints that fade; a music box playing Silent Night over the speakers, flatter the closer he is; whispers; staff collecting at the glass while your back is turned; his chains; frost and your breath when he's close; and sometimes Leo calling you from the wrong place, too clearly (the real Leo is always muffled).
- Leo's things shimmer (circling sparks, rising motes, a ring pulsing across the floor) and twinkle when you're close; they're on the map on Easy and Normal.
- The store keeps talking during the hunt: the manager on the store speakers, Leo calling out (muffled) from the sack and then from his hiding place, the staff whispering through the glass when you go near the doors, and Leo again once you've rescued him. Quiet air-handling hum and wind through the smashed skylight underneath.
- Sometimes he then walks over, bends down and **stares into your hiding place** for about half a minute. Don't climb out.
- If he catches you there's a **jumpscare** before the end screen.

## Story
The full script is in `docs/script.md`. "Play the story" runs all of it: the opening cutscenes, about ten minutes walking the store with Leo while the staff slowly stop acting like people, the balcony, the crash, the doors, then the hunt and the ending. "Jump to the hunt" skips to the hunt. During the walk-around, Pause has a button to skip to closing time.

## Tuning
Difficulty numbers are in `DIFF` at the top of `src/game.js`. `tools/hunt_sim.py [easy|normal|hard] [trials]` plays whole hunts with an autopilot that walks, hides and runs when chased; it wins nearly every time on Easy, about 7 in 10 on Normal and 1 in 4 on Hard. It knows where everything is and panics in corners, so treat it as a rough guide. `tools/escape_sim.py` autopilots the finale alone; with clean steering every run escapes, with Krampus closing to about 3 m.
