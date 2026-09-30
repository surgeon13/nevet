# Troubleshooting

Real issues hit while building this project, and how they were resolved.

## Camera

**`v4l2-ctl --list-devices` shows two `/dev/video*` nodes for the Insta360 Air**
Only one is a real capture device. Check both with
`v4l2-ctl -d /dev/videoN --list-formats-ext` — the one that returns MJPEG/H264
formats is the capture device (`/dev/video0` in this project); the other
returns nothing and isn't usable for stills/video.

**`ffmpeg` reports "The specified filename does not contain an image sequence pattern"**
`ffmpeg`'s `image2` muxer treats a `.jpg` output path as a sequence
pattern by default. Fix: add `-update 1` to write a single file instead
(already applied in `capture_photo.sh`).

**Captured photo shows `overread` / `EOI missing, emulating` in ffmpeg's output**
Usually cosmetic — ffmpeg patched a slightly short JPEG frame and the
result is still valid. If a capture comes back genuinely corrupt (not
recognized as JPEG by `file`), it's almost always the *very first*
frame grabbed right after opening the device, before the UVC stream has
stabilized. `capture_photo.sh` already handles this: it grabs 5 frames
with `-update 1` (keeping only the last), and retries once more if the
result still isn't valid.

**`ioctl(VIDIOC_QBUF): Bad file descriptor` / `Some buffers are still owned by the caller on close`**
Harmless v4l2 buffer-cleanup noise on process exit. Not an error signal
by itself.

**`drawtext` filter fails with `No option name near '52:53:...'`**
The timestamp text (e.g. `14:52:53`) contains colons, and ffmpeg's
filter syntax also uses `:` to separate filter options — so an
unescaped colon in the text breaks parsing. Fix: escape colons in the
overlay text (`sed 's/:/\\:/g'`) before passing it to `drawtext`
(already applied).

## Web server / networking

**`OSError: [Errno 98] Address already in use` on port 8000**
Something's already bound to that port — usually a previous manual
`python3 -m http.server` or `mjpg_streamer` left running in another
session. Find and stop it:
```bash
sudo fuser -k 8000/tcp
```
This shouldn't come up anymore once everything runs via
`nevet-webapp.service` instead of manual foreground commands, since
systemd owns the port consistently.

**`BrokenPipeError: [Errno 32] Broken pipe` in the web server's logs**
The client (browser/phone) disconnected mid-response — they closed the
tab, lost signal, or navigated away while a file was still being sent.
Cosmetic; the server keeps running and serving other requests fine.

## WiFi

**Pi keeps dropping off WiFi**
`nevet-watchdog.timer` runs every 2 minutes and logs every check
(not just failures) to `logs/watchdog.log`, including the adapter,
signal, link rate and router ping — e.g.
`OK  online via wlan1 (USB) signal=78% rate=72.2Mb/s router=3.1ms ...` vs
`FAIL WiFi link down ...`. Patterns worth checking in that log:
- Signal strength dropping toward 0% before failures → range/interference
  issue: a USB WiFi antenna helps (see README, "Network and the USB WiFi
  antenna"); `nevet net` measures the difference.
- Failures with signal still reported high → likely power (check
  `nevet` for under-voltage) or a driver issue. Power saving is turned off
  on every adapter by install.sh and the watchdog.
- Failures clustered at regular intervals → check for a scheduled task or
  another device causing interference/DHCP churn on the network.

The watchdog never reboots the Pi: it reconnects the adapter, then
toggles the WiFi radio, then restarts NetworkManager (from the 3rd
failed check, then every ~8 minutes).

**USB WiFi antenna plugged in but not used**
`nevet` shows each adapter; one marked "standby" or "not connected"
isn't carrying traffic. `sudo ~/nevet/scripts/wifi_antenna.sh usb` makes
it the main connection (built-in stays as backup). If it isn't listed at
all, check `lsusb` and `ip link`: the dongle may need a driver that isn't
in Raspberry Pi OS.

**USB WiFi adapter shows in `lsusb` but never becomes `wlan1`**
Linux has no driver for its chip; it can't be used on the Pi (the
Windows-driver workaround ndiswrapper doesn't run on ARM). Known examples:
Netgear WNA3100 v1 (Broadcom BCM43231), Linksys WUSB300N (Marvell
88W8360). See README for chips that work, or use a WiFi extender.

**`ip route show default` is empty / `nevet` says "IPv4 none"**
The WiFi didn't give the Pi an IPv4 address (weak signal, or a guest
network that ran out of addresses) but IPv6 works, so the Pi looks
"online" while GitHub updates fail and the `10.0.0.x` address is gone.
The watchdog reconnects to ask for a new address; by hand:
`sudo nmcli device reconnect wlan0`. A stronger signal fixes it for good.

