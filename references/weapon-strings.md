# Weapon strings (`info.weapon`) and kit roles

Reference for the blueprint strings SquadJS hands you in combat events, and for the one question
they get asked most: *which kit/role was that?*

## 1. Which events carry a blueprint string

| Event | Field | Comes from |
|---|---|---|
| `PLAYER_WOUNDED` | `weapon` | `Wound()` log line, `caused by <X>_C` |
| `PLAYER_DIED` | `weapon` | `Die()` log line, `caused by <X>_C` |
| `PLAYER_DAMAGED` | `weapon` | `ActualDamage` log line, `caused by <X>_C` |
| `DEPLOYABLE_DAMAGED` | `weapon` (causer) + `damageType` | `TakeDamage()` log line |
| `PLAYER_POSSESS` | `possessClassname` | `OnPossess(): Pawn=<X>_C` — a *pawn*, not a weapon (§4) |

Three facts about the string itself, verified in the parsers:

- **The runtime instance suffix is already stripped.** Every regex ends its capture at `_C`
  (`caused by ([A-z_0-9-]+)_C`), so you get `BP_AK74M_1P78`, never
  `BP_AK74M_1P78_C_2145566161`. Do not strip it again, and do not expect it.
- **It is the *damage causer* actor class, not "the gun the killer held".** For a bullet that is
  the weapon actor, but for indirect fire it is a projectile, for a burning vehicle a wreck state,
  for a roadkill the vehicle itself, and sometimes it is a *soldier* pawn — see §4 and §5.
- **The value is unvalidated free text.** Mods and patches introduce strings not in this file.
  Every `switch`/lookup over weapon strings needs a fall-through branch.

## 2. Ground truth behind this file

Four consecutive Discord killfeed exports from the same live server (mixed vanilla + mod
factions), each a stream of `PLAYER_WOUNDED` embeds:

| Period | Events | Distinct strings |
|---|---|---|
| 2026-01-08 → 2026-02-08 | 211,924 | 1,537 |
| 2026-02-08 → 2026-03-08 | 198,582 | 1,571 |
| 2026-03-08 → 2026-04-08 | 227,379 | 1,557 |
| 2026-04-08 → 2026-08-05 | 864,164 | 1,931 |
| **union — all counts below** | **1,502,049** | **2,069** |

1,204 strings occur in all four periods. It remains a sample of *one server over seven months*,
not a specification.

**What this sample structurally cannot show.** The source is a `DiscordKillFeed` channel, and that
plugin returns early on `if (!info.attacker)` — so every wound whose attacker SquadJS could not
resolve is missing here, and the shares in §5 are conditional on "attacker resolved". Only
`PLAYER_WOUNDED` is sampled: a causer that appears solely on `PLAYER_DIED` (bleed-out) or
`PLAYER_DAMAGED` would not show up. Every embed in all four exports is a `KillFeed:` embed — no
`Teamkill:` embeds share the channel, so nothing is double-counted. Extraction covered 1,502,049 of
1,502,396 embeds (99.98%); the 347 unmatched carry no weapon value.

### What changed across the four periods — and what didn't

Three different kinds of change show up in this data, and they defeat different matching
strategies. This is the section to read before you hard-code anything.

- **A faction re-equip defeats everything except a fall-through.** Between January and February the
  PLA's entire rifle family was replaced: `QBZ191`, `QBZ192` and `QBU-191` occur **exactly zero
  times** in January, then 387 / 277 / 153 events per 10k in February (rising to 514 / 322 / 151).
  29 genuinely new base weapons arrived at once, carrying **9.7% of February's entire kill
  traffic**; of that new traffic only 5.7% of events had a base token seen before. Neither a
  full-string list nor a base-token list would have covered it. The old family was not deleted, it
  decayed: `QBZ95` ran 451 → 236 → 82 → 66 per 10k across the four periods.
- **A loadout patch is absorbed by base-token matching.** Between March and April, 168 new strings
  appeared (0.5% of traffic) — `BP_QBZ192_Holo_Grippod_Suppressor` goes from **zero in three
  consecutive months** to 33.1 per 10k (2,860 events), joined by `BP_M4_Classic_M68`,
  `BP_AK74_45rnd` and `BP_QBZ192_IronSights_Grippod_4mags`. These are attachment and magazine
  variants (`Classic`, `45rnd`, `4mags`, `3mags`, `IronSights`) of guns that already existed:
  **99.8% of that new traffic carries a base token already known**, and only 7 new bases appeared
  (10 events). Match the base and this patch costs you nothing.
- **A rename kills the string *and* its base.** `BP_L1119A1_ET552_Foregrip` occurs only in January
  (31 events); `BP_L119A1_ET552_Foregrip` only from February on (22 / 34 / 2). Zero overlap — OWI
  corrected a typo in the blueprint name. Both an exact-string rule and a base-token rule stop
  matching at the rename, silently.

So the only design that survives all three is the one §1 asks for: **a fall-through branch, plus
some visibility into what lands in it.** Count or log unknown strings rather than dropping them;
that is what turns a silent 10% blind spot into a line in your logs.

What stayed stable across the same seven months:

- **Nothing in common use is retired.** Of every string absent from the last period, the most
  frequent one ever reached 5.8 per 10k (`BP_QSZ-92_10mags`, gone after February) — and that is the
  only one above 1 per 10k.
- **The high-volume end holds its shape.** Among the 1,204 strings present in all four periods,
  none with a peak above 20 events per 10k moved by ≥8× (`BP_M67Frag`: 145 / 124 / 127 / 118 per
  10k). Below that, usage swings both ways — `BP_PK_RWS_Gun` 3.35 → 0.25 → 1.01 → 4.96,
  `BP_QBZ95B-1` 15.10 → 6.14 → 0.44 → 0.37. Use the counts in §7 to tell common from exotic, never
  as a stable per-string expectation.
- **The kit vocabulary did not budge — not even through the re-equip.** Every period shows the same
  **20 canonical roles** and the same **16 faction tokens**; across all four, only two raw spellings
  appeared that no earlier period had (`CrewmanLeader`, `Recruit`), both already covered by
  `soldierRole()`. Weapons churn; roles do not.
- **A gap in one month is noise, not a removal.** 101 strings appear in Jan, Feb and Apr+ but not in
  Mar; 92 appear in Jan and Apr+ only.

## 3. Matching rules — every one is a real failure in this sample

