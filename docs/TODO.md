# To do later

Ideas we've agreed on but parked for now. When you pick one up, move it to the CHANGELOG once it's done.

## Code health

- **Split the 3D farm into parts.** `webapp/static/js/farm3d.js` is over 5,000 lines in one file. Break it into
  modules (the layout and paths, the yard, the arena and its fold, the rave stage, heroes and their walking, the
  activities, the camera) so changes are quicker and less risky. The tests (`tests/test_farm.py`) check the farm
  still runs every activity, so do it step by step with them green.

## Suggested, not scheduled yet

- **Nightly database backup.** Everything lives in one SQLite file on the Pi's SD card. A nightly snapshot
  (`sqlite3 farm.db ".backup ..."`) kept for a week, copied to the Ubuntu PC or a USB stick.
- **The worm farm monitor in Nevet.** Readings from the ESP32 (weight, temperature, humidity, pH) on each worm
  bin's page, the bin's colour on the 3D farm when it's too hot or dry, and "log this feeding?" when the weight
  jumps. XP still only from what people log.
- **Keep weighed XP fair.** A daily cap on the kilograms each bin or plant counts for XP, and unusual weights
  flagged for the admin.
- **A lighter 3D mode for older phones and the TV**, then raising the 20-hero limit on the farm.
