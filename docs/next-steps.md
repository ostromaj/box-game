# Next: real 3D models (Three.js + free CC0 assets)

Joseph picked "free real 3D models" over the hand-built look. The chat this was built in had no network,
so the switch happens in a new chat with package downloads allowed.

## Where things stand (branch `cutscenes-wip`)
- `src/game.js` is fully rewritten: opening cutscene (car arrives at 8:59, watch, "good time to go to the Box store",
  Dana at the door, sofa fabrics, 9:00 clock, plate on the wrong shelf, employee huddle, "do you have this in the back?"),
  10-minute walk-around holding Leo's hand (hide-and-seek, Dad sofa-hopping, Marcus re-fluffing, lamp joke, bells),
  balcony warning, skylight crash, the doors and evil smiles, the hunt, and the ending (slow-mo burst, Dana dragged back
  inside, bell in the car).
- All five cutscenes run start to finish headlessly (`tools/scenes.py`). The hunt after the rewrite and the
  full walk-around have not been re-tested yet.
- Unfinished fixes in this branch: the balcony moved to the east rail (x≈40.6, z≈15.5 upstairs), a better framing for
  the crash close-ups, and the brick base band now breaks at the two doorways.

## The plan for the new chat
1. Port the renderer to Three.js (npm `three`, bundled into one file with esbuild so it still works offline from GitHub).
   Keep the game logic (`game.js` nav/A*, Krampus AI, cutscene runner, script) and swap only the drawing layer.
2. Assets, all CC0 / free to use, downloaded into `assets/` and committed:
   - Furniture/props: Quaternius, Kenney furniture kit, Poly Haven models (sofas, tables, lamps, shelves, plants).
   - Surfaces: Poly Haven / ambientCG PBR textures (wood floor, brick, fabric, concrete, glass).
   - Lighting: a Poly Haven night HDRI for the parking lot.
   - People: rigged CC0 characters with walk/run/idle/sit animations (Quaternius "Ultimate Modular Men/Women" or similar).
   - Krampus: kitbash from a rigged creature/goat model plus custom horns, chains, bells and sack.
3. Rendering: PBR materials, baked lightmaps for the store, soft shadows, bloom, SSAO, film grain,
   depth of field in cutscenes, snow particles. Keep a phone quality preset.
4. Keep the "Box" name and the shuffled layout; no real store name or private store details.
