# Changelog

## 2026-10-23 (who invited whom: invite links and the mother tree)

- **Your own invite link**: every player has a personal link, code and QR
  code, on the Account page and on their own hero page, with Share and
  Copy. Their code works wherever the farm's invite code does, so friends
  can join from the internet. "New link" makes a fresh one, and the old
  one stops working.
- **Every new hero remembers who invited them**: through a link or a code,
  or as "added by" when a player creates the account. At home, sign-up
  asks (optionally) "Who invited you?". The sign-up page greets people
  with "Avi invited you to the farm". Existing heroes can say who invited
  them once on their hero page; admins can set or clear it. Loops are
  refused.
- **The mother tree** 🌳 on the farm story page (tree button, or
  `/time?view=tree`). Time runs up a trunk made of the story's two vines.
  Each hero is a blossom in their outfit colour on the inviter's branch,
  at the height of their join day, with leaves and a name tag. Ribbons
  show partners, family, friends and teammates. The tree grows as you
  play the story, a golden seed travelling along each new branch. Tap a
  hero for their card: who invited them, whom they invited, how many grew
  from them, and their connections.
- **Woven into the story**: golden arcs over the vine join each hero's day
  to their inviter's. Day cards say "Dana joined the farm, invited by Avi"
  (or "Avi invited Dana and Ben"), with a "🌳 a new branch" chip.
- **Hero pages** show who invited the hero and whom they invited, with a
  link to their branch on the tree.
- **The invite log** (`invite_events`) keeps links opened, joins, players
  added, inviters set later and renewed codes. Admins see it on the
  Account page, `nevet` has a "Tree" line, and `webapp.log` notes who
  invited each new account.

## 2026-10-23 (the terminal dashboard every X minutes)

- `nevet -w` now shows the dashboard again every X minutes. X is the same
  interval as the photos (`sudo ./install.sh X ...`), or the update check's
  when photos are off. Each refresh comes just after a new photo or
  update. `nevet -w 10m` and `nevet -w 30s` pick another interval, and
  `NEVET_REFRESH_MIN` sets the default. Plain `nevet` says how often the
  live view refreshes.

## 2026-10-23 (a farm 4.2 times bigger: fields for the campfire and the party)

- **The farm is 4.2 times bigger** (in ground, so about twice as wide each
  way). One outer fence goes round the farmyard, the play park and two new
  fields. The scenery of all nine lands moved out round it.
- **The campfire field** (east) has the mud arena at about twice the
  size, up to about 20 m across. It has a bigger fire pit, four gates,
  more columns and torches, gladiators' tents, and eight braziers round
  the outside. Dancers keep every gate clear and move round the ring,
  never across the arena.
- **The party field** (west) has a 17 x 15 m dance floor with room round
  every dancer, and a permanent stage: a DJ booth in front of an LED video
  wall (four moving pictures that pulse with the kick), speaker stacks and
  line arrays, a truss with six moving lights and the neon NEVET sign,
  four searchlights, and a big wheel turning behind it.
- **Vivid effects**: flame jets (the arena's braziers on the bell, throws
  and winners, the stage's pyro on the drops), fireworks (in the winner's
  colour, a sky full for the champion, every second drop at the party),
  confetti cannons, neon arches, laser fans from the booth and the truss,
  and rainbow flames for the grand champion. If the device asks for
  reduced motion, the jets, fireworks and cannons stay off.
- **Walking**: heroes jog on long walks between the fields. A hero pushed
  off its route plans a new way instead of walking through things. The
  navigation grid now builds much faster.
- **The camera** stands further back for the campfire, the party and the
  play park, so you can see everyone.
- The yard has a signpost in a ring of flowers where the fire used to be.
  The cart and the chalkboard are back in their old places, and paths
  lead out to both fields.

## 2026-10-22 (the campfire's mud tournament, daylight, a fire in full glory)

- **No fighting in the play park**: it's football, swings, slide, seesaw,
  trampoline and sandbox again.
- **The campfire is the mud arena**: a gladiators' mud ring round a bigger
  fire pit, its size growing with the number of heroes, with the wall,
  columns, torches and gates. Everyone dances round it with the party's
  dances (a new one every 16 beats; the Hora and the Conga move the whole
  ring round, Mayim Mayim steps in to the fire and out).
