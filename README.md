# BOX — Krampus

A first-person horror hide-and-seek game set in a two-floor home-goods store called **Box**. The store is invented: it has an atrium, a big staircase and a round skylight, but the layout is deliberately not a copy of any real store, and there are no real names, signage or brands.

You're a kid locked in the store after closing. Krampus came through the skylight and carried your little brother upstairs in a sack.

## Play
Open `index.html` in a browser. It's one self-contained file with no downloads or libraries, and it works offline. Sound matters, so turn it on.

- **Computer:** WASD/arrows to move, mouse to look (click the view first), Shift to run (loud), C to crouch, E to hide in or look inside a pot or hamper, M for the map, Esc to pause.
- **Phone/tablet:** left thumb moves, right thumb looks. Hide, Crouch and Run buttons are on the right. Landscape works best.

## How a round goes
1. **Grace period.** Krampus is upstairs hiding your brother in a random hamper or big planter.
2. **The hunt.** He patrols both floors. His bells jingle as he walks, louder the closer he is, so you track him by ear. He sees in a cone with real line of sight and hears you run.
3. **Find your brother** by following the muffled crying. Three clues (mitten, toy train, scarf) each make the crying carry farther, and the third names the area he's in.
4. **Escalation.** Every clue makes Krampus faster and sharper-eyed, kills the lights in three sections of the store, and adds two bell traps. Lights also die on a timer. Dark sections make you harder to see.
5. **Bell traps** are strings of bells across walkways. Walk into one and he comes running. Crouch to duck under.
6. **Hide** by crouching behind furniture or climbing into a pot or hamper. If he's chasing and watches you climb in, he pulls you out.
7. **Get the store keys** from one of the registers.
8. **The escape.** Opening the right hamper starts the finale: alarm lights, the bells go silent, and he charges straight at you. Your brother follows you. Run down the stairs to the front doors. They only open if you have the keys.

## Code
- `src/engine.js`: small WebGL renderer, box/cylinder geometry, collision, line of sight, per-section lighting
- `src/level.js`: the store (furniture builders and layout)
- `src/game.js`: player, Krampus (A* across both floors), brother, clues, traps, lights, HUD, audio, touch controls
- `tools/build.py`: inlines `src/` into `index.html`. Run it after editing anything in `src/`.
- `tools/shots.py`, `tools/sim.py`: headless screenshot and gameplay checks (Playwright + Chrome)

## Not built yet
The opening and ending cutscenes (the family arriving at closing, the manager's warning, the skylight crash, the escape) are story text for now.