| Rule | Evidence from the sample |
|---|---|
| Match **case-insensitively** | Casing is inconsistent for the same token: `_Destroy`/`_destroy`, `_Burn`/`_burn`, `_Obliterate`/`_obliterate`, `Ammocook`/`AmmoCook`, `Ironsight`/`IronSights`, `Technical_armor`/`Technical_Armor`, `_Woodland`/`_WoodLand`/`_woodland`, `Squadleader1`/`SquadLeader1` |
| Allow for **inflected** state tokens | The same state ships in several forms: `Destroy`/`Destroyed`, `Burn`/`Burned`/`Burning`, `Obliterate`/`Obliterated`. A pattern anchored on the bare stem (`obliterate(?:_|$)`) silently drops `M1151_Obliterated_Black` and its siblings into the wrong category |
| Do **not** require the `BP_` prefix | 475 of 2,069 strings (16,983 events) have none: `ASLAV_M252_AP`, `stryker_destroyed`, `btr_80_Destroy_Desert`, `2a6_Knockedout` |
| Match the **base token**, not the full string | Attachments multiply variants: `M4` alone has 22 (`BP_M4_M68`, `BP_M4_M150_Foregrip`, `BP_M4_Wormpool_T800`, …). 186 of 284 bases have more than one variant — and the base absorbs a loadout patch, though not a re-equip or a rename (§2) |
| Accept `BP_Soldier_` **and** `BP_Soldiers_` | Singular for most factions, plural for WPMC and CRF |
| Never assume digit/zero-padding conventions | Same kit, six spellings: `Medic`, `Medic1`, `Medic01`, `Medic_01`, `Medic_2`, `Medic_02` |
| Never build an exact-spelling whitelist | OWI's own typos ship in the blueprint names: `Marskman_01`/`_02`/`_03` (WPMC marksman), `..._Grenadier_02_Winer` (Winter) — and they get *fixed* later, renaming the string (`BP_L1119A1_…` → `BP_L119A1_…`, §2) |
| Expect a biome suffix — and for CAF a biome *infix* | `..._Medic_Woodland`, `..._LAT_Desert`, `..._Rifleman_02_Winter` vs `BP_Soldier_CAF_Arid_Rifleman_02` |

## 4. Kit role: read `role`, not the weapon string

**The weapon string contains no information about the attacker's kit.** `BP_M4_M68` is carried by
Rifleman, Medic, Squad Leader, Crewman and more; deriving a role from a rifle name is a
fabrication. Use one of these instead.

### `attacker.role` / `victim.role` — the authoritative source

`role` is a real field on every player object, parsed from RCON `ListPlayers`
(`api-reference.md` §7), formatted `<FACTION>_<Role>`. Caveats that matter for a combat handler:

- It comes from a **30 s poll**, so on a wound event it can be up to 30 s stale — a player who
  just switched kits still reads as the old one.
- `info.attacker` can be **null** on `PLAYER_WOUNDED`/`PLAYER_DIED`; guard before reading `.role`.
- A player not in `ListPlayers` (spectator, not yet spawned) is absent from `server.players`
  entirely, so there is no role to read.

### `PLAYER_POSSESS.possessClassname` — exact and lag-free, but only at spawn

When a player spawns as infantry the pawn is their **soldier blueprint**
(`BP_Soldier_USA_Medic`), which carries the kit with no poll lag — parse it with `soldierRole()`
in §6. Two limits: the same event fires for vehicles (the pawn is then a vehicle blueprint), and
SquadJS copies only the *latest* value onto `player.possessClassname`, so a player who entered a
vehicle after spawning carries the vehicle's classname, not their kit.

### A soldier blueprint in `weapon` names the **victim's** soldier

462 of the 2,069 strings are soldier pawns (52,601 events, 3.5%) — the damage causer was a
soldier pawn rather than a weapon. Whose? Measured, and replicated on all four periods
independently:

- 31–34% have `attacker === victim` (self-inflicted), in every period.
- For the rest, correlating the blueprint's faction token against each party's faction (inferred
  independently from the weapons that player used in the surrounding events) matches the
  **victim** far more often than the attacker, in every period: **27.5% vs 2.1%** (Jan),
  **23.8% vs 2.1%** (Feb), **26.3% vs 2.9%** (Mar), **33.6% vs 2.9%** (Apr+) — ratios of 13:1, 11:1,
  9:1 and 11:1. The remainder is undetermined (51% / 48% / 41% / 32%, driven by how many weapon
  families the faction inference could resolve in each sample).

So: the role token in such a string is the **victim's kit**. Never report it as the killer's kit.
(Melee is *not* the source of these events — bayonets have their own weapon strings:
`BP_AK74Bayonet`, `BP_M9Bayonet`, `BP_Bayonet2000`, `BP_QNL-95_Bayonet`. Damage routed through
the victim's own pawn is the plausible mechanism, but the underlying cause is not recoverable
from the event.)

### What the weapon string *can* tell you

| Question | Answer from the weapon string |
|---|---|
| Infantry weapon vs indirect fire vs vehicle wreck vs placed explosive? | Yes — `classifyWeapon()`, §5 |
| Which weapon model? | Yes — `weaponBase()`, §6 |
| Handheld or vehicle-mounted? | **No.** Both are plain weapon actors; `BP_AK74M` and `BP_BMP2_2A42_AP` are the same category. The vehicle-gun convention (`<Vehicle>_<Gun>_<Ammo>`, no optic token) is a hint, not a rule — plenty of kit weapons carry no optic token either (`BP_AKMS`, `BP_C14`, `BP_MP5A3`) |
| The attacker's kit? | **No.** Use `role` / `possessClassname` |
| Kit *family*, as a coarse hint? | Only where a weapon class is kit-exclusive by design (launchers → LAT/HAT, LMG → Automatic Rifleman/Machine Gunner, DMR/SWS → Marksman/Sniper). This *narrows*, it does not identify, and it is faction- and patch-dependent. If the requirement needs the kit, use `role` |

## 5. Categories

`classifyWeapon()` (§6) over all 2,069 strings:

| Category | Distinct | Events | Share | Pattern / examples |
|---|---|---|---|---|
| `weapon` | 869 | 1,193,693 | 79.5% | fall-through: a weapon actor, handheld **or** vehicle-mounted — `BP_QBZ191_Optic_QMK171A`, `BP_C7A2_C79A2_Foregrip`, `BP_BMP2_2A42_AP` |
| `projectile` | 148 | 174,938 | 11.6% | shells, rockets, mortars, artillery — `BP_Projectile_30mm_HE_Green`, `BP_Mortarround4`, `BP_RPG7_Frag_Proj2` |
| `thrown` | 30 | 60,365 | 4.0% | hand grenades & smoke — `BP_M67Frag`, `BP_RGD5Frag`, `BP_F1Frag` |
| `soldier` | 462 | 52,601 | 3.5% | soldier pawn as causer — victim's kit, §4 |
| `deployable` | 42 | 13,172 | 0.9% | mines, IEDs, C4, emplacements, HESCO — `BP_Deployable_TM62Mine`, `BP_EmplacedKord_SPP` |
| `wreck` | 518 | 7,280 | 0.5% | vehicle destruction/burn/cook-off state — `BTR4_Destroy`, `BP_MTLB_Burn`, `T62_GFI_Ammocook` |