- **The campfire tournament** (decided on the station): every hero enters;
  groups of three (a pair or a free pass when the numbers don't divide),
  group winners go through, the top two of the last three, then the
  final; the champion gets a ceremony by the fire (hands up, gold sparks),
  then a new tournament starts. It carries on from where it was the next
  time the campfire is on. The Campfire dance now lasts longer in Auto.
- **Stats**: glory (points, +5 per round won, +10 per final, +25 per grand
  victory; just for fun, never XP), grand victories, finals, rounds won,
  grabs, throws, dodges, slips, times thrown; the tournament's bracket
  (no spoilers), the hall of champions and records on the XP tab; glory
  and the tournament on hero pages.
- **Daylight by default**: every activity is in full sunlight, the party
  too. A ☀️ / 🌙 button on the farm switches to night (remembered in your
  browser). The Campfire dance dims to a warm dusk with a sunset sky.
- **The fire**: bigger fire pit with a log tepee on glowing coals, flames
  drawn with a noise shader (and the same flames on the torches), a glow,
  warm light on the ground, embers and sparks, smoke and a flickering
  light. It flares up and dies down smoothly.
- The cart and the chalkboard moved a little west to give the dance ring
  room.

## 2026-10-22 (the fire pit arena, powers and game stats)

- **The arena** moved from the play park to the campfire: a gladiators'
  fire pit with a sand floor (clay for sumo, mud for mud wrestling), a
  sandstone wall with north and south gates, marble columns with torches,
  arches (the board over the north gate, NEVET ARENA over the south),
  banners and shields. Fighters salute and bow at the bell and spar round
  the fire; the fire and torches light up during a bout. The campfire dance
  still happens inside it. The seesaw went back to its old spot.
- **Matches decided on the station** (`games.py`, `/api/games/now`): the
  arena bouts and football matches are the same for everyone watching. The
  station picks who plays (whoever played least lately; never in both at
  once), balanced football teams and every move, goal, save and miss; the
  farm plays it. Matches are only made while someone watches Play.
- **Powers**: Strength, Stamina, Agility, Wisdom and Heart, from real garden
  work (harvests, watering and days active, weeding, check-ups, feeding the
  worms and helping at events), +1 per level and a small class bonus.
  Everyone starts with the same basic powers; nothing can be bought.
- **Fair play**: powers are compressed before a match, luck always counts,
  rookies and heroes on a losing streak get a little spirit, teams are
  balanced. A level-5 veteran wins about half their bouts against two
  newcomers; each newcomer still wins about one in five.
- **Stats**: every bout and match is kept (wins, draws, points, punches,
  pushes, strikes, grabs, throws, knockdowns, dodges, slips, goals,
  assists, shots, saves, goals let in). The XP tab has the arena and
  football leaderboards (7 days, 30 days, all time) and the latest matches;
  hero pages show powers and games; a new page, How powers work, explains
  every number. Tapping a hero on the farm shows their powers.
- Fix: the campfire could show flames when it shouldn't (a 0 instead of
  false for "hidden").

## 2026-10-22 (the ring in the play park)

- **The ring**: a round sparring ring in the play park (the seesaw moved
  a little south to make room). Three heroes wait by the ropes, hop in,
  bow and spar: they circle, close in and swing, hits pop up as comic
  words, a big hit knocks a hero flat with stars (they bounce back up), and
  the most points wins the round. Then everyone bows and climbs out.
- **A new style every round**: giant gloves (blue canvas), sumo suits
  (puffy suits and belts on a clay ring with its straw circle), kendo
  swords (bamboo swords, helmets with face grilles and chest guards on a
  wooden floor) and mud wrestling (a mud floor, slipping, and heroes that
  get muddier with every splash). The floor, apron, ropes and posts change
  with it.
- Fighters wear their corner's colour (red, blue, yellow) on their name tags
  and gear; a board by the ring shows the round, the style and the score;
  banners call the round and the winner; other heroes come to watch and
  cheer. With only two heroes on the farm, they spar one on one.
- The farm's status line shows the ring's round and style.

## 2026-10-21 (events on the dashboard, event QR codes, a pinker-and-greener story)

- **Coming up** on the dashboard: the next events as swipeable cards with
  one-tap 🙌 Going / 🤔 Maybe (no page reload; tap again to take it back),
  "I'm here" for an event that's on, and a QR button.
