# Landscape arena mode — scope

> **Status: shelved, deliberately.** Decided against for v1. The game works well
> on PC, desktop players are a first-class path, and the minigames that tested
> best are portrait modes this would not change. A week of medium-risk work to
> improve the middle-tier modes, for a phone experience nobody has yet asked
> for, is the wrong trade right now.
>
> **Revisit if** phone players visibly struggle in a playtest, or launch reviews
> say the phone experience is rough. The analysis below stays valid; this is a
> decision record, not a plan.

**Goal:** on a phone, action minigames render in landscape with the playfield
filling the screen and a consistent joystick + action button, instead of a
720×440 canvas squeezed into a 460px portrait column.

Everything below is checked against the current code. Where I'm inferring
rather than verifying, it says so.

---

## Why this is the right change

The arena world is **720×440 — natively landscape, 18:11**. Today it renders
inside `.screen { max-width: 460px }`, so the canvas is downscaled to roughly
60% of its own resolution before it ever reaches a phone screen. Every media
query in `styles.css` is `max-width`; there is no landscape or desktop
breakpoint anywhere.

That single fact explains three separate complaints: playfields look tiny,
trailer footage is full of dead margin, and phone controls feel unproven —
you're aiming at a shrunken target with buttons stacked underneath it.

The pieces already exist. `#arena-joystick`, `#arena-jump`, `#arena-roll`, the
race pedals, and a `(pointer:coarse)` media query that swaps to them are all
built. This is finishing work, not new construction.

---

## Scope: in and out

### In — the shared arena screen

These ten modes all render to `#arena-canvas` on `#screen-arena` and are
continuous-movement. They are the whole of phase 1:

`vanish` · `colorfloor` · `fire` · `racing` · `flappy` · `runner` ·
`painter` · `pong` · `bombpass` · *(plus `doors` and `pushy`, see phase 2)*

One screen, one canvas, one control rig. Changing it once changes all of them.

### Out — deliberately staying portrait

`trivia` · `timeline` · `map` · `bomb` · `curling` · `golf` · `drawing`

These are forms, maps and aimed shots. They want reading room and precise
tapping, not a stick. **Place It would actively get worse** in landscape — a
world map with a keyboard-height control bar eating the screen is worse than
the current portrait card.

This split is not arbitrary: it already exists in `styles.css` as
`#screen-arena` (820px) versus the 460px default. We're widening a boundary
that's already there, not inventing one.

### Phase 2 — own screens, own control blocks

`platformer` · `pushy` · `doors` · `redlight` · `hidebomb` each have their own
screen and their own `#*-controls` block. They'd benefit from the same
treatment but each needs individual work. **I have not audited these in
detail** — treat any estimate for them as a guess until I do.

---

## The control rig

"One joystick and one button" is the right instinct, but it does not survive
contact with all ten modes. Here's what the code actually does today:

| Mode | Movement | Primary | Secondary | Notes |
|---|---|---|---|---|
| vanish, colorfloor, bombpass | joystick, 2 axes | JUMP | — | the baseline |
| fire | joystick, 2 axes | BOMB | — | label swap only |
| painter | joystick, 2 axes | *(none)* | — | jump hidden; has a legend |
| racing | joystick = **steering** | HORN | GAS / BRAKE pedals | throttle is a real third input |
| runner | *(no stick)* | JUMP | ROLL | two actions |
| flappy | *(no stick)* | FLAP | — | single input, no movement |
| pong | **1 axis only** | *(none)* | — | axis depends on your side |

So the honest target isn't one rig — it's **one *layout*** with slots:

```
┌──────────────────────────────────────────────┐
│  round header (compact, overlaid)            │
│                                              │
│              PLAYFIELD (18:11)               │
│                                              │
│  ╭────╮                          ╭────╮      │
│  │ ⊙  │  joystick        action  │ ▲  │      │
│  ╰────╯                          ╰────╯      │
└──────────────────────────────────────────────┘
```

Left thumb: stick (hidden for flappy/runner, single-axis for pong).
Right thumb: primary action (hidden for pong/painter), secondary above it when
a mode needs one (runner's ROLL, racing's pedals).

Consistent *placement* is what players actually learn. Identical inputs across
modes is neither achievable nor desirable — racing genuinely needs a throttle.

---

## Work, in order

### 1. Landscape layout for `#screen-arena`
A `@media (orientation: landscape) and (pointer: coarse)` block: canvas sized
by height rather than width, header collapsed to a compact overlay, controls
absolutely positioned in the bottom corners rather than stacked below.

*Risk: low.* Purely additive CSS — nothing existing changes.

### 2. Canvas backing resolution
The canvas is a fixed 720×440 backing store. Filling a modern phone in
landscape means upscaling ~1.5–2×. The art is flat and vector-ish so it
tolerates this, but text will soften.

Fix properly by sizing the backing store to `clientWidth × devicePixelRatio`
and scaling the drawing context, so the world stays 720×440 in game
coordinates while rendering sharp.

*Risk: medium.* Touches `arena25d.js` and every `drawArena` path. Anything
that assumes literal 720×440 pixels — hit-testing, the pong paddle axis,
painter's grid — needs checking. This is the step most likely to produce
subtle bugs.

### 3. Orientation prompt
When an arena mode starts on a portrait phone: "Turn your phone sideways",
with the game paused or at least not scoring. Needs a real decision about what
happens to a player who ignores it — my recommendation is that the round still
runs and they're simply at a disadvantage, rather than blocking the round for
everyone else.

*Risk: low technically, but it's a UX decision worth making explicitly.*

### 4. Unify the action button
Fold the per-mode label logic (currently one long ternary at `app.js:4117`)
into a small per-mode control descriptor — `{ stick: 'xy'|'x'|'y'|null,
primary: 'JUMP'|'BOMB'|null, secondary: ... }`. That kills the ternary chain
and makes adding a mode a data change.

*Risk: low.* Good refactor regardless of landscape.

### 5. Verify each of the ten modes on a real phone
Not optional, and the reason you can't fully claim phone support yet. Racing
and Pong are the ones I'd expect to need tuning — steering feel and paddle axis
respectively.

---

## Effort

- Steps 1, 3, 4: **1–2 days**
- Step 2 (canvas resolution): **1–2 days**, most of the risk
- Step 5 (testing across ten modes on real devices): **1–2 days**, and it needs
  real hands on real phones

**Call it a week** for phase 1 done properly. Phase 2 (the five own-screen
modes) is a separate estimate I can't give responsibly without auditing them.

---

## What I'd deliberately not do

**Don't force landscape on the whole app.** The lobby, character creator,
results and the seven portrait modes are fine and better as they are.
Orientation should switch per-screen.

**Don't rebuild the desktop layout at the same time.** Desktop players are a
first-class path and the current layout works for them. Landscape is a phone
concern; keep the changes inside `(pointer: coarse)` so desktop cannot
regress.

**Don't re-shoot trailer footage until this lands.** The black bars in the
current cut are this layout showing through. Shooting now means shooting
twice.

---

## Knock-on effects

- **Store copy** currently claims "everyone plays from their own phone". Until
  step 5 is done that over-claims. It should say phone *or* a second computer,
  which is true today and a wider pitch anyway.
- **Screenshots and capsule art** get much easier — a landscape playfield fills
  a 16:9 frame with no cropping.
- `modeInfo.js` is the natural home for the per-mode control descriptor from
  step 4, since it already carries per-mode metadata shared by server and
  client.
