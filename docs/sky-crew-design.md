# Sky Crew — design notes (v0)

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