Order matters: `soldier` and `wreck` must be tested before the generic patterns, and `projectile`
before `thrown` (tank frag shells such as `BP_Projectile_125mm_Frag` and `BP_ZBL08_ZPT-99_HEFrag`
contain `Frag`).

**Known imprecision, measured.** `thrown` is 11 hand-grenade strings (60,236 events) plus 19
cannon/launcher rounds that carry no `Proj`/`HE` token and therefore fall through to it
(`BP_2A46_T72A_Frag`, `BP_RPG7V2_Frag_2Mag`, `BP_SPG9_Frag`, `BP_ZiS3_Weapon_Frag`, … — 129
events, 0.2% of the bucket). Good enough for stats; if a rule must not misfire on a tank round,
match the grenade strings explicitly from §7.3.

**Vehicle actors (roadkill) hide inside `weapon`.** 89 strings / 2,326 events (0.15%) are a bare
vehicle blueprint with no gun and no wreck state — the vehicle body itself dealt the damage:
`BP_ASLAV`, `BP_BTR4_AFU`, `BP_MI8_AFU`, `BP_Tigr` (§7.6). Measured across all four periods: 77%
have attacker ≠ victim — a driver running people over, with the same attacker recurring on one
vehicle across many victims — and 23% are self-inflicted, overwhelmingly aircraft (`BP_UH1Y`,
`BP_Z8G`): a pilot dying with their own airframe. `classifyWeapon()` returns `weapon` for these,
because in *form* they are indistinguishable from a mounted-gun string with the gun token missing.
To separate them you need a vehicle-name list, which is server- and mod-specific — derive one from
your own logs by taking the base token of every `wreck` string (§7.5 is exactly that list for this
server), then treat a `weapon` string whose base is in that set, with no further tokens beyond
biome/faction tags, as a vehicle actor.

**Which causers produce teamkills.** A second export from the same server covers the `TEAMKILL`
stream (`DiscordTeamkill`, 2026-01-08 → 2026-05-08): 40,672 events, 1,292 distinct strings — and
**every one of those strings already appears in the catalogue above**, so a teamkill introduces no
new vocabulary. Two integrity checks on that pair of exports: 40,324 of 40,325
(attacker, weapon, victim) triples also occur in the killfeed export (100.00%), confirming that
`TEAMKILL` is a strict subset of `PLAYER_WOUNDED`; and **no** teamkill has attacker == victim,
matching the `victim.eosID !== attacker.eosID` guard in the emit path.

The composition differs sharply from the overall kill mix, and this is what an auto-warn or
TK-punish plugin actually faces. Propensity = share of teamkills ÷ share of all kills (baseline:
the Jan–Apr killfeed exports; the teamkill window is a month longer, but recomputing against the
full seven-month baseline moves every figure by ≤0.1, so the composition is not an artifact of the
mismatch):

| Category | Share of teamkills | Share of all kills | Propensity |
|---|---|---|---|
| `deployable` (mines, IED, C4) | 2.62% | 0.91% | **2.9×** |
| `thrown` (hand grenades) | 9.85% | 4.08% | **2.4×** |
| `wreck` | 0.75% | 0.48% | 1.6× |
| `soldier` | 4.16% | 3.62% | 1.2× |
| `projectile` | 12.89% | 11.91% | 1.1× |
| `weapon` (gunfire) | 69.73% | 79.01% | **0.9×** |

Aimed gunfire is *under*-represented; what fills a teamkill feed is explosives you threw or placed.
The strongest single signal is **melee**, and it replicates across all seven bayonet strings
independently — `BP_SA80Bayonet` 9.3×, `BP_QNL-95_Bayonet` 7.5×, `BP_AK74Bayonet` 6.9×
(213 teamkills), `BP_Bayonet2000` 5.6×, `BP_M9Bayonet` 5.6×, `BP_AKMBayonet` 5.6×,
`BP_G3Bayonet` 5.4×. Then placed mines (`BP_Deployable_M15Mine` 3.4×,
`BP_Deployable_TM62Mine` 2.2×), hand grenades (2.1–2.6× across every model), and area fire
(`BP_BM21_Rocket_Proj2` 2.1×, `BP_Heavy_Mortarround4` 1.8×, `BP_35MM_Proj_QLZ87_HEDP` 1.8×). At the
other end sit the aimed weapons: `BP_AK74M_1P78` and `BP_M16A4_M150` at 0.56×, `BP_C14` at 0.58×.

## 6. Copy-paste helpers

Verified against all 2,069 strings of the four exports: category shares as in §5, and
`soldierRole()` resolves **462/462** soldier blueprints to a canonical role with no false positives
on the other 1,607.

```js
const WEAPON_KINDS = [
  ['soldier', /^BP_Soldiers?_/i],
  ['wreck', /(?:^|_)(?:destroy(?:ed)?|burn(?:ed|ing)?|obliterated?|crash|wreck|knockedout)(?:_|$)|ammo_?cook/i],
  ['deployable', /deployable|emplaced|hescowall|razorwire|sandbag/i],
  ['projectile', /proj|rocket|mortar|artillery|apfsds|shell|missile|_he(?:at|frag)?(?:_|$)/i],
  ['thrown', /frag|grenade|molotov|smoke|bangerite/i]
];

// 'soldier' | 'wreck' | 'deployable' | 'projectile' | 'thrown' | 'weapon'
export function classifyWeapon(weapon) {
  for (const [kind, re] of WEAPON_KINDS) if (re.test(weapon || '')) return kind;
  return 'weapon';
}

// 'BP_QBZ191_Optic_QMK171A' -> 'QBZ191'   'ASLAV_M252_AP' -> 'ASLAV'
export function weaponBase(weapon) {
  return (weapon || '').replace(/^BP_/i, '').split('_')[0];
}

// Ordered longest-intent-first: compound SL kits before their parts, AutomaticRifleman
// before Rifleman. `mar[sk]{2}man` covers OWI's 'Marskman' typo.
const ROLE_TOKENS = [
  ['SquadLeaderCrewman', /sl_?crewman|crewman_?leader/i],
  ['SquadLeaderPilot', /sl_?pilot|pilot_?sl/i],
  ['SquadLeader', /squad_?leader|(?:^|_)sl(?:_?\d+)?(?:_|$)/i],
  ['Medic', /medic/i],
  ['AutomaticRifleman', /auto(?:matic)?_?rifleman|(?:^|_)ar(?:_?\d+)?(?:_|$)/i],
  ['MachineGunner', /machine_?gunner/i],
  ['Marksman', /mar[sk]{2}man/i],
  ['Sniper', /sniper/i],
  ['Grenadier', /grenadier/i],
  ['HeavyAntiTank', /heavy_?anti_?tank|heavy_?at(?:_|$)|(?:^|_)hat(?:_?\d+)?(?:_|$)/i],
  ['LightAntiTank', /light_?anti_?tank\d*|light_?at(?:_|$)|(?:^|_)lat(?:_?\d+\w?)?(?:_|$)/i],
  ['Engineer', /engineer/i],
  ['Crewman', /crewman/i],
  ['Pilot', /pilot/i],
  ['Sapper', /sapper/i],
  ['Raider', /raider/i],
  ['Scout', /scout/i],
  ['Rifleman', /rifleman/i],
  ['Recruit', /recruit|unarmed|plain/i],
  ['Gendarme', /gendarme/i]
];

// Soldier blueprint -> { faction, role, raw }. Accepts an `info.weapon` soldier string
// (that is the VICTIM's kit — see §4) and a PLAYER_POSSESS `possessClassname`.
// Returns null for anything that is not a soldier pawn.
export function soldierRole(classname) {
  const m = /^BP_Soldiers?_([A-Za-z0-9]+)_(.+)$/i.exec(classname || '');
  if (!m) return null;
  const raw = m[2]
    .replace(/_(?:woodland|desert|arid|winter|winer|forest|snow|naval|grey)$/i, '') // biome suffix
    .replace(/^(?:arid|woodland|desert|winter)_/i, ''); // CAF puts the biome before the role
  for (const [role, re] of ROLE_TOKENS) if (re.test(raw)) return { faction: m[1], role, raw };
  return { faction: m[1], role: null, raw }; // unknown kit (new mod / patch) — handle it
}
```

