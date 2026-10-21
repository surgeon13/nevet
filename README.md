# Nevet 🌱

**Nevet is a garden game for real gardens.** You do the work in the
garden, tell Nevet what you did, and your hero levels up. Everyone's
watering, planting and picking adds up on one shared farm, and all the
heroes come out to play together on a little 3D farm.

It's made for small groups who grow things together: families with
children, couples, housemates, community gardens and volunteer teams.
It runs on a small computer in the garden (a Raspberry Pi), and everyone
plays from their phone's web browser. No app to install.

## Start here

| I want to... | Read this |
|---|---|
| **Play**: join, make a hero, log what I did | [Player guide](docs/GUIDE.md) |
| **Show a child** how it works | [Nevet for kids](docs/KIDS.md) |
| **Set up or look after** the station in the garden | [Station guide](docs/STATION.md) |
| **Fix** something that isn't working | [Troubleshooting](docs/TROUBLESHOOTING.md) |
| **Change the code** | [Architecture](docs/ARCHITECTURE.md) and [API reference](docs/API.md) |
| See **what's new** | [Changelog](CHANGELOG.md) |

## Join in three steps

1. Scan the QR code on the garden's welcome screen with your phone camera
   (or open the address someone shared with you).
2. Pick a hero name and a password.
3. After you do something in the garden, tap **Log an action**.

That's all you need. Everything else is extra fun: dress up your hero,
draw the garden on a map, plan a party, or tap a sticker on a plant to log
in one go.

## What's inside

- 🧑‍🌾 **Heroes** you dress up however you like, with a pet companion,
  levels and XP earned from real garden work.
- 🪴 **Plants** shown as 3D models at the stage they're really at, from
  seed to harvest, about 90 kinds, in English or Hebrew.
- ✅ **Today at the farm**: what got done today and what needs doing
  (thirsty plants, hungry worms, ripe fruit).
- 🗺️ **A garden map** on real streets or satellite photos, where you draw
  beds, paths, taps and trees.
- 🚜 **A 3D farm** where all the heroes harvest, water, play football,
  feed the animals and party, in nine different lands (desert, seaside,
  snowy mountains, jungle, a city...). It can run as a live channel on a TV.
- 🎈 **Events** for parties, festivals and work days: the next ones on the
  dashboard with one-tap "Going", a QR code and printable poster to invite
  people, volunteer jobs, a map of the site, check-ins and photos.
- 🏷️ **Tags**: stickers and QR labels on plants. Tap one with a phone and
  the job is logged.
- 💚 **Family and groups**, connected only when both people say yes.
- 📖 **Our farm story**: the garden's whole history as two vines growing
  together.

## Setting it up (short version)

You'll need a Raspberry Pi 3B (or an old PC with Ubuntu) connected to the
internet, and someone happy to type a few commands:

```bash
git clone https://github.com/surgeon13/nevet.git
cd nevet
sudo ./install.sh
```

Then open the web address the installer prints and sign up: the first
account becomes the admin. After that, Nevet updates itself. Type `nevet`
in the terminal any time to see how it's doing. The
[station guide](docs/STATION.md) walks through every step, including the
camera, opening Nevet from outside the garden and the welcome screen.

## Being kind with data

Nevet keeps the garden's data on the garden's own computer. Passwords are
never stored in a readable form. Family connections stay private until
both people agree. The welcome screen by the garden shows only hero
names and what was done, never passwords, emails, notes or family links,
so pick a hero name you're happy for visitors to see. Please only use tag readers on stickers and fobs that
belong to you or your garden.

## License

MIT, see [LICENSE](LICENSE).
