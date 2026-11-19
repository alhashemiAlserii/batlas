# Sky Crew: asset and design provenance

Everything you see and hear in Sky Crew is made for this project. Nothing is copied, traced, recreated or adapted
from another game. There are no characters, models, names, textures, logos, sounds or music from PEAK,
Dear Passengers or any other title. The "PEAK spirit" in the brief means the *feel* only: chunky, friendly, a bit silly.
The shapes, proportions, faces, outfits and names are original.

| Area | What it is | How it is made | Source |
|---|---|---|---|
| Crew characters (`js/characters.js`, `makeCrew`) | Cartoon people: round head on a short neck, shouldered torso, arms, hands, legs and shoes, with a name tag and a rank badge. Pilot, cabin and cargo uniforms are original | Procedural Three.js geometry (lathe torso, spheres, capsules), vertex colours, code-driven animation (walk, run, sit, wave, cheer) plus a spring wobble | Original, written in code for this repo |
| Outfits, hats, colours (`server/src/game-server/shop.ts` catalog, `js/characters.js`) | Uniforms (pilot, cabin, mechanic, …), caps and hats, body colours | Procedural meshes and colour palettes chosen for this game | Original |
| Passengers (`js/characters.js`, `js/sim.js`) | Comedic passenger NPCs with personalities, requests, reactions, and varied hair, clothes and body sizes | Procedural low-poly meshes, seeded looks, original personality names and lines | Original |
| Airliner, cabin, rear door, stairs (`js/world.js`) | The plane outside and inside | Procedural geometry merged into vertex-coloured batches | Original |
| Airport terminal (`js/terminal.js`) | Check-in, X-ray belt, scanner arch, gate desk, lounge, signs, departures board | Procedural geometry; signs and the board are drawn on a `<canvas>` at runtime | Original |
| World (`js/world.js`) | Sky, sea, islands, airports, clouds | Procedural geometry and shaders | Original |
| Batlas logo (`/img/batlas-mark.png`) | Studio mark on the tail livery and menu | The studio's own logo | Batlas (owner) |
| Sound and music (`js/audio.js`) | Engine, chimes, beeps, scanner "beep/boop", stamp, ambience, menu pad | Synthesised live with WebAudio; there are no audio files | Original |
| Fonts | System UI fonts only | — | Device fonts |
| Libraries | Three.js r187 (MIT), cannon-es (MIT) | Vendored JS | Open source, MIT licence |

Route names (Coral Point, Dune Bay, Pine Ridge, Harbor Field), the airline name and every in-game text line are written for this game.