Typical use in a handler — note that the kit comes from `role`, not from `weapon`:

```js
async onWound(info) {
  if (!info.attacker) return; // can be null
  const kind = classifyWeapon(info.weapon);
  if (kind === 'wreck' || kind === 'projectile') return; // not an infantry engagement
  const kit = info.attacker.role; // 'USA_Rifleman_01' — 30 s poll, may be stale
  this.verbose(1, `${info.attacker.name} (${kit}) -> ${weaponBase(info.weapon)}`);
}
```

## 7. Observed catalogue

Counts are events across all four exports (§2). Lists are complete for that sample.

### 7.1 Weapon actors — 284 base weapons (869 full strings)

Handheld and vehicle-mounted, not separable (§4). Full strings are
`[BP_]<Base>[_<Attachment>…][_<Biome>]`; match the base. Format below: `Base (events/variants)`.

```
M4 (105773/22v) AK74M (86968/4v) C7A2 (83101/7v) QBZ191 (63703/6v) EF88 (50047/8v)
M16 (45722/8v) QBZ192 (41081/10v) Malyuk (40060/9v) AK74 (38679/9v) M16A4 (37928/5v)
C8A3 (35863/6v) L85A2 (31786/9v) AK101 (24228/4v) AKS74 (21941/7v) QBZ95-1 (20882/10v)
QBU-191 (20385/2v) MP5A3 (12209/5v) M4A1 (11754/3v) MPT76 (11587/9v) AK12 (11302/8v) C14 (11065)
AKS74U (10821/6v) M27 (9858/4v) M240 (9535/7v) AK74MGP25 (8987/2v) C9A2 (8912/3v) TW (8728)
ASVAL (7386/3v) PKM (7185/5v) PKP (7047/4v) M249 (6761/4v) QCW05 (6381/6v) M14 (6261/4v)
Kord (6220/7v) QJB201 (6016/2v) AKMS (5890) BRDM2 (5882/13v) UAR-10 (5646) M16A4M203 (5553/2v)
SVDM (5496) QJZ89 (5259/6v) SVD (5215) M110 (5133/2v) AK74GP25 (5063/3v) HK417 (4991)
50Cal (4837/7v) RPK74M (4809/2v) M16A2 (4648/3v) Arbalet (4366/2v) KLS (4339) CROWS (4338/5v)
Maximi (4220/3v) RPK (4216/2v) C16 (4160/2v) RPK74 (4118/4v) AK12GP25 (3986/3v) Ppsh41 (3711/2v)
M39 (3681) HK416 (3577) AMD65 (3573) F89 (3476/2v) BrowningHP (3295/2v) M1117 (3264)
MTLB (3210/25v) MG3 (3206/5v) EF88C (3195/3v) M256A1 (3175/4v) G3A4 (3148/3v) AKM (3045/4v)
M134 (3017/4v) BTR4 (2984/4v) M21 (2980) LAV25 (2962/6v) Mosin (2961/4v) L85A2AG36 (2923)
LAV (2906/5v) ASLAV (2866/4v) C6A1 (2835/2v) SV98 (2752) BTR82A (2636/4v) G17 (2632/4v)
PMV (2536/2v) FNFAL (2372/2v) QJY-201 (2371/2v) AKMGP25 (2289) EnforcerRWS (2256/4v)
MP443 (2181/2v) BTR80 (2133/11v) L110A2 (2114/2v) QSZ-92 (2082/2v) RPD (2061) QJY-88 (1865/2v)
BMP2 (1821/13v) ZPT-98 (1758/2v) SOR109T (1671/3v) VSS (1669) L129A1 (1667) M1126 (1620/6v)
PMMD63 (1597) AAVP7A1 (1570/6v) L55 (1533/2v) KLF (1504) KBA3 (1391/2v) 2A46M (1359/2v)
Cupola (1357/4v) SKS (1284/4v) C6 (1254/6v) G3A3 (1166/2v) M9A1 (1160) Makarov (1136)
QBU-88 (1110) Coyote (1108/4v) AK74Bayonet (1089) BMP1 (1074/6v) KNT76 (1034) PMT76 (1030/2v)
M17MHS (1021) G3KA4 (998/2v) AUG (993) MG253 (972/4v) MPT9 (950) QJB95-1 (938/2v)
QBZ95B-1 (934/2v) SKSTazco (928/3v) Warrior (845/4v) M240H (832/4v) ZTD05 (827/4v) M2 (819/2v)
L86A2LSW (807) M1151 (800/15v) L7A2 (795) 2A46 (774/6v) M9Bayonet (731) BFV (717/6v)
M1A1 (713/5v) M68A2 (695/2v) ZSD (685/2v) M38 (672) T90A (652/4v) ZBL08 (652/6v) G3A3HK79 (648)
Bayonet2000 (640) M4M203 (626) 2A20 (568/2v) L30A1 (567/2v) BMP1TS (567/3v) QNL-95 (560)
PK (528) Vz61 (494/2v) LeeEnfieldNo4 (460/2v) TT33 (457) TLAV (453/4v) DShK (447) L131A1 (437)
L22A2 (426/2v) Minimi (415) ZBD04A (407/4v) CobraRWS (400/2v) L94A1 (392) M1Carbine (381)
M60T (379/6v) Scimitar (362/4v) ZSL92 (351/4v) CH146 (349/5v) OKC-3S (343) BMD1M (343/4v)
MI8 (340/3v) G3A7 (321/2v) M16A2M203 (311) G3SG1 (300) Cobra (284/2v) SOCP (257) SOR9 (253)
QJY88 (253/3v) T72A (251/2v) BMP3M (228/5v) Mag58 (227/2v) ACV15 (197/2v) LAV6 (190/2v)
PF-98 (190/2v) SancakRWS (183/4v) SA80Bayonet (182) G3Bayonet (182) Browning (181/2v)
UH60 (180/3v) GAU21 (175) ACV (166/4v) BMD4M (164/4v) GPMG (162/2v) Z8G (145) AKMBayonet (139)
UH1Y (136) MRH90 (133) QJZ-89 (129) IFV25 (126/4v) BMP2M (126/4v) M18 (124) CTM131 (95/7v)
NSV (94) SA330 (89) Loach (89/2v) M2a1Browning (81/2v) LAV2 (77/3v) ZTZ99 (73/2v) 2A45 (66/2v)
G18 (64) Z8J (63) T72S (60) M240G (60/2v) L119A1 (58) WZ551B (51/4v) ZBD05 (48/3v)
M113A3 (46/11v) MTLB30mm (44/3v) M72A7 (44/6v) SMAW (41/3v) 2A6 (41/6v) MTLBM (40/4v)
Aussie (39/2v) Kamaz (39/4v) Kraz (32/3v) L1119A1 (31) Ural (31/7v) WZ551A (29/2v) M1128 (29/2v)
FV510UA (29/2v) Z9A (27) BRDM-2 (26/5v) Technical (25) T64BM2 (25) BM21Grad (24/3v)
ACV-15 (24/4v) AUS (23) PARS3 (23/6v) UH1H (22) FV107 (21/2v) Sprut (19/2v) CarlGustavM2 (19/5v)
NLAW (18/2v) FV4034 (18/2v) ZSL10 (17/3v) M1A2 (17/2v) Brit (17/3v) FV432 (16/6v) M3MAAWS (15)
DZJ-08 (14) FV510 (14/2v) C90CR (13/2v) M136AT4 (12) BTRMDM (11/3v) BRDM-2L1 (10) T62 (7)
UB32 (6) RPG7V2 (6/2v) T72B3 (6/2v) RPG28 (6/2v) ZSD05 (6/3v) M3MDFSW (5) Armored (5)
ILAWAT4 (4) BMP1AM (4) KPVT (4) ZSD89II (4) TLF (4/2v) RPG26 (4/2v) BTR-ZD (3) APS201-125 (2)
ObservationTower (2/2v) BTR-D (2/2v) RHIB (2/2v) BTR-DG (1) RPG7 (1) SPG9 (1) M1064 (1)
RPG29 (1) 9M119MRefleks (1) TireFire (1) Cobra2 (1) Tigr (1) Quadbike (1) ZSD89 (1) BGM71TOW (1)
US (1) MATV (1)
```

