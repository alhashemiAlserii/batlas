# Sky Crew — design notes

## Art direction (Harbor cartoon)

Public pages for Dear Passengers (Steam app 4534960, the FLEXUS media pages, and write-ups of the announcement) describe a bright stylized indie cartoon: a readable cabin, chunky expressive people, warm saturated colour, soft light, exaggerated night storms, and slapstick effects (birds on the glass, fire, spilled food, loose cargo). Sky Crew aims at that genre. Nothing is traced from it. Every mesh, texture and name below is drawn in this repo.

The picture is one palette. Hull ivory, Batlas navy `#0a1f5c` and teal `#19d3c5`, warm cabin bulbs, and seat blocks of blue, coral, teal, gold and violet. Lit surfaces share a soft three-step shade plus a warm rim so silhouettes stay readable without a second outline mesh. Shadows are percentage-closer filtered. This three.js build removed the old PCF soft map (it warns and falls back), so the blur is the shadow radius: 2 on Medium, 4 on High, a touch wider on the cabin key light. A contact blob sits under the parked Tidewing. Tone mapping is Neutral, a little warm. High on a desktop adds a quarter-resolution bloom on gauges, windows and nav lamps. If that extra color target cannot be created, bloom turns off and the emissive lamps stay. Medium (the automatic choice on iPhone and iPad) keeps the soft shadows and the particles and leaves bloom off, so a recent iPad can hold 60fps. Low drops shadows, bloom and the heavy particle pools.

The BA-1 Tidewing keeps the same walkable measurements (doors, seats, hold, ramp). The shell is the lofted tube, now with window frames and warm glass, a dorsal antenna, an APU cone, wingtip and beacon lamps, and `BA-1` on the rear fuselage. Inside: mullions on the windscreen, light through the windows, a galley cart, and lavatory signs. Passengers are the same ragdoll people, drawn chunkier, with more hair, bows, flowers and scarves. Harbor Field's apron holds original cargo crates, a tug and a cart. The sea has a slow chop, clouds drift, and a storm at night flashes and streaks the windscreen. A bird strike is only a visual (feathers and a crack, no score change). Galley flares throw smoke, a cargo spill shows a slick, an engine warning throws sparks, and a butter or good landing pops confetti in Batlas colours.

## v1 service shift (this round)

Researched from the public Steam page for Dear Passengers (FLEXUS, app 4534960), the 2 Oct 2026 Steam Q&A, and secondary write-ups of that material (the game is not out; there are no user reviews). What is actually confirmed:

- Co-op crew of a badly run airline. One player flies with simplified controls; the others work the cabin. The pilot can leave the yoke. No character classes. Currently capped at 4, with a hope of more. Invite or lobby code.
- Before takeoff the crew picks passengers and cargo. Higher pay is described as more trouble.
- In flight: serve food and drinks, keep passengers under control, protect cargo. Physics so loose people and objects move when the plane does.
- Turbulence and air pockets are the named weather hazards. You can crash. Runs are described as about 1–90 minutes. Progression between flights is promised and not specified. Scoring, failure rules and how solo covers every job are not published.

Sky Crew keeps the genre (a short co-op flight where the cabin falls apart) and none of the content. Batlas Air, the Tidewing, Harbor Field, Dune Bay, Coral Point and Pine Ridge, the wobbly crew and the call names are original.

The playable round is now a shift, not a sandbox:

1. **Pre-flight.** Bags into the forward hold, passengers to their seats, doors, seatbelt, welcome call.
2. **Takeoff.** Whoever is in the captain's seat flies. One player can do this and then get up.
3. **The shift.** The server (solo: the same rules locally) deals cabin calls: drink, meal, blanket, lavatory, airsick, crying child, unruly passenger, lost keepsake. It also starts incidents: chop that shoves the crew around, a galley flare, a cargo spill, a medical.
4. **Landing and the card.** Stars and a service score from those rules, plus the existing payout. Two stars at Dune Bay opens Coral Point. Three at Coral Point opens Pine Ridge. Saved flights on the account already count, so older profiles stay open.

Jobs change the score, not the buttons. The matching role earns more; anyone can still answer a call, which is what makes 1–8 and a solo training hop work. A training hop to Dune Bay is one drink, one chop, then the landing.

