"""How the people in a Nevet group are connected.

Nevet is for small organic groups: households, families with little
children, couples, community gardens, volunteer teams. Two things model that:

* relationships: one row per pair, stored from A's side ("A is the <kind>
  of B"). Each kind has a label for A, a label for B (the inverse) and,
  where it exists, gendered words (mother/father, husband/wife...) used
  when the hero's gender is set. Symmetric kinds (partner, sibling) read
  the same from both sides.
* groups: a household, family, community garden, volunteer team... with
  members and coordinators. A hero can be in many groups.
"""

# id: (label for A, label for B, symmetric, {gender: word for A}, {gender: word for B})
KINDS = [
    ("parent",      "Parent",           "Child",            False, {"female": "Mother", "male": "Father"}, {"female": "Daughter", "male": "Son"}),
    ("guardian",    "Guardian",         "Ward",             False, {}, {}),
    ("grandparent", "Grandparent",      "Grandchild",       False, {"female": "Grandmother", "male": "Grandfather"}, {"female": "Granddaughter", "male": "Grandson"}),
    ("aunt_uncle",  "Aunt / uncle",     "Niece / nephew",   False, {"female": "Aunt", "male": "Uncle"}, {"female": "Niece", "male": "Nephew"}),
    ("spouse",      "Spouse",           "Spouse",           True,  {"female": "Wife", "male": "Husband"}, {"female": "Wife", "male": "Husband"}),
    ("partner",     "Partner",          "Partner",          True,  {}, {}),
    ("sibling",     "Sibling",          "Sibling",          True,  {"female": "Sister", "male": "Brother"}, {"female": "Sister", "male": "Brother"}),
    ("cousin",      "Cousin",           "Cousin",           True,  {}, {}),
    ("housemate",   "Housemate",        "Housemate",        True,  {}, {}),
    ("friend",      "Friend",           "Friend",           True,  {}, {}),
    ("neighbour",   "Neighbour",        "Neighbour",        True,  {}, {}),
    ("mentor",      "Mentor",           "Mentee",           False, {}, {}),
    ("coordinator", "Coordinator",      "Volunteer",        False, {}, {}),
    ("teammate",    "Fellow volunteer", "Fellow volunteer", True,  {}, {}),
    ("other",       "Connected to",     "Connected to",     True,  {}, {}),
]
KIND = {k[0]: k for k in KINDS}

GROUP_KINDS = [("household", "Household"), ("family", "Family"), ("couple", "Couple"),
               ("community", "Community garden"), ("volunteers", "Volunteer team"), ("other", "Other group")]
GROUP_KIND = dict(GROUP_KINDS)
GROUP_ROLES = [("member", "Member"), ("coordinator", "Coordinator"), ("guest", "Guest / occasional helper")]
GROUP_ROLE = dict(GROUP_ROLES)


def valid_kind(kind):
    return kind in KIND


def form_options():
    """[(value, text)] for "<name> is my ..." selects. Directed kinds give two
    options: "child" (value 'parent') and "parent" (value 'parent:rev')."""
    out = []
    for kid, la, lb, sym, _, _ in KINDS:
        if sym:
            out.append((kid, la))
        else:
            out.append((kid, lb))
            out.append((kid + ":rev", la))
    return out


def parse_choice(value):
    """('parent:rev') -> (kind, other_is_a). 'parent' means the other person is my child (I am A)."""
    value = value or ""
    rev = value.endswith(":rev")
    kind = value[:-4] if rev else value
    return (kind, rev) if valid_kind(kind) else (None, False)


def label(kind, gender=None, as_a=True):
    """Word for one side of the relationship: the A side or the B side."""
    k = KIND.get(kind) or KIND["other"]
    words = k[4] if as_a else k[5]
    return words.get(gender) or (k[1] if as_a else k[2])


def describe(kind, other_name, other_gender=None, i_am_a=True, note=None):
    """What to show on a hero's profile: ("Mother", "Dana") meaning Dana is my mother.

    `other_gender` is the gender of the *other* person, who holds the other
    side of the relationship."""
    # I am A: the other person is B, so show B's word for them
    return {"role": label(kind, other_gender, as_a=not i_am_a), "name": other_name, "note": note}


def clean_note(text):
    return " ".join((text or "").split())[:80] or None
