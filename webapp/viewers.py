"""Viewer mode: people without an account can look around Nevet without taking part.

A visitor who isn't logged in gets the dashboard's brain, the 3D farm with every activity, the farm story,
the leaderboards, heroes, plants, activity and events, as a viewer: they can't change anything (every form
asks them to join or log in). Private things stay hidden from viewers:

- camera photos and videos (unless an admin allows them: "guest_photos"),
- notes people wrote on their actions, and whom produce was given to,
- family connections and groups (on hero pages and in the farm story),
- invite links and codes, tags, the garden map (where the garden is), events' guest lists,
  the system pages, accounts.

An admin chooses who may look around on the Account page ("guest_view"): everyone (the default),
only people on the home WiFi or Tailscale, or nobody (the login page, as before).
"""
import farm_db
import netaccess

GUEST = {"id": 0, "name": "Guest", "is_admin": False, "guest": True}   # g.user for a viewer: no hero has id 0

# Pages a viewer may open (GET only). The farm page's live updates and the games it shows come along.
ENDPOINTS = {
    "hub", "farm_page", "api_farm_live", "api_games_now", "extra_file",
    "time_page", "stats", "powers_page",
    "growers_page", "grower_page", "activity", "assets_page", "asset_page",
    "events_page", "tag_landing",
}
PHOTO_ENDPOINTS = {"gallery", "media"}

MODES = {
    "everyone": "Anyone can look around",
    "home": "Only on the home WiFi and Tailscale",
    "off": "Nobody: visitors see the login page",
}


def mode():
    m = farm_db.get_setting("guest_view")
    return m if m in MODES else "everyone"


def photos():
    return farm_db.get_setting("guest_photos") == "on"


def allowed(addr):
    """May a visitor from this address look around without an account?"""
    m = mode()
    return m == "everyone" or (m == "home" and not netaccess.from_internet(addr))


def viewable(endpoint):
    return endpoint in ENDPOINTS or (endpoint in PHOTO_ENDPOINTS and photos())


def save(guest_view, guest_photos):
    farm_db.set_setting("guest_view", guest_view if guest_view in MODES else "everyone")
    farm_db.set_setting("guest_photos", "on" if guest_photos else "off")