Attachment/suffix tokens seen after the base (248 distinct) — strip or ignore them, do not
enumerate them: optics (`M150`, `M68`, `M4A1`, `Holo`, `EXPS`, `T800`, `1P78`, `1P29`, `1P63`,
`PSO-1`, `SUSAT`, `Specter`, `ET552`, `C79A2`, `LDS`, `SDO`, `ACOG`, `Reddot`, `OKP-7`,
`QMK171A`, `Optic`, `Scope`, `Ironsights`/`IronSights`), handling (`Foregrip`, `Grippod`,
`Suppressor`, `Pro`, `Stick`, `Bayonet`), ammo/magazines (`AP`, `HE`, `Tracer`, `1mag`, `2mags`,
`3mags`, `4mags`, `45rnd`, `33rd`, `ExtendedMag`), under-barrel launchers (`M203`, `GP25`, `AG36`,
`HK79`, `GL`), role hints (`DMR`, `SWS`, `LSW`, `Rifle`, `Weapon`), vehicle/mount context (`PKT`,
`coax`, `RWS`, `M252`, `KPVT`, `DoorGun`, `Technical`, `Logi`, `RHIB`), faction and biome tags
(`RUS`, `AFU`, `GFI`, `WPMC`, `INS`, `Woodland`, `Desert`, `Winter`, `Naval`).

### 7.2 Projectiles — 148 strings

