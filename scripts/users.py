#!/usr/bin/env python3
"""users.py - Manage Nevet player accounts from the Pi's terminal.

  python3 scripts/users.py list                   show all heroes and accounts
  python3 scripts/users.py reset-password NAME    set a new password (asks for it)
  python3 scripts/users.py make-admin NAME        give admin rights
  python3 scripts/users.py remove-admin NAME      take admin rights away

Handy when someone (even the admin) forgets their password.
"""
import getpass
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "webapp"))
import auth      # noqa: E402
import farm_db   # noqa: E402


def need(name):
    row = farm_db.find_grower_by_name(name)
    if not row:
        sys.exit(f"No hero called {name!r}. See: python3 scripts/users.py list")
    return row


def cmd_list():
    rows = farm_db.list_growers()
    if not rows:
        print("No heroes yet. Open the web app and sign up.")
        return
    print(f"{'Name':<22}{'Account':<11}{'Admin':<7}Last login")
    for r in rows:
        print(f"{r['name']:<22}{'yes' if r['password_hash'] else 'unclaimed':<11}"
              f"{'yes' if r['is_admin'] else '':<7}{r['last_login'] or '-'}")


def cmd_reset(name):
    row = need(name)
    pw = getpass.getpass(f"New password for {row['name']}: ")
    error = auth.validate_password(pw, getpass.getpass("Again: "))
    if error:
        sys.exit(error)
    farm_db.set_password(row["id"], auth.hash_password(pw))
    print(f"Password set for {row['name']}.")
    if farm_db.account_count() == 1 and not row["is_admin"]:
        farm_db.set_admin(row["id"], True)
        print(f"{row['name']} is the only account, so it is now the admin.")


def cmd_admin(name, value):
    row = need(name)
    farm_db.set_admin(row["id"], value)
    print(f"{row['name']} is {'now an admin' if value else 'no longer an admin'}.")


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        return
    cmd, rest = args[0], args[1:]
    if cmd == "list":
        cmd_list()
    elif cmd in ("reset-password", "make-admin", "remove-admin") and rest:
        name = " ".join(rest)
        if cmd == "reset-password":
            cmd_reset(name)
        else:
            cmd_admin(name, cmd == "make-admin")
    else:
        sys.exit(__doc__.strip())


if __name__ == "__main__":
    if os.geteuid() == 0 and "FARM_DB" not in os.environ:
        print("Tip: run this as your normal user (not sudo) so it uses the web app's database.")
    main()
