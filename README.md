# BOX — hide & seek after closing

A first-person hide-and-seek game set in a two-floor home-goods store called **Box**. The layout is based on a real store, simplified, with no real names, signage or brands.

You get 30 seconds to hide while the seekers count at the front doors. Then stay hidden until the clock runs out.

## Play
Open `index.html` in a browser. It's one self-contained file with no downloads or libraries, and it works offline.

- **Computer:** WASD/arrows to move, mouse to look (click the view first), Shift to run (loud), C to crouch, M for the map, Esc to pause.
- **Phone/tablet:** left thumb moves, right thumb looks. Crouch and Run buttons are on the right. Landscape works best.

Difficulty sets the number of seekers (2/3/4), their speed and eyesight, and how long you have to survive.

## Map
- **Downstairs:** living rooms along the windows, a two-story atrium with a big tree and the open staircase, front dining, the ornament shop, glassware, registers, the kitchen department, the coffee and electrics corner, and the entrance. A café sits behind a closed grille.
- **Upstairs:** living rooms, dining, bar stools along the balcony, beds, the design desk by the elevator, and a register.
- **Back of house:** stockroom aisles, warehouse, employee stairs, and upstairs a break room, coat room and back hallway.

## How seekers work
- They patrol, favoring spots with lots of cover, and look around when they arrive somewhere.
- They hear you: running carries a long way, walking a little, and crouch-walking barely at all. Sound is quieter through floors.
- They see in a cone with real line of sight. Shelves, walls, sofas and floors block it. Balcony cable rails and chair legs don't.
- A **?** above a seeker means suspicious, and **!** means it sees you and is chasing. The red bar is how close you are to being found. Break line of sight and they'll search where they last saw you.
- On Normal and Hard, a seeker sometimes gets a hunch and wanders toward your general area.

## Code
- `src/engine.js`: tiny WebGL renderer, box/cylinder geometry, collision, line of sight
- `src/level.js`: the store (furniture builders and layout)
- `src/game.js`: player, seekers (A* across both floors), HUD, audio, touch controls
- `tools/build.py`: inlines `src/` into `index.html`. Run it after editing anything in `src/`.
- `tools/shots.py`, `tools/sim.py`: headless screenshot and gameplay checks (Playwright + Chrome)