```
BP_Projectile_30mm_HE_Green (23623) BP_Projectile_30mm_HE_Red (22179) BP_Mortarround4 (13509)
BP_40MM_Proj2 (13173) BP_Projectile_155mm_Artillery (11166) BP_40MM_MK19_Proj (10089)
BP_RPG7_Frag_Proj2 (8410) BP_40MM_VOG_Proj2 (7282) BP_Projectile_30mm_HE (5721)
BP_35MM_Proj_QLZ87_HEDP (5419) BP_BM21_Rocket_Proj2 (4649) BP_ZBL08_ZPT-99_APFSDS (3638)
BP_Projectile_120mm_HEAT (3229) BP_FFV751_Tandem_Heat_Proj2 (3020) BP_Heavy_Mortarround4 (2983)
BP_Projectile_125mm_Frag (2951) BP_Projectile_30mm_HE_Red_Rarden (1760) BP_Hydra70_Proj2 (1752)
BP_RPG7_Heat_Proj2 (1690) BP_RPG28_Tandem_Proj (1574) BP_NLAW_Proj (1449)
BP_PF-98_Tandem_Proj (1448) BP_AGS30_40MM_VOG_Proj (1334) BP_S5_Proj2 (1257)
BP_M72A7_Rocket_Proj2 (1222) BP_PF-98_HE_Proj (1067) BP_30mm_VOG19_Proj (960)
BP_Projectile_125mm_HEAT (946) BP_M3MAAWS_Tandem_Heat_Proj2 (936) BP_M72A5_Rocket_Proj (869)
BP_DZJ-08_Heat_Proj (829) BP_RPG7_Tandem_Heat_Proj2 (786) BP_SPG9_og9v_Frag_Proj2 (784)
BP_Mortarround_120mm_Airburst (769) BP_FFV441D_Rocket_Proj (758) BP_Projectile_23mm_HE (611)
BP_SMAW_Tandem_Heat_Proj2 (611) BP_ZBL08_ZPT-99_APFSDS_Desert (591) BP_AT4_Rocket_Proj2 (575)
BP_FNFAL_GL_HEAT_Rifle (570) BP_RPG29_Tandem_Heat_Proj2 (525) BP_TOW_Proj (501)
BP_C90_Rocket_Proj (466) BP_Projectile_100mm_Frag (459)
BP_Projectile_RifleGrenade_FNFAL_Frag (439) BP_Projectile_Hell_Cannon (438)
BP_M72A6_Rocket_Proj (417) BP_S8_Proj2 (389) BP_SPG9_pg9v_Heat_Proj2 (389)
BP_FFV551_Rocket_Proj2 (354) BP_Projectile_23mm_HE_Green (347) BP_APKWS_Proj2 (291)
BP_RPG26_Rocket_Proj2 (247) BP_M3MAAWS_Heat_Proj2 (243) BP_Projectile_76mm_Frag (239)
BP_Projectile_500lb_Bomb (232) BP_Mortarround_120mm (222) BP_Projectile_115mm_HEAT (180)
BP_ZBD05_ZPT-99_APFSDS (174) BP_Projectile_76mm_HEAT (170) BP_SMAW_Heat_Proj2 (162)
BP_Kornet_Proj2 (162) LAV_M252_HE (142) LAV25_M252_HE_Woodland (141) ASLAV_M252_HE (133)
BP_Projectile_RifleGrenade_FNFAL_HEAT (125) BP_AT4_HighPenetration_Rocket_Proj2 (122)
BP_Projectile_30mm_CAS (86) LAV_M252_HE_Desert (61) BP_HJ-8ATGM_Proj (56)
BP_BTR82A_RUS_2A72_HE (52) BP_M256A1_HEAT (50) Coyote_M252_HE_Woodland (50)
BP_PF-98_HE_2mags (46) LAV25_M252_HE (36) BP_L55_HEAT (35) BP_ZBL08_ZPT-99_HEFrag (27)
BP_ZPT-98_HE (26) BP_BMP2_2A42_HE (23) BP_Warrior_Rarden_HE (22) BP_HJ73_Proj2 (22)
BP_ZBD04A_2A70_HEFrag (21) BP_RPG7V1_Heat_2Mag (21) BP_BTR4_ZTM1_HE (18) BP_Refleks_Proj2 (18)
BP_StugnaP_Proj (16) BP_M68A2_HEAT (16) BP_Konkurs_Proj2 (15) BP_BMP3M_2A70_HEFrag (15)
BFV_M252_HE_Woodland (14) Coyote_M252_HE_Desert (14) BP_2A46M_HEAT (12) BP_MILAN_Proj (12)
BP_ZPT-98_HEAT (12) BFV_M252_HE (12) BP_M3MAAWS_HEAT (11) BP_Projectile_76mm_Smoke (11)
ACV_M252_HE (10) BP_BTR82A_RUS_2A72_HE_Desert (10) BP_KBA3_HEAT (10)
BP_MTLB_30mm_HE_gun_Green (9) BP_AT3_Proj2 (9) BP_PF-98_HE (9) BP_RPG7_Heat_2Mag (8)
BP_ZBD05_ZPT-99_HE (7) BP_ZBL08_ZPT-99_HEFrag_Desert (7) BP_Warrior_Rarden_HE_Tan (6)
BP_Projectile_120mm_Smoke (6) BP_Scimitar_Rarden_HE_Woodland (6) BP_M252mortar (6)
BP_81mmMortar (6) BP_BMP2_GFI_2A42_HE (6) BP_ZSL92_ZPT90_HE (5) BP_BMD4M_2A70_HEFrag (5)
BP_40MM_Smoke_Proj2 (5) BP_BMP3M_2A72_HE (5) BP_BMP2_2A42_HE_Desert (5)
BP_MTLB_30mm_HE_gun_Desert (5) BP_2A46_T72A_HEAT (4) ACV_M252_HE_Desert (4)
BP_ZBD04A_ZPT99_HEFrag (4) BP_RPG7_Heat (4) IFV25_M252_HE_Desert (4) BP_ZiS3_Weapon_HEAT (4)
BP_Scimitar_Rarden_HE (4) BP_BMP2_AFU_2A42_HE (3) BP_BMP1TS_ZTM1_HE (3) BP_SMAW_HEAT (3)
BP_2b14podnosmortar (3) BP_M252mortar_Smoke (3) BP_M3MAAWS_Smoke_Proj2 (2)
BP_MTLB_30mm_HE_gun (2) BP_M3MAAWS_Heat_3mags (2) IFV25_M252_HE (2) BP_81mmMortar_Smoke (1)
BP_PP87Mortar (1) BP_Technical2Seater_Mortar_Grey (1) BP_ZSL92_ZPT90_HE_Desert (1)
BP_2A20_HEAT (1) BP_2A46_HEAT (1) BP_40MM_Smoke_Blue_Proj2 (1) BP_Technical_M252mortar_Smoke (1)
BP_M3MDFSW_Heat (1) BP_ZTD05_ZPL-98A_HEAT (1) BP_2A45_HEAT (1) BP_M1937mortar (1)
BP_40MM_VOG_Smoke_Proj2 (1) BP_L16mortar (1)
```

### 7.3 Thrown explosives — 30 strings

The first 11 are the actual hand grenades (§5).

```
BP_M67Frag (18642) BP_F1Frag (7807) BP_Type86p_Frag (7683) BP_C13Frag (7100) BP_RGD5Frag (6459)
BP_RGD5Frag_Brown (3788) BP_F1Frag_au (3572) BP_RGOFrag_Brown (2531) BP_L109A1Frag (1976)
BP_VOG17_UZRGM_Frag01 (406) BP_RGOFrag_Green (272) BP_RPG7V1_Frag_2Mag (20) BP_2A20_Frag (15)
BP_2A46M_Frag (14) BP_KBA3_Frag (12) BP_MG253_Frag (12) BP_ZTD05_ZPL-98A_Frag (11)
BP_RPG7V2_Frag_2Mag (10) BP_M3MAAWS_Smoke_2mags (6) BP_MG253_Frag_WPMC (6) BP_RPG7_Frag_2Mag (5)
BP_2A46_T72A_Frag (4) BP_RPG7_Frag_5Mag (3) BP_RPG7V2_Frag_3Mag (3) BP_2A46_T72S_Frag (2)
BP_SPG9_Frag (2) BP_2A46_Frag (1) BP_M68A2_Smoke (1) BP_ZiS3_Weapon_Frag (1)
BP_Technical_BMP1_2A28_Frag (1)
```

### 7.4 Deployables and placed explosives — 42 strings

