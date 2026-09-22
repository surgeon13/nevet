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
(not just failures) to `logs/watchdog.log`, including latency and
signal strength — e.g. `OK  latency=14ms signal=78%` vs
`FAIL no response from 8.8.8.8 (signal=?%)`. Patterns worth checking in
that log:
- Signal strength dropping toward 0% before failures → range/interference issue.
- Failures with signal still reported high → likely a driver/power-saving
  issue rather than range (worth trying `iwconfig wlan0 power off` to
  disable WiFi power management, a known flaky-reconnect cause on the Pi 3B's
  onboard adapter).
- Failures clustered at regular intervals → check for a scheduled task or
  another device causing interference/DHCP churn on the network.

If it fails 3 consecutive checks (~6 minutes), the watchdog reboots the
Pi automatically as a last resort; all three services come back up on
their own after boot.

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