**Can't open Nevet from outside / Tailscale never connects**
Run `nevet ts`. It shows whether the Pi is logged in, its `100.x`
address, key expiry, whether the web app answers there, and which of your
devices are online in Tailscale. The phone must run the Tailscale app,
switched on, logged in to the same account. On guest WiFi, devices on the
same network often can't see each other at all; Tailscale works anyway.

**After disconnecting the camera**
Nothing breaks: the web app doesn't use the camera. Photos pause (one
"Camera not connected" line in `capture.log`) and resume when it's
plugged back in. To stop the timer entirely: `sudo ./install.sh off 15`.

## Git / GitHub

**`fatal: unable to auto-detect email address` on `git commit`**
Git needs an identity configured before it can make a commit:
```bash
git config --global user.email "you@example.com"
git config --global user.name "Your Name"
```
If you skip this, the commit silently doesn't happen — later steps
like `git push` then fail confusingly (`main` doesn't exist yet
because nothing was ever committed).

**`git push` asks for a password and rejects your GitHub account password**
GitHub no longer accepts account passwords for git operations over
HTTPS. Use a personal access token instead: GitHub → profile picture →
**Settings** → **Developer settings** → **Personal access tokens** →
**Tokens (classic)** → **Generate new token** (`repo` scope). Paste the
token as the password when prompted.

**`git push` rejected as non-fast-forward / "fetch first"**
The remote repo has commits your local copy doesn't (e.g. it was
initialized on GitHub with a README). Either:
```bash
git pull origin main --allow-unrelated-histories   # merge, resolve conflicts
```
or, if you deliberately want your local version to replace what's on
GitHub:
```bash
git push --force
```
Use `--force` deliberately — it discards the remote's current content.

## systemd

**Changed a `.service`/`.timer` file but nothing changed on the Pi**
Re-run the installer (safe to re-run any time — it doesn't touch your
captured data) and reload systemd:
```bash
sudo ./install.sh 5
sudo systemctl daemon-reload
sudo systemctl restart nevet-webapp nevet-timelapse.timer nevet-watchdog.timer
```

**Checking whether something's actually running**
```bash
systemctl status nevet-webapp.service
systemctl status nevet-timelapse.timer
systemctl list-timers nevet-timelapse.timer nevet-watchdog.timer
journalctl -u nevet-timelapse.service -f
journalctl -u nevet-webapp.service -f
```


## The Pi keeps going offline / web app unreachable

1. Run `./scripts/health_report.sh` and read the **Power** section first.
   "under-voltage" means the power supply or cable is too weak; the Pi 3B
   needs a real 5V 2.5A supply, and a USB camera adds load. This is the
   most common cause of random WiFi drops and no software can fix it.
2. Check the watchdog log: `tail -50 ~/camera_captures/logs/watchdog.log`
   - `FAIL WiFi link down` - the Pi lost WiFi; watchdog reconnects itself.
     Frequent ones with low signal (< 40%) mean the Pi is too far from
     the router.
   - `WARN WiFi+router OK but no internet` - your router/ISP is down or a
     guest network wants a login page. The Pi is still reachable on the
     local network.
   - `FAIL web app not responding` - the watchdog restarts it after two
     misses in a row.
3. Test the watchdog without changing anything:
   `NEVET_WATCHDOG_DRY_RUN=1 ./scripts/wifi_watchdog.sh`

## Can't log in / forgot password

- No account yet: open the web app, tap **Sign up**. The first account
  is the admin. Signing up with an existing hero's name (e.g. `M`)
  claims it if it has no password yet.
- Forgot password: the admin can set a new one on that player's hero
  page. If the admin forgot theirs, on the Pi run (as your normal user):
  `python3 scripts/users.py reset-password NAME`
- "Too many wrong tries": wait 5 minutes, or restart the web app
  (`sudo systemctl restart nevet-webapp`) to clear it.