```
BP_Deployable_TM62Mine (2334) BP_Deployable_M15Mine (2226) BP_EmplacedKord_SPP (1754)
BP_EmplacedM2_Weapon_ACOG (1657) BP_Deployable_Type72Mine (789) BP_EmplacedQJZ-89_Scope (738)
BP_Deployable_IED (725) BP_Deployable_M112_C4Explosive_Timed (563)
BP_EmplacedM2_Weapon_Ironsight (521) BP_Deployable_SZ1_Explosives_Timed (393)
BP_Deployable_M112_C4Explosive (365) BP_PLA_Deployable_TNT_Explosive_Timed (218)
BP_Deployable_TNT_1lb_Explosive_Timed (191) BP_EmplacedDshk (178) BP_EmplacedDshk_Shield (122)
BP_Deployable_TNT_600g_Explosive_Timed (90) BP_Deployable_SensitiveExplosives_Bangerite (45)
BP_EmplacedM2HB_Weapon_Ironsight (43) BP_EmplacedQJZ-89 (35) BP_Razorwire_clean_2 (31)
BP_Deployable_CompB_Explosive (26) BP_EmplacedUB32 (26) BP_EmplacedM2HB_Shield_Weapon (19)
BP_InfantryRazorwire (14) BP_EmplacedSPG9Scope (13)
BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS (10) BP_Emplaced_ZU23-2_Antiaircannon_Weapon (6)
BP_EmplacedBGM71TOW (6) BP_Emplaced_HJ-8ATGM (5) BP_HescoWall_USA_Desert (4)
BP_EmplacedSPG9_FragScope (4) BP_EmplacedKornet (3)
BP_Emplaced_ZU23-2_Antiaircannon_Weapon_Deployable (3)
BP_Emplaced_ZU23-2_Antiaircannon_Weapon_Deployable_INS (3) BP_HescoWall_AFU_Woodland (2)
BP_HescoWall_USA_Forest (2) BP_HescoWall_RGF_Woodland (2) BP_Razorwire_Dirty_2 (2)
BP_HescoWall_RGF_Desert (1) BP_EmplacedStugna (1) BP_HescoWall_Desert_PLA (1)
BP_HescoWall_PLA (1)
```

### 7.5 Vehicle wrecks — 135 vehicle tokens

Form: `[BP_]<Vehicle>[_<Faction>][_<Gun>]_<State>[_<Biome>]`, with the state one of
`Destroy`/`Destroyed`, `Burn`/`Burned`/`Burning`, `Obliterate`/`Obliterated`, `Ammocook`/`AmmoCook`,
`Crash`, `wreck`, `Knockedout` — neither casing nor inflection is consistent, so match
case-insensitively and allow the suffixes (§3). Vehicle tokens observed, with the state and biome
stripped — they still carry optional faction/gun tags (`MTLB_AFU`, `T62_GFI`, `MTLB_2a72`), so
match by prefix (`/^MTLB/i`) rather than by equality:

```
CTM131 lav6 M939Truck LAV25 kamaz_5350 ZBL08 MI8 BTR4 kraz_6322 btr_82 ASLAV Tigr CPV PMV TAPV
CAF_Util Kozak M1151 AUS_Utility_Truck M1117 ural375_militia BMP2 LUVW RHIB Warrior WPMC_M1151
Raven BritUtilTruck CSK MTLB MATV_USMC M1a2 stryker brdm2 2a6 WPMC_Util ZTZ99 MATV BMP1 btr_80
ZTD05 SA330 WZ551B Bradley Scimitar Loach ural375_civilian Coyote WPMC_Technical_4Seater CH146
M1a1_USMC M60T T90A T64BM2 TLFUtilTruck Zsl-10 UH60M BMP1TS Technical_2Seater ural4320_GFI FV432
UH1Y AAVP7A1 M1128 brdm2_GFI ZBD04A M113A3 M1151_Light LPPV Technical_4Seater_Camo ACV15 FV4034
MRH90 WPMC_Technical_2Seater WZ551 BMP3M M113A3_Woodland_Logi Technical_2Seater_Camo UH1H ZBD05
Safir MTLB_AFU brdm2_Rus Z8G brdm2_Insurgents Z8J PARS3 Technical_4Seater BMP2M T62_Mil
M113A3_Logi M113A3Woodland_Logi minsk T62 T72 US_Util ZSD-05 BMD4M Cobra2 ZSD89II BMP1_GFI
BTR-MDM BMP2_GFI MTLB_30mm_Rus Ural375_BM21_MEI ZSD89-QLZ ZSL-10 BTR-ZD LynxATV MTLB_Zu23
PARS3_Sancak T72A_IMF BMD1M BTR-D BTR-DG kraz_6322_Grad MTLB_2a72 MTLB_Kpvt_Rus ACV15_APC
brdm2_MIL MTLB_zu23 T62_GFI MTLB_GFI Sprut Z9A M1151_CROWS MTLB_30mm T72AV_GFI T72S_GFI
Technical_Armor Ural375_BM21_IMF BMP1AM MTLB_Insurgent Technical_armor ZSD89
```

### 7.6 Vehicle actors — 89 strings (roadkill / crush, §5)

```
BP_BTR4_AFU (196) BP_MI8_AFU (182) BP_CH146 (167) BP_Z8G (145) BP_MI8 (137) BP_UH1Y (136)
BP_LAV6_Woodland (125) BP_ASLAV (123) BP_LAV25_Woodland (99) BP_SA330 (89) BP_LAV6_Desert (65)
BP_Z8J (63) BP_LAV25 (38) BP_BMP2_IMF (38) BP_ZTD05 (35) BP_WZ551B (31) BP_MTLB_LOGI_AFU (29)
BP_CH146_Desert (28) BP_M1151_WPMC (27) BP_Z9A (27) BP_BMP2 (26) BP_BMP1TS_AFU (24)
BP_M1151 (22) BP_UH1H_GFI (22) BP_AAVP7A1_Woodland (21) BP_MI8_VDV (21) BP_M1128_Woodland (20)
BP_Loach (18) BP_M1151_Woodland (17) BP_FV4034_Woodland (14) BP_BMP1_INS (14)
BP_ZBD04A_Desert (14) BP_BMP3M (14) BP_T90A (13) BP_M1A2_Woodland (13) BP_2A6_Woodland (13)
BP_AAVP7A1 (12) BP_BMP2_Desert (12) BP_BMP2_AFU (12) BP_BMP2_GFI (11) BP_MTLB_LOGI_IMF (10)
BP_MTLB_INS (10) BP_PARS3 (10) BP_BMD4M (9) BP_M1151_Light_Woodland (9) BP_M1128 (9)
BP_M1151_Light (8) BP_T72A_IMF (8) BP_ZTD05_WoodLand (8) BP_BMP1_GFI (8) BP_BMP1_MIL (8)
BP_BMD1M_Desert (7) BP_ZBD04A (7) BP_BMP3M_Desert (7) BP_T62 (7) BP_MTLB_LOGI_RUS (6)
BP_PARS3_Desert (5) BP_MTLB_LOGI_RUS_Desert (5) BP_M113A3_Logistics_Desert (5) BP_BMP1_AFU (5)
BP_M1A2 (4) BP_BMP1AM (4) BP_AAVP7A1_Woodland_Logi (4) BP_WZ551B_Desert (4)
BP_M1A1_USMC_Woodland (4) BP_ZSD89II (4) BP_FV4034 (4) BP_MTLB_AFU (3) BP_BTR-ZD (3)
BP_M113A3_Logistics (3) BP_BMD4M_Desert (2) BP_M60T_WPMC (2) BP_2A6_Desert (2)
BP_T90A_Desert (2) BP_FV432_woodland (2) BP_M60T (2) BP_BTR-DG_Logistics (1)
BP_M1151_Light_Woodland_CRF (1) BP_MTLB_LOGI_INS (1) BP_CTM131_Desert (1) BP_Tigr (1)
BP_FV432 (1) BP_AAVP7A1_Logi (1) BP_Sprut_Desert (1) BP_M1A1_USMC (1) BP_M60T_Desert (1)
BP_US_Util_USMC_Woodland_Logi (1) BP_MATV (1) BP_BMD1M (1)
```

