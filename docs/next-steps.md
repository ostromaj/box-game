# Next steps

## Done on `cutscenes-wip` (Three.js port + scares)
- **Renderer is now Three.js** (`src/render3.js`, bundled into the single offline `index.html` by `tools/build.py` with esbuild).
  Game logic, level builders, actors, A*, cutscenes and the script are unchanged; only the drawing layer was swapped.
  - PBR materials (roughness/metalness per surface), photo textures for wood floor, tile and brick, procedural bump for
    fabric, carpet, concrete, fur, leather, snow and asphalt, room reflections on ceramic/metal/glass.
  - Baked soft shadow maps per floor, ambient occlusion (GTAO), bloom on lamps / tree lights / Krampus's eyes,
    depth of field in cutscenes, film grain, vignette, chromatic aberration, ACES tone mapping.
  - Phone preset (touch devices, or add `?q=low` to the URL): no AO/DoF, smaller shadow maps.
- **Krampus is scarier**: ember eyes that glow in the dark, more and longer teeth, longer claws, taller in the hunt.
  - **Jumpscare** when he catches you (camera is dragged to his face, scream, shake) before the "Into the sack" screen.
  - **"I can hear you"** while you hide near him: growl + the device's speech voice pitched all the way down + red subtitle.
  - **The stare**: about 70% of the time after that line he walks to your pot/hamper, bends over and looks straight into
    the opening for 27–33 seconds, breathing. Hold still and he leaves. Climb out while he's staring and he has you.
  - Dread effect: the picture desaturates and closes in and a heartbeat speeds up as he gets near.
- Test tools: `tools/scares.py` (stare + jumpscare), plus the existing `scenes.py`, `shots.py`, `sim.py`, `escape_sim.py`.
  All accept `BOXQ='&q=low'` to run the phone preset (much faster headless).

## Still to do
1. **Real downloaded 3D models.** This session could only reach npm and GitHub, so Poly Haven, Quaternius, Kenney and
   ambientCG downloads were blocked. Allow those domains (claude.ai → Settings → Capabilities → allowed domains:
   `polyhaven.com`, `dl.polyhaven.org`, `api.polyhaven.com`, `quaternius.com`, `kenney.nl`, `ambientcg.com`) and then:
   - sofas / tables / lamps / shelves / plants from Poly Haven + Kenney furniture kit, loaded as GLB next to the built geometry
     (render3.js needs a small GLTF path: load, place by the same transforms level.js uses, keep the existing colliders);
   - rigged CC0 people with walk/run/idle/sit (Quaternius) to replace the hand-built family and staff;
   - a rigged goat/creature base for Krampus, keeping the horns, chains, bells and sack;
   - a Poly Haven night HDRI for the parking lot.
   Models have to be embedded in `index.html` (it is opened from disk), so keep them small (Draco/meshopt, 1K textures).
2. Re-test the full hunt (`tools/sim.py`, `tools/escape_sim.py`) and the 10-minute walk-around after the renderer swap.
3. Unfinished from before: balcony moved to the east rail (x≈40.6, z≈15.5 upstairs), better framing for the crash close-ups,
   brick base band breaking at the two doorways.
4. Tune: Krampus's voice differs by device (it uses whatever speech voice the phone/computer has). A recorded growl line
   would be scarier and consistent.
5. Keep the "Box" name and the shuffled layout; no real store name or private store details.