Network: the server ticks the shift a few times a second and broadcasts only when the call list, an incident or the score changes. The host still runs the cabin physics.

## v0 notes


## Reference: *Dear Passengers* (FLEXUS, announced for 2026)
Researched from the Steam page (store.steampowered.com/app/4534960), the developers' Steam Q&A post, the official site and coverage (Kotaku, player.one), 9 Nov 2026. Summary of what the reference is:
- **Pitch:** online co-op (1–4 players, invite/lobby code) as the crew of a comically bad budget airline: deliver passengers and cargo "preferably in one piece".
- **Roles:** no fixed classes. One player flies; the others run the cabin and can swap at any time (the pilot can leave the yoke and help).
- **Before takeoff:** choose which passengers and cargo to bring; bigger payouts bring more trouble (hard-to-handle cargo, hard-to-please passengers).
- **In the cabin:** serve food and drinks, calm passengers, handle luggage and cargo, deal with problems before they snowball.
- **Flying:** simplified but "quite detailed" controls; accessible, not a simulator; you can crash; sometimes heavy obstacle dodging.
- **Chaos:** physics-based passengers, luggage and cargo; weather, turbulence and air pockets throw everything around; bird strikes, failures, escaping dangerous cargo.
- **Social:** proximity voice chat, ragdolls, slapstick interactions between friends.
- **Structure:** runs of 1–90 minutes, progression between flights.

## Our original take: **Sky Crew** by Batlas
Same genre (co-op, physics-y airline chaos), entirely original content: no names, characters, art, text, audio or code taken from the reference.

| | Sky Crew |
|---|---|
| Airline | **Batlas Air**: "We'll get you there. Probably." Navy and teal livery with the Batlas wave |
| Plane | **BA-1 "Tidewing"**: chunky low-poly twin-jet; cockpit, galley, 12-row cabin with overhead bins, rear cargo hold with side cargo door, front air-stairs |
| Route (v0) | **Harbor Field (HBF)** to **Coral Point (CRP)**, ~10 km northeast |
| Passengers | Procedural low-poly travellers with personalities: **Worrier** (anxious, wants water, panics in turbulence), **Snacker** (always hungry), **Napper** (wants a blanket), **Critic** (complains, rates the flight), **Tourist** (wanders the aisle) |
| Crew tools | Galley dispensers (water, snacks, blankets), luggage, doors, cockpit, maintenance panel |
| Chaos | Turbulence and air pockets (physics impulses on loose bags, camera shake), passenger complaints, engine-warning malfunction you fix at the maintenance panel, storm weather |
| Staff fun | Rank-gated admin overlay; Developer-only fictional gear: the **Wave Cannon** (a splash of water that shoves luggage around) |

### Core loop (v0)
1. **Boarding:** load bags from the baggage cart into the cargo hold, wait for passengers to walk up the stairs and sit, close both doors.
2. **Departure:** a crew member takes the captain's seat: throttle up, rotate at ~140 kt, climb.
3. **Cruise:** random events fire from `events.json` (weighted, phase-gated). Cabin crew serve requests, re-stow flying bags and fix malfunctions; the pilot steers toward the CRP marker.
4. **Arrival:** line up with the Coral Point runway, descend gently, touch down under the sink-rate limit and stop.
5. **Results:** score for bags loaded, passengers served, events handled, landing quality and time, with a star rating.

### Tech (v0)
- Three.js + cannon-es, vendored (no CDN). All geometry procedural (boxes and cones), canvas-drawn livery and name tags.
- The whole cabin lives in the aircraft's local frame, so physics and walking stay stable at 250 kt; only turbulence adds impulses.
- Co-op: WebSocket rooms (5-letter code). Players sign in with Batlas accounts (game-token flow; the server verifies with the website, so clients can't fake a rank). The room host simulates passengers, bags and events; the pilot is authoritative for the aircraft; the server relays and enforces every admin command, then writes it to the Batlas audit log.

### Later
Passenger/cargo selection with risk/payout, ragdolls, proximity voice, more planes and routes, progression, real art and audio, controller support, Unity port for PC and mobile.