### 7.7 Soldier blueprints — 16 factions × role vocabulary

Form: `BP_Soldier[s]_<FACTION>_[<Biome>_]<Role>[_<NN>][_<Biome>]`.

Faction tokens observed (vanilla and mod factions mixed — do not treat as a closed set):
`CAF`, `WPMC`, `PLA`, `AFU`, `RU`, `USMC`, `USA`, `ADF`, `PLANMC`, `INS`, `BAF`, `IMF`, `VDV`, `TLF`, `GFI`, `CRF`.

Role tokens, grouped by the canonical role `soldierRole()` returns. The spelling column is the
complete observed set — it is the reason to match by pattern rather than by table lookup:

| Canonical role | Events | Observed spellings |
|---|---|---|
| `Rifleman` | 10,403 | `Rifleman2`, `Rifleman1`, `Rifleman_02`, `Rifleman_2`, `Rifleman01`, `Rifleman_07`, `Rifleman_03`, `Rifleman`, `Rifleman03`, `Rifleman_01`, `Rifleman7`, `Rifleman_06`, `Rifleman6`, `Rifleman_04`, `Rifleman02`, `Rifleman4`, `Rifleman8`, `Rifleman_08`, `Rifleman_05`, `Rifleman3`, `Rifleman5`, `Rifleman_09` |
| `Medic` | 9,312 | `Medic`, `Medic01`, `Medic_02`, `Medic_01`, `Medic_2`, `Medic1` |
| `LightAntiTank` | 7,787 | `LAT`, `LightAntiTank`, `LAT_M72`, `LAT_01`, `LAT_C90`, `LAT_RPG7`, `LAT_AT4`, `LAT_02`, `LAT1`, `LightAntiTank2`, `LAT_Rpg26`, `Light_AT`, `LAT_RPG26`, `LAT_02a`, `LAT2`, `LAT_03a` |
| `SquadLeader` | 7,040 | `SquadLeader`, `SquadLeader2`, `SquadLeader02`, `SquadLeader01`, `SquadLeader_3`, `SL_03`, `SL_05`, `Squadleader1`, `SL_04`, `SL_01`, `SL_02`, `Squadleader2`, `SquadLeader1`, `SquadLeader_2` |
| `Grenadier` | 3,444 | `Grenadier`, `Grenadier_01`, `Grenadier1`, `Grenadier01`, `Grenadier_02` |
| `Marksman` | 3,005 | `Marksman`, `Marksman01`, `Marksman_02`, `Marskman_03`, `Marskman_01`, `Marskman_02`, `Marksman_01`, `Marksman_03` |
| `HeavyAntiTank` | 2,360 | `HAT`, `HAT_RPG28`, `HAT_02`, `HeavyAntiTank`, `HAT_01`, `HeavyAntiTank_02`, `HAT01`, `HAT02`, `HAT_RPG29`, `Heavy_AT` |
| `AutomaticRifleman` | 2,022 | `AutomaticRifleman`, `AR`, `Autorifleman`, `Autorifleman_2`, `Automatic_Rifleman_03`, `Automatic_Rifleman_01`, `AutomaticRifleman01`, `AutomaticRifleman2`, `Automatic_Rifleman_02` |
| `MachineGunner` | 1,760 | `Machinegunner`, `MachineGunner`, `MachineGunner01`, `Machinegunner_01`, `MachineGunner_02`, `MachineGunner_01` |
| `Engineer` | 1,638 | `Engineer`, `Engineer01`, `Engineer2`, `Engineer_01` |
| `Crewman` | 895 | `Crewman`, `Crewman01`, `Crewman_01`, `Crewman1` |
| `SquadLeaderPilot` | 525 | `SL_Pilot`, `SL_Pilot_01`, `Pilot_SL`, `SLPilot` |
| `Sniper` | 464 | `Sniper_01`, `Sniper` |
| `Pilot` | 428 | `Pilot`, `Pilot02`, `Pilot_01`, `Pilot01` |
| `Sapper` | 385 | `Sapper_01`, `Sapper`, `Sapper_02` |
| `Raider` | 384 | `Raider01`, `Raider_01`, `Raider_02` |
| `SquadLeaderCrewman` | 375 | `SL_Crewman`, `SL_Crewman_01`, `SLCrewman`, `CrewmanLeader` |
| `Scout` | 200 | `Scout01`, `Scout` |
| `Recruit` | 90 | `Plain1`, `Unarmed_01`, `Plain`, `Recruit`, `Recruit_01` |
| `Gendarme` | 84 | `Gendarme_01` |

`Recruit` covers the unarmed default spawns (`Plain`, `Unarmed_01`). `Gendarme_01` is TLF-only.

## 8. Regenerate this for your own server

The catalogue above is one server's sample. Before you hard-code any weapon or kit rule, derive
the real set from your own `SquadGame.log` — mods, patches and the active layer rotation all
change it. Both one-liners strip the `_C_<instance>` suffix, so the output is exactly what
SquadJS hands your plugin:

```bash
# weapon strings, most frequent first (PLAYER_WOUNDED / PLAYER_DIED / PLAYER_DAMAGED)
perl -lne 'print $1 if /caused by ([\w-]+)_C_\d+/' SquadGame.log | sort | uniq -c | sort -rn

# possessed pawns — soldier kits and vehicles (PLAYER_POSSESS)
perl -lne 'print $1 if /Pawn=([\w-]+)_C_\d+/' SquadGame.log | sort | uniq -c | sort -rn
```

Run the second one to confirm the kit spellings your factions actually use, then check them
against `soldierRole()` — a new mod faction is the one thing that makes it return
`{ role: null }`.

How often is this worth redoing? The four periods in §2 answer it. **The role vocabulary is
durable** — same 20 roles and 16 factions in every period, two new spellings in seven months, no
`soldierRole()` change. **The weapon strings are not**, and how badly depends on what changed: a
loadout patch is absorbed by base-token matching (99.8% of the new traffic), a **faction re-equip
is not** (29 new base weapons in one month, 9.7% of that month's kills), and a rename defeats both.
So: re-derive after every **game patch or modset change**, and in the meantime make the
fall-through branch visible — an unknown-string counter tells you a re-equip happened before your
statistics start lying.