- **Event QR codes**: every event has a short link `/e/<id>` and a QR code
  (dashboard pop-up, the event page's new Invite card, a downloadable SVG
  and a printable A4 poster). Players who scan land on "Are you coming?";
  people without a hero see the invitation (no names of who's coming), sign
  up or log in, and land on the event. Scans and new heroes are counted per
  event (the event's numbers).
- **Welcome screen**: lists what's coming up, and when an event is less
  than 30 days away the QR code takes turns between joining Nevet and
  joining the event (`e` switches, `a` takes turns again).
- **Our farm story**: a new pink and green palette: the green vine grows
  from deep forest to fresh leaf green towards today, the pink one from
  magenta to petal pink, rose and blush blossoms with gold centres, truer
  pink hearts (the lights no longer wash them violet), pink and green
  floating hearts and pollen, and the page itself (title, card, chips and a
  green-to-pink slider) in the same colours.

## 2026-10-20 (friendlier guides, small fixes)

- **New guides for everyone**: a short README front page with "start here"
  links; `docs/GUIDE.md`, the player guide in plain words; `docs/KIDS.md`
  for young gardeners (with "ask a grown-up" moments and password safety);
  `docs/STATION.md`, all the setup and upkeep from the old README, for
  whoever looks after the station.
- Fix: the event "people there" chart picks a step size that fits the
  event, so multi-day festivals no longer make a chart thousands of steps
  long (labels show the day too).
- Fix: a fob linked to a hero in the recycle bin no longer logs as that
  hero at the gate reader.
- Fix: you can't answer "going" to a cancelled event any more.
- Fix: "Make a tag with it" on a scanned chip picks a hero fob for
  125 kHz chips and a plant tag for NFC stickers.

## 2026-10-20 (tags: NFC, RFID, QR and the Flipper Zero)

- **Tags**: plant tags, whole-farm action cards, event check-in tags and
  hero fobs. A phone tap on an NFC sticker (or a scan of its QR label) opens
  `/t/<code>`: one-tap logging, the whole-farm action, or check-in.
- **Flipper Zero**: download each tag as a Flipper `.nfc` (NTAG215 with the
  link: emulate it to test, or write it to a sticker) or `.rfid` (EM4100
  fob to write onto a T5577); `nevet tags export [--push]` does them all.
- `nevet tags reader`: the Flipper (or a USB card reader) at the gate: hero
  fob, then tags, logged as that hero; a fob alone checks in to the event
  that's on. `nevet tags check` tests tags without logging.
- Tags page with printable QR labels, chips scanned but not linked yet, and
  the latest scans; tag buttons on plant, hero and event pages.

## 2026-10-20 (the welcome screen, XP tab)

- `nevet screen`: a full-screen welcome dashboard for the Pi's display or
  any terminal, with a big QR code to join (opens sign-up, with the invite
  code filled in when needed), three steps, the garden's numbers, the next
  event and what's happening. `nevet screen on` shows it on the Pi's own
  display at every boot (after `sudo ./install.sh` once).
- `/join`: the short link behind the QR code; it counts scans and sign-ups
  from the screen.
- The game stats are now the dashboard's **XP** tab; Events stands on its own.

## 2026-10-20 (events)

- **Events** replace Stats on the dashboard: plan parties, festivals and
  gatherings on the farm, with RSVPs (guests, what you'll bring), volunteer
  tasks, check-ins, a walk-in counter for the gate, a live log, feedback,
  the camera's photos from the event, a numbers card with an arrivals chart,
  and CSV / JSON / GeoJSON downloads.
- Every event has its **own map** over the garden map: stage, dance floor,
  food, camping, parking, keep-out areas, walkways, emergency route, cables,
  entrance, toilets, first aid, water, power and more.
- Events show in Today at the farm, on the Time story, and on the 3D farm
  while they're on.

## 2026-10-15 (five more farm settings)

- New farm settings: **snowy mountains** (snowy pines, snowmen, a log
  cabin, peaks, falling snow), **jungle** (giant trees with vines, a
  waterfall, temple ruins, parrots), **African bushland** (acacias, baobabs,
  termite mounds, giraffes, elephants, zebras, Kilimanjaro), **island
  lagoon** (beach, turquoise lagoon, reef surf, huts on stilts, canoe,
  dolphins, volcano, tiki torches) and **city farm** (sidewalks, a ring road
  with cars, buildings with lit windows at night, rooftop gardens).
- The settings now live in their own file, `static/js/farm-worlds.js`.
- Fixed heroes sometimes getting stuck in a crowd at the gate on arrival
  (during Play they now start in the park).

## 2026-10-15 (a wider farm with a play park, and farm settings)

- **Farm settings**: a globe button on the farm picks the land around it:
  the classic green valley, a **desert oasis** (dunes, palms, cacti, camels,
  tumbleweeds, red mesas), the **seaside** (beach, waves, pier, lighthouse,
  sailboats, gulls) or a **deep forest** (hundreds of pines, ferns,
  toadstools, mossy rocks, deer). Saved for everyone on this Nevet;
  `/farm?world=…` previews one.
- **Play park** outside the gate, and a new activity **Play** (key 5):
  football in two teams with goals, a scoreboard and GOAL! banners, swings,
  a slide, a seesaw, a trampoline, a sandbox with a growing sandcastle, kites.
  The farm's walkable area now reaches out through the gate into the park,
  and the camera can zoom out further.

## 2026-10-15 (animal care, the farm as a live channel)

- New farm activity **Animal care**: heroes feed the worm bins and worm beds,
  scatter grain for the chickens, throw bread to the ducks and smoke the
  beehives, visiting every animal in turn.
- **Live view** (TV button, `/farm?tv=1`): the farm as a 24/7 channel with
  a LIVE badge and clock, activities by the real time of day, a camera that
  follows heroes, and real actions popping up on screen as they're logged.

## 2026-10-15 (an even bigger dance floor)

- The party floor is 8.4 × 7.4 m (was 6 × 7.4): the pond moved east to make room, the truss is wider, and the dancers spread out in up to 5 columns.

## 2026-10-15 (the 909 drum machine)

- The party synth's 909 tab is a little drum machine: all six drums on one
  grid, tap or drag to paint, tap a drum's name to mute it, swing button.
- Switching between 303 and 909 is a plain tap on the tab (it used to be
  easy to hit the mute dot by mistake); tap the active tab again to mute it.

## 2026-10-15 (our farm story)

- **Time** on the dashboard opens the farm's story as a green and pink 3D
  love story: intertwined vines with a blossom for each day and hearts for
  the big moments (first day, heroes joining, connections, groups, first
  plantings and harvests), a story card per day, travel by drag, scroll or
  slider, and a Play button.

## 2026-10-15 (more in the terminal)

- `nevet` shows the **station** (model, CPU temperature and load, memory,
  power problems), all **addresses** (home network, router, outside/internet
  address, Tailscale address and name, public Funnel address, with links),
  the garden's plants by stage, active heroes, harvest, groups, connections,
  map and invite code, and **today at the farm** with the to-do list.

## 2026-10-15 (open to everyone)

- `nevet public on | off | status` opens Nevet to the internet through
  Tailscale Funnel (a public https address, no router changes).
- Safe to be public: sign-ups from the internet need an invite code (Account
  page, admins); the wrong-password lockout and traffic stats see each
  visitor's real address behind the tunnel; secure cookies over https; the
  stats API refuses the default key from the internet.

## 2026-10-15 (the party synth: TB-303 + TR-909)

- A little synth docked above the bottom bar in party mode, opened from the
  top bar: a TB-303 bass line and a TR-909 drum kit (engine from
  kg13-acid-space) with a step grid, knobs, tempo, mutes and a pattern
  generator. It replaces the big Acid Machine panel; the speaker button now
  plays it, and the whole party dances to it.
- More dance floor per hero: the floor is always full size and the dancers
  spread out over it.
- Party mode has a new musical-note icon.

## 2026-10-15 (a bigger, funkier party stage)

- The party stage is sized for the hero roster: a bigger dance floor (up to
  19 dancers plus the DJ), and the farm now brings up to 20 heroes.
- The DJ booth moved to the far end of the floor under a truss with chasing
  LEDs and a neon NEVET sign; new lasers, moving spotlights, fog, a bigger
  disco ball, six floor light patterns with tiles that pop on the kick, and
  a dance-off spotlight that picks a soloist every 8 beats.
- The stage only blocks heroes' paths during the party, so the other
  activities walk through the yard as before.

## 2026-10-14 (many plants at once)

- **Add many plants** from a typed list ("olive x 5, mint x 3, ..."), with a
  preview to fix names, counts, varieties and 3D models. Each becomes its
  own plant with a planting log; pick a garden-map bed to pin them there.
- The farm shows up to 80 plants (the most recently tended), and its
  default beds hold two or three rows when there are many.
- "Bishop's crown" peppers are drawn as chili peppers.

## 2026-10-14 (today at the farm)

- The dashboard shows **Today at the farm**: today's logged actions and a
  to-do list (thirsty plants, hungry worms, ripe plants, seeds to check,
  connections to confirm), each with a one-tap button to log it. It pops
  up after logging in and on the first visit of each day.

## 2026-10-14 (DJ booth: the acid synth)

- Party mode has a **DJ booth**: the Acid Machine (kg13-acid-space) opens in
  a panel, and the party follows it: tempo and beat, kick, accents, filter
  and resonance, with floating note names and tips that teach what each
  part of the pattern does.
- **Companion repos** (`config/extra_repos.conf`): the update check also
  keeps the acid synth up to date in `~/nevet-extras/acid`, served at
  `/extras/acid/`. New script `scripts/update_extras.sh`.

## 2026-10-07 (family and groups)

- The Locs hairstyle now stands up in pointed locs like a pineapple crown.

- Connections need the other person's confirmation (badge by their name, Confirm or Decline on their profile).
- **Family & connections** on each profile: parents and children, husband
  and wife, partners, siblings, grandparents, guardians, friends,
  neighbours, volunteers and more, shown from both sides.
- **Groups**: households, families, couples, community gardens and volunteer
  teams, with coordinators and members; open groups can be joined.
- New tables `relationships`, `groups`, `group_members` (created in place on
  existing databases).

## 2026-10-07 (party dances)

- Party mode now rotates through 14 dances, one after another: Disco,
  Pogo, Voodoo, Yemenite step, Robot, Chicken dance, The sprinkler, Twist,
  Running man, Hands up, and the Israeli folk dances Hora, Mayim Mayim and
  Debka, plus the Conga line. The title shows the current dance.

## 2026-10-06 (your garden on the farm)

- The farm builds its garden from the **garden map**: beds in their real
  shapes with plants where they were pinned, worm beds, compost,
  greenhouse, pond, orchard, lawn, wildflowers, walkways, fences, drip
  lines, taps, beehives, trees, rain barrels, sheds, benches and the Nevet
  node. With nothing drawn yet it keeps its default beds.
- New map area type: **Worm bed**. On the farm, the more worm feedings
  this month, the more worms.
- Plants not watered for 3+ days droop and show a water drop; heroes water
  those first, and refill at the garden's taps too.
- A chalkboard in the farm yard shows this week's real numbers.

## 2026-10-06 (plants in 3D)

- **3D plant models** for about 90 species (tomatoes, cherry tomatoes,
  peppers, mint, basil and the other herbs, greens, roots, squash and
  melons, beans, corn, flowers, berries, fruit trees, palms, succulents,
  mushrooms, microgreens, compost worms, bees), each at every growth
  stage from seed to harvested and dried.
- Nevet works out which plant it is from the name and variety (English
  or Hebrew); pick a different one on Add a plant (with a live preview)
  or on the plant's page.
- Plant page: turn the model, tap a stage to see the plant from seed to
  harvest. Plants page: the 3D garden uses the real models (it also
  works again: it stopped drawing on its first frame), and every row has
  a small picture.
- The farm's beds, greenhouse and new field grow the real models too.

## 2026-10-06 (party mode, no more bumping)

- **Party!** on the farm, next to the campfire: dance floor with flashing
  tiles, string lights, disco ball and beams, balloons, confetti and music
  notes; the player who opened the farm is the DJ, everyone else grooves in
  their own style, does group moves and forms conga lines. Optional synth
  beat with the speaker button.
- Heroes no longer bump into things or each other: routes are planned on a
  navigation grid around beds, buildings, the cart, campfire and pond; work
  spots are reserved; heroes steer around each other and re-plan if stuck.
- Only the heroes come to the farm: companion pets stay home.

## 2026-10-06 (the farm)

- Tap the brain on the dashboard to visit **the farm**: a full-screen 3D
  farm where all heroes walk in through the gate and do group activities
  together: harvest festival, watering round, planting day and a
  campfire dance at night. Auto mode cycles through them.
- The farm has the garden's real plants (with name signs) and worm bins,
  a barn, windmill, greenhouse, pond with ducks, chickens, butterflies,
  fireflies, drifting clouds and stars. Follow a hero by tapping them;
  save a photo with the camera button.
- Heroes now swing their legs when they walk, and heroes and farm props
  are merged into far fewer draw calls so 16 heroes run smoothly.
- The About popup now opens from the ⓘ button; a hint shows "Tap the
  brain to visit the farm" until the first visit.

## 2026-10-03 (simpler top bar, mycelium hub)

- The row of section links under the top bar is gone: every section is
  on the dashboard hub, and the Nevet logo leads back to it.
- The About popup is much more compact: one line about Nevet, the
  garden's numbers, what's new and the version.
- New hub look: fine mycelium threads braid out from the brain to each
  section, with tiny spores, flowing colour and sparks of light
  travelling out like signals.

## 2026-10-02 (garden map, living hub, more hair)

- New **Garden map** page: street map or satellite view, place search and
  "my location", zoom down to single beds. Draw beds and areas, paths and
  irrigation lines, drop points (tap, compost, tree, tool shed, beehive,
  Nevet node...), pin plants and worm bins. Edit names, types, colours,
  notes and shapes; delete with Undo and a Recently removed list; areas in
  m² and dunams, lines in metres; show/hide by kind; download as GeoJSON.
  The admin saves the garden's spot so the map opens there.
- Plant pages link to the map; the dashboard hub has a Map bud.
- Read-only `/api/map.geojson` (with the API key) for other programs and,
  later, other Nevet gardens.
- Dashboard vines come alive: waves of colour flow from the brain to each
  section, branches sway and leaves catch the light.
- Tap the brain (or ⓘ) for **About Nevet**: the garden's numbers,
  version, what's new and links.
- 12 new hair styles: long dreadlocks, punk spikes, mullet, pompadour,
  beehive, powdered wig, samurai top knot, victory rolls, space buns,
  flat-top, viking braids and curtains.

## 2026-10-02 (gender, recycle bin, more hero items, plant hub)

- Gender for heroes: female, male, non-binary, other or not specified
  (the default). It sets the body shape and small face details, and
  shows on the hero page.
- Delete a hero: players delete their own (password needed), the admin
  any hero except the last admin. Deleted heroes go to a **Recycle bin**
  (admin): restore with everything, delete for good (garden history is
  kept, credited to nobody), or empty the bin.
- More customizing: 4 new eye styles (shades, dizzy, puppy, monocle),
  4 mouths, 4 facial hair styles (chevron, soul patch, sideburns, wizard
  beard), earrings (new slot), 8 hats, 7 extravagant outfits, 7 funny
  tools and 6 backs including a flickering jet pack and an aqualung.
  Some items move (propeller, jet flames, flapping wings, bubbles,
  sparkles, disco shimmer).
- New **Companion** tab: 4 new companions (frog, chick, ladybug,
  hedgehog), plus name, colour, size and accessory for any companion.
- Dashboard: the lines around the brain are now vines with leaves; each
  section is a bud, and the highlighted one blooms while its vine grows
  out again. Softer garden backdrop and icon chips for the plant counts.
- Existing heroes look exactly the same (new settings start at their
  defaults).

## 2026-10-01 (hero variety and movement)

- Many more hero options (companions unchanged): 9 new hair styles
  (ponytail, pigtails, side braid, bob, side swept, curly, afro, locs,
  buzz cut), new hair, skin, eye and outfit colours, 4 new eye styles
  (starry, hearts, fierce, glasses), 4 new mouths, a new Facial hair
  category (stubble, mustache, handlebar, goatee, full beard), 10 new
  head items (backwards cap, trucker cap, bucket hat, bandana, sweatband,
  beret, ranch hat, beekeeper veil, acorn helmet, harvest crown), 7 new
  outfits, 6 new tools and 5 new back items.
- Existing heroes keep their exact look: default looks only pick from
  the original options, and the new facial hair starts at "None".
- Heroes move: idle breathing and sway, blinking, and an emote every
  4-9 seconds (wave, look around, hop, tool swing, fist pump, nod,
  twirl, stretch, cheer). Tools move with the hand. Tap a hero to make
  it emote; a hop when trying on items in the customizer. Reduced-motion
  settings are respected.

## 2026-10-01 (IPv6)

- The web app also listens on IPv6 when the system supports it (falls
  back to IPv4 only otherwise), so it still answers when the WiFi gives
  the Pi no IPv4 address.
- `nevet` shows the Pi's IPv6 address to open when there's no IPv4
  address on the home network; long addresses are never cut off.

## 2026-10-01 (PC / Ubuntu Server)

- Installs on a regular PC with Ubuntu Server: tested on Ubuntu 24.04
  (Python 3.12, Flask 3.0) and the 22.04 Flask 2.0 stack.
- Watchdog reconnects through systemd-networkd (`networkctl reconfigure`,
  then a networkd restart) when NetworkManager isn't installed; shows
  WiFi signal in dBm without NetworkManager and no signal for a cable.
- `nevet` and `nevet net` show and test cable adapters (eth0, enp3s0...),
  hide Docker/VM bridge addresses, and give camera-aware install hints.
- Tailscale timestamps with nanoseconds parse on Python 3.10.

## 2026-09-30 (Tailscale, WiFi diagnosis)

- New `nevet ts`: step-by-step remote access check (installed, service,
  logged in, address, key expiry, web app on the Tailscale address,
  UDP/relay path, your devices online) with the exact fix for each step
  and how to open Nevet from a phone.
- `nevet` shows a Tailscale row and the MagicDNS address; hints now
  wrap instead of being cut off on phone screens.
- Watchdog restarts `tailscaled` if it stops and logs Tailscale state
  changes; install.sh enables tailscaled and prints the Tailscale URL.
- Faster WiFi recovery: NetworkManager restart from the 3rd failed check
  (was the 5th), repeated every ~8 min.
- IPv6-only detection: when the WiFi gives no IPv4 address the watchdog
  logs it and reconnects for a new lease; `nevet` warns, and
  `nevet net` tests over IPv6 instead of giving up.
- `nevet` / `nevet net` point out USB WiFi adapters Linux has no
  driver for; `nevet net` lists networks in range and suggests a clearly
  stronger saved network.
- health_report.sh includes Tailscale.

## 2026-09-30 (no camera, USB WiFi antenna, traffic)

- Camera is optional. Photo/video capture checks for the camera first:
  without one it logs "photos paused" once (not a failure every 5
  minutes) and resumes by itself when a camera is plugged back in.
  `sudo ./install.sh off 15` turns the timelapse off. The watchdog logs
  camera plug/unplug and no longer warns about a stopped timelapse you
  turned off; `nevet` shows Camera "not connected" and Timelapse "off"
  in grey instead of as problems.
- Multiple WiFi adapters: the watchdog detects USB antennas, checks and
  reconnects whichever adapter carries the internet, logs it
  ("via wlan1 (USB) signal=78% rate=... router=3.1ms"), and turns power
  saving off on every adapter. install.sh allows reconnects on wlan0-3.
- New `nevet net`: tests every connected adapter (router and internet
  ping, packet loss, 5 MB download), compares them, logs results to
  `logs/network.log`. `--quick` skips the download.
- New `scripts/wifi_antenna.sh usb`: makes the USB antenna the main
  connection, built-in WiFi stays connected as a backup; `undo` reverts.
- Web app traffic accounting: requests and bytes sent/received per day,
  by type and by home network / Tailscale, in the new `web_traffic`
  table (buffered, written every 30 s and on shutdown); daily totals in
  webapp.log.
- `nevet` gained Network (adapters, router ping, last speed test, data
  since boot) and Web app traffic (today / yesterday / 7 days, by type
  and connection) sections; the addresses list shows which adapter each
  address belongs to.
- health_report.sh reports every WiFi adapter, not just wlan0.

## 2026-09-30 (terminal status)

- New `nevet` command (installed by install.sh): coloured status summary
  for SSH — system health with fix hints, website addresses, last 24 h
  counts, garden totals, latest 5 garden actions and system events.
  Fits phone-width terminals; `-n N`, `-w` live view, `--no-color`.

## 2026-09-29 (activity)

- Log in with one tap: saved players appear as hero portraits (last
  player on the device first), then just the password.
- Every action records who did it. Older logs are credited to the
  plant's owner.
- "Log an action" screen (floating Log button on every page): pick the
  action (watering, pruning, fertilizing, weeding, pest control,
  feeding worms, harvest, sprouted, transplant, check-up, gave away),
  one or more plants or the whole garden, and optional amount, growth
  stage, note. Shows XP gained and level-ups.
- "Add a plant" (plant or worm bin, sown or planted) counts as your
  planting action.
- Dashboard: garden activity for Everyone or Just me — totals, actions
  by type, actions per day (14 days), growing now / grown before,
  latest actions, and a by-player table. Only the last 3 photos.
- Hero profiles: growing now, grown before, actions by type and per
  day, latest actions. XP now counts actions the player did.
- New Activity page: full history filtered by player, action, plant
  and period. Plant pages show who did what.
- Harvest no longer marks a plant finished unless "last harvest" is
  ticked; planting/sprouting only move a plant forward, never back.
- Nav: Activity, Heroes, Gallery, System; two rows on phones.
- FIX: fix_orientation.sh let ffmpeg swallow its file list, so a batch
  run flipped only the first file(s). Now uses -nostdin, records what it
  flipped (never flips twice) and takes `--before DATE`.
- Cleanup: removed the old add-asset / log-event forms, unused
  functions and styles; docs updated to match the app.

## 2026-09-28 (accounts)

- Real log-in: each player has a hero name + password (salted hash);
  the old single shared password (`WEBAPP_PASSWORD`) is gone. Every page
  now needs a log-in except `/healthz` and the API-key stats endpoint.
- Sign up creates your hero, or claims an existing hero without a
  password (so `M` keeps its plants). First account is admin.
- Players edit only their own hero; admin can edit any and set a new
  password for players who forget. `scripts/users.py` does the same
  from the terminal (list, reset-password, make-admin).
- Account page to change password; log out; "Add a player" for adding
  family members while staying logged in. `WEBAPP_OPEN_SIGNUP=false`
  limits sign-up to logged-in players.
- Security: form tokens (CSRF), SameSite cookies, 30-day sessions,
  pause after repeated wrong passwords, no open redirects, and a random
  session key is generated if `.env` still has the placeholder.
- "Play as" replaced by the logged-in player.

## 2026-09-27 (auto-update)

- New `scripts/auto_update.sh` + `nevet-update.timer`: checks GitHub every
  N minutes (second installer argument, like the photo interval:
  `sudo ./install.sh 5 15`, or `off`), pulls new versions, restarts the
  web app when needed and rolls back automatically if it doesn't come
  back healthy. Never overwrites local edits; quiet when offline.
- `--check` mode to see whether an update is waiting without changing
  anything.
- Updates panel on the Logs page; update.log rotated weekly.
- install.sh validates the interval arguments and fixes repo file
  ownership (a `git pull` run as root breaks later pulls).

## 2026-09-27 (heroes)

- Growers are now RPG heroes. Create one with just a username (no
  password), pick a class (Gardener, Worm Tamer, Forager, Beekeeper,
  Druid) and customize looks (skin, hair, eyes, mouth, colours) and
  gear (head, outfit, tool, back, companion) with a live 3D preview.
- Heroes are drawn procedurally in 3D (`static/js/hero3d.js`) from
  `static/assets/heroes/catalog.json`; items have rarities like an RPG
  inventory. Real icons can replace drawn ones via an `icon` field.
- Character-select roster, hero profile with level and XP earned from
  real farm activity (logs, harvests, plants), and "Play as" to pick
  your hero; the nav shows who you're playing.
- Existing growers keep their data and get a unique default look.
- Farm records (assets, logs) still need the admin login.

## 2026-09-24 (reliability)

- FIX: watchdog judged "offline" by ping only, so on networks that block
  ping it bounced a working WiFi connection every 2 minutes. It now uses
  HTTP/TCP checks and tells apart "link down" (reconnects) from
  "internet down but WiFi fine" (leaves WiFi alone).
- Reconnect escalates: device reconnect -> WiFi radio off/on ->
  NetworkManager restart (at most every ~10 min). Never reboots.
- Web app self-heal: watchdog checks /healthz and restarts the app if
  it stops answering twice in a row. systemd never gives up restarting.
- Web app now served by waitress (production server) instead of Flask's
  development server.
- WiFi power saving turned off permanently (common Pi 3B dropout cause).
- Watchdog log now includes under-voltage, temperature, free memory and
  disk use on every check.
- New scripts/health_report.sh: one-screen diagnosis.
- install.sh no longer aborts when offline; sudo rules for the watchdog
  are limited to exact commands and validated with visudo first.

## 2026-09-24

- Watchdog no longer reboots the Pi. It logs and retries WiFi forever;
  timelapse capture and the database keep working offline.
- New `captures` table: every photo/video is recorded in farm.db
  (kind, path, time, size, timelapse/manual, online/offline).
  `scripts/backfill_captures.py` imports existing files.
- New `webapp/static/assets/` folder (icons, textures, models, sounds),
  served live with no restart.
- Shared `static/js/nevet3d.js` helper for 3D views (WebGL fallback,
  theme colours, labels, battery-friendly pause when tab hidden).
- 3D Garden on the Assets page: each plant drawn by its life stage,
  drag to rotate, pinch to zoom, tap to open.

## [0.1.0] — Initial release

First public version of the repo. Everything below shipped together as
part of this initial release.

### Camera capture
- `capture_photo.sh` — timestamped, incrementally numbered photo
  capture, organized into per-day folders, with a burned-in visible
  timestamp overlay. Retries once if the camera hands back a corrupt
  first frame (a known UVC quirk right after opening the device).
- `capture_video.sh` — same pattern for video clips; the camera's
  native H264 stream is copied directly (no re-encoding) with the
  timestamp embedded as container metadata.
- `test_camera_scripts.sh` — end-to-end validation: checks the
  environment, performs a real photo and video capture, verifies file
  validity and counter increments.
- Confirmed the Insta360 Air works as a standard UVC webcam over USB
  on the Raspberry Pi 3B (`/dev/video0`, MJPEG up to 3008x1504, H264 at
  1920x960 — no vendor SDK required).

### Automation and reliability
- `nevet-timelapse.timer` — automatic periodic photo capture
  (configurable interval, default every 5 minutes).
- `wifi_watchdog.sh` — checks internet connectivity every run, logs
  every check (latency + WiFi signal strength, not just failures),
  retries WiFi reconnection via `nmcli`, and reboots the Pi as a last
  resort after 3 consecutive failed cycles. Also does a lightweight
  health check of the camera device and other services each run.
- All long-running processes run as systemd services/timers
  (`nevet-webapp`, `nevet-timelapse`, `nevet-watchdog`) with
  `Restart=always` / timer-triggered scheduling, so they survive SSH
  disconnects and reboots without manual restarting.

### Web app
- Flask app (`webapp/app.py`) serving:
  - a photo/video gallery grouped by date, with asset counts and total
    storage used;
  - a session-based login gating the stats and logs pages;
  - a live log console at `/logs` — three color-coded, auto-refreshing
    panels (watchdog / capture / webapp);
  - a game stats dashboard at `/stats` (XP, time played, compost,
    credits, plant growth), backed by a SQLite `stats_log` table;
  - `webapp/game_stats.py`, an importable helper plus a `POST
    /api/stats` HTTP endpoint for logging stats from game code.
- Simple, friendly dashboard mockup design (central hub with satellite
  data nodes, top tab bar, physical 3-button + jog-dial control bar)
  with a working light/dark theme toggle.

### Logging
- `scripts/lib/log.sh` — shared timestamped logging helper used by all
  shell scripts.
- Dedicated runtime log directory (`~/camera_captures/logs/`):
  `capture.log`, `watchdog.log`, `webapp.log`.
- `webapp/logging_config.py` — rotating file handler for the Flask
  app's own log.
- `config/nevet-logrotate.conf` — weekly rotation for the
  bash-generated logs, installed to `/etc/logrotate.d/nevet`.

### Project structure
- Proper repo layout: `scripts/`, `webapp/`, `systemd/`, `config/`,
  `docs/`, `install.sh`, `.gitignore`, `LICENSE` (MIT), `README.md`.
- Systemd unit files as versioned templates
  (`__USER__`/`__HOME__`/`__REPO_DIR__` placeholders) rendered by
  `install.sh`, rather than generated ad hoc.
- `config/.env.example` — secrets template; `.env` itself git-ignored.
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/TROUBLESHOOTING.md`.

## Tooling note
- Claude (this chat) now has direct push access to this repo via a
  scoped, repo-limited fine-grained token, so future changes can be
  committed and pushed here directly, ready for `git pull` on the Pi.
