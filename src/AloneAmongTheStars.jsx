import React, { useEffect, useRef, useState, useCallback } from "react";

// ---------- storage fallback for standalone deployment ----------
// window.storage is provided by Claude's artifact environment. It doesn't
// exist on a normal deployed website, so this installs a localStorage-backed
// implementation with the same shape whenever it's missing — every save/load
// call in the game keeps working unmodified either way.
if (typeof window !== "undefined" && !window.storage) {
  const PREFIX = "aats:"; // namespaced so it can't collide with other keys
  window.storage = {
    async get(key) {
      try {
        const raw = window.localStorage.getItem(PREFIX + key);
        return raw === null ? null : { key, value: raw };
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(PREFIX + key, value);
        return { key, value };
      } catch {
        return null;
      }
    },
    async delete(key) {
      try {
        window.localStorage.removeItem(PREFIX + key);
        return { key, deleted: true };
      } catch {
        return null;
      }
    },
    async list(prefix) {
      try {
        const keys = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(PREFIX)) {
            const bare = k.slice(PREFIX.length);
            if (!prefix || bare.startsWith(prefix)) keys.push(bare);
          }
        }
        return { keys };
      } catch {
        return { keys: [] };
      }
    },
  };
}

// ---------- ALONE AMONG THE STARS ----------
// A retro-terminal arcade dodger/shooter.
// Palette: deep void black, phosphor amber, signal cyan, alert red.
// Mega-boss accent: violet/magenta with cyan trim, so it reads as a
// different, more advanced class of threat.

const COLORS = {
  bg: "#05060a",
  panel: "#0d1013",
  amber: "#ffb454",
  amberDim: "#6b4f28",
  amberFaint: "#3a2c17",
  cyan: "#5ee6d0",
  cyanDim: "#2a5a52",
  red: "#ff5d5d",
  redDim: "#7a2f2f",
  white: "#eef2f0",
  violet: "#c65bff",
  violetDim: "#5a2c7a",
  green: "#7dffb0",
  rockCoreHi: "#4a3226",
  rockCoreLo: "#171210",
  rockCoreHiDanger: "#4a2020",
  rockCoreLoDanger: "#170d0d",
};

const WIDTH = 520;
const HEIGHT = 680;
const PLAYER_SIZE = 22;
const BULLET_SPEED = 9;
const PLAYER_SPEED = 6.2;
const BASE_COOL = 9;
const DEGRADE_INTERVAL = 900; // ~15s at 60fps
const BOSS_WAVE_INTERVAL = 5;
const BOSS_BASE_HP = 55;
const BOSS_HP_MULT = 1.25;
const MEGA_WAVE = 25;
const MEGA_BASE_HP = 480;
const TROPHY_KEY = "void-runner-trophies";
const SHIP_CONFIG_KEY = "void-runner-ship-config";
const COMPLETED_KEY = "void-runner-completed";

// Ship hull presets — each is a closed polygon in the ship's local space
// (nose pointing up/negative-y), swapped in for the fuselage outline.
// Every preset is normalized to the same bounding radius so the invisible
// collision hitbox (PLAYER_HIT_RADIUS) is fair no matter which hull is
// visually larger or smaller before normalization.
const PLAYER_HIT_RADIUS = 15;
function normalizeShape(points, targetRadius = PLAYER_HIT_RADIUS) {
  let maxR = 0;
  points.forEach(([x, y]) => {
    const r = Math.hypot(x, y);
    if (r > maxR) maxR = r;
  });
  const scale = maxR > 0 ? targetRadius / maxR : 1;
  return points.map(([x, y]) => [x * scale, y * scale]);
}
const SHIP_SHAPES = {
  interceptor: normalizeShape([
    [0, -17], [3, -3], [13, 6], [7, 8], [6, 14], [2, 10],
    [0, 13], [-2, 10], [-6, 14], [-7, 8], [-13, 6], [-3, -3],
  ]),
  needle: normalizeShape([
    [0, -19], [2.5, -7], [3, 6], [4.5, 11], [0, 16],
    [-4.5, 11], [-3, 6], [-2.5, -7],
  ]),
  delta: normalizeShape([
    [0, -16], [17, 11], [10, 10], [4, 15], [0, 10],
    [-4, 15], [-10, 10], [-17, 11],
  ]),
  saucer: normalizeShape(
    Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return [Math.cos(a) * 15, Math.sin(a) * 9 - 1];
    })
  ),
  // ---- shop-purchasable forms ----
  stealth: normalizeShape([
    [0, -20], [4, 2], [24, 10], [8, 6], [3, 18], [0, 12],
    [-3, 18], [-8, 6], [-24, 10], [-4, 2],
  ]),
  falcon: normalizeShape([
    [0, -18], [2, -4], [20, 4], [16, 12], [4, 8], [2, 20], [0, 14],
    [-2, 20], [-4, 8], [-16, 12], [-20, 4], [-2, -4],
  ]),
  vanguard: normalizeShape([
    [0, -22], [5, -10], [12, -6], [10, 8], [20, 14], [6, 16], [0, 22],
    [-6, 16], [-20, 14], [-10, 8], [-12, -6], [-5, -10],
  ]),
  raptor: normalizeShape([
    [0, -19], [3, -6], [26, 2], [22, 9], [6, 5], [3, 21], [0, 15],
    [-3, 21], [-6, 5], [-22, 9], [-26, 2], [-3, -6],
  ]),
  // premium — the "super advanced" hull
  quantum: normalizeShape([
    [0, -24], [3, -14], [10, -12], [14, -2], [28, 6], [16, 10],
    [10, 8], [6, 18], [12, 24], [0, 18], [-12, 24], [-6, 18],
    [-10, 8], [-16, 10], [-28, 6], [-14, -2], [-10, -12], [-3, -14],
  ]),
  // secret — achievement-only reward, genuinely egg-shaped
  egg: normalizeShape([
    [0, -20], [7, -16], [11, -8], [13, 2], [12, 10], [8, 16],
    [0, 19], [-8, 16], [-12, 10], [-13, 2], [-11, -8], [-7, -16],
  ]),
};
const SHIP_SHAPE_LIST = [
  { id: "interceptor", label: "Interceptor" },
  { id: "needle", label: "Needle" },
  { id: "delta", label: "Delta Wing" },
  { id: "saucer", label: "Saucer" },
];
const SHIP_COLORS = [
  { id: "amber", hex: "#ffb454", label: "Amber" },
  { id: "cyan", hex: "#5ee6d0", label: "Cyan" },
  { id: "crimson", hex: "#ff5d5d", label: "Crimson" },
  { id: "emerald", hex: "#7dffb0", label: "Emerald" },
  { id: "violet", hex: "#c65bff", label: "Violet" },
  { id: "silver", hex: "#eef2f5", label: "Silver" },
];
const DEFAULT_SHIP_CONFIG = { shape: "interceptor", color: "#ffb454", trail: "none", bullet: "standard" };

// ---------- shop catalog ----------
// Purchasable hull forms — one per item is normal price, "quantum" is the
// premium super-advanced option.
const SHOP_SHAPES = [
  { id: "stealth", label: "Stealth Wing", cost: 5 },
  { id: "falcon", label: "Falcon", cost: 5 },
  { id: "vanguard", label: "Vanguard", cost: 5 },
  { id: "raptor", label: "Raptor", cost: 5 },
  { id: "quantum", label: "Quantum Fighter", cost: 10, premium: true },
  { id: "egg", label: "Easter Egg", cost: 0, secret: true },
];

// Rainbow ship colors, plus the animated Rainbow special.
const SHOP_COLORS = [
  { id: "sh_red", hex: "#ff3b30", label: "Red", cost: 3 },
  { id: "sh_orange", hex: "#ff8c1a", label: "Orange", cost: 3 },
  { id: "sh_yellow", hex: "#ffe135", label: "Yellow", cost: 3 },
  { id: "sh_green", hex: "#2ecc40", label: "Green", cost: 3 },
  { id: "sh_blue", hex: "#3b82f6", label: "Blue", cost: 3 },
  { id: "sh_indigo", hex: "#5b3cc4", label: "Indigo", cost: 3 },
  { id: "sh_purple", hex: "#a020f0", label: "Purple", cost: 3 },
  { id: "sh_pink", hex: "#ff6fae", label: "Pink", cost: 3 },
  { id: "sh_teal", hex: "#1abc9c", label: "Teal", cost: 3 },
  { id: "sh_rainbow", hex: "rainbow", label: "Rainbow", cost: 5, isRainbow: true },
];

// Engine trail color variants — a fading particle stream behind the ship.
const SHOP_TRAILS = [
  { id: "tr_amber", hex: "#ffb454", label: "Amber Trail", cost: 2 },
  { id: "tr_cyan", hex: "#5ee6d0", label: "Cyan Trail", cost: 2 },
  { id: "tr_red", hex: "#ff3b30", label: "Red Trail", cost: 2 },
  { id: "tr_orange", hex: "#ff8c1a", label: "Orange Trail", cost: 2 },
  { id: "tr_green", hex: "#2ecc40", label: "Green Trail", cost: 2 },
  { id: "tr_blue", hex: "#3b82f6", label: "Blue Trail", cost: 2 },
  { id: "tr_purple", hex: "#a020f0", label: "Purple Trail", cost: 2 },
  { id: "tr_pink", hex: "#ff6fae", label: "Pink Trail", cost: 2 },
  { id: "tr_white", hex: "#ffffff", label: "White Trail", cost: 2 },
  { id: "tr_gold", hex: "#ffd700", label: "Gold Trail", cost: 2 },
];

// Bullet types — the 5 requested plus a few extra variants. Most are
// visual reskins; explosive/split/blackhole/ice carry a small mechanical
// twist noted in their detail text.
const SHOP_BULLETS = [
  { id: "bl_fire", label: "Orange Bullets", cost: 5, detail: "" },
  { id: "bl_explosive", label: "Explosive Bullets", cost: 5, detail: "small blast radius damages nearby targets" },
  { id: "bl_blackhole", label: "Black Hole Bullets", cost: 5, detail: "a dark core that gently pulls nearby targets" },
  { id: "bl_star", label: "Star-Infused Bullets", cost: 5, detail: "a sparkling multicolor starlight trail" },
  { id: "bl_split", label: "Splitting Bullets", cost: 5, detail: "splits into two smaller bullets on impact" },
  { id: "bl_ice", label: "Ice Bullets", cost: 5, detail: "frosty rounds that chill targets on impact" },
  { id: "bl_plasma", label: "Plasma Bullets", cost: 5, detail: "crackling electric bolts" },
  { id: "bl_toxic", label: "Toxic Bullets", cost: 5, detail: "a dripping venomous green trail" },
  { id: "bl_banana", label: "Banana Bullets", cost: 5, detail: "bananas bananas bananas" },
];
const BULLET_TYPE_COLORS = {
  bl_fire: "#ff6a1a",
  bl_explosive: "#ff3b30",
  bl_blackhole: "#a855f7",
  bl_star: "#ffe066",
  bl_split: "#5ee6d0",
  bl_ice: "#8fe8ff",
  bl_plasma: "#f5f000",
  bl_toxic: "#7dff4a",
  bl_banana: "#f5d505",
};
function bulletDamage(s, b) {
  const p = s.player;
  const fireComboActive = p.color === "#ff8c1a" && p.trail === "tr_orange" && p.bullet === "bl_fire";
  return b.type === "bl_fire" && fireComboActive ? 10 : 1;
}

const TUTORIAL_PAGES = [
  {
    icon: "🕹️",
    title: "Piloting",
    body: "Move with Arrow Keys or WASD — or drag anywhere on mobile. Your ship auto-fires forward, so just focus on staying alive.",
  },
  {
    icon: "⚡",
    title: "Power-Ups",
    body: "Clear a wave and you'll get a random upgrade: Triple Shot, Rapid Fire, Overcharged Rounds, Piercing Rounds, or Thruster Boost. They stack — the same one twice makes it even stronger.",
  },
  {
    icon: "⚠️",
    title: "System Faults",
    body: "Roughly every 15 seconds a random fault hits your ship: Nav Locked (controls frozen), Weapons Offline (can't fire), Thruster Failure (badly slowed for a few seconds), or rarely a Hull Breach that costs a life outright. Watch the alert at the top of the screen.",
  },
  {
    icon: "🪨",
    title: "Asteroids",
    body: "Cratered rocks drift down the field. Small ones die in one hit; larger, darker ones take two. Destroying them is your main source of score.",
  },
  {
    icon: "👾",
    title: "Bosses",
    body: "Every 5th wave, a boss arrives with three attacks: a flak spread, an aimed volley, and a sweeping laser beam. Each one has more HP than the last. At wave 25, a Mega Boss appears — faster, tougher, with a fourth attack: a radial burst.",
  },
  {
    icon: "💥",
    title: "Lives",
    body: "You start with three lives. Get hit three times — by an asteroid, boss fire, or a hull breach — and it's game over. Stay sharp, dodge often, and don't get greedy.",
  },
  {
    icon: "🏆",
    title: "Trophies & The Shop",
    body: "Beat a wave-25 mega boss and you'll earn a trophy. Spend trophies in the Shop (on the title screen) on new hull forms, ship colors, engine trails, and bullet types — all purely your choice of style and loadout.",
  },
  {
    icon: "🌌",
    title: "Beyond Homeworld",
    body: "Trophies can also buy passage to new worlds beyond Homeworld — each with its own look, hazards, and enemies. Getting there costs everything you've saved, and there's no turning back once you go... so choose wisely between upgrading your ship or pushing further out.",
  },
];

const CUTSCENE_GROUND_END = 150;
const CUTSCENE_LIFTOFF_END = 330;
const CUTSCENE_ASCENT_END = 480;
const CUTSCENE_DURATION = 620;

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
// Sky keyframes the cutscene lerps between as it progresses from a warm
// homeworld sunset up through dusk and into open space.
const SKY_KEYFRAMES = [
  { at: 0, top: "#ff9a56", bottom: "#ffe0a3" },
  { at: 0.24, top: "#7a4a8f", bottom: "#ff9a66" },
  { at: 0.53, top: "#241a45", bottom: "#5a3a7a" },
  { at: 0.77, top: "#0a0a16", bottom: "#1a1030" },
  { at: 1, top: "#05060a", bottom: "#05060a" },
];
function skyColorsAt(progress) {
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const a = SKY_KEYFRAMES[i];
    const b = SKY_KEYFRAMES[i + 1];
    if (progress >= a.at && progress <= b.at) {
      const t = (progress - a.at) / (b.at - a.at || 1);
      return { top: mixColor(a.top, b.top, t), bottom: mixColor(a.bottom, b.bottom, t) };
    }
  }
  const last = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  return { top: last.top, bottom: last.bottom };
}

async function loadShipConfig() {
  try {
    const res = await window.storage.get(SHIP_CONFIG_KEY);
    const cfg = res ? JSON.parse(res.value) : null;
    if (cfg && SHIP_SHAPES[cfg.shape] && typeof cfg.color === "string") {
      return { trail: "none", bullet: "standard", ...cfg };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_SHIP_CONFIG };
}

async function saveShipConfig(cfg, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await window.storage.set(SHIP_CONFIG_KEY, JSON.stringify(cfg));
      if (result) return true;
    } catch (e) {
      if (i === attempts - 1) console.error("Could not save ship config", e);
    }
  }
  return false;
}

const OWNED_KEY = "void-runner-owned-items";
const DEFAULT_OWNED = { shapes: [], colors: [], trails: [], bullets: [] };

async function loadOwnedItems() {
  try {
    const res = await window.storage.get(OWNED_KEY);
    const v = res ? JSON.parse(res.value) : null;
    if (v && typeof v === "object") {
      return {
        shapes: Array.isArray(v.shapes) ? v.shapes : [],
        colors: Array.isArray(v.colors) ? v.colors : [],
        trails: Array.isArray(v.trails) ? v.trails : [],
        bullets: Array.isArray(v.bullets) ? v.bullets : [],
      };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_OWNED };
}

async function saveOwnedItems(owned, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await window.storage.set(OWNED_KEY, JSON.stringify(owned));
      if (result) return true;
    } catch (e) {
      if (i === attempts - 1) console.error("Could not save owned items", e);
    }
  }
  return false;
}

const LOADOUT_PRESETS_KEY = "void-runner-loadout-presets";
const DEFAULT_LOADOUT_PRESETS = [null, null, null];

async function loadLoadoutPresets() {
  try {
    const res = await window.storage.get(LOADOUT_PRESETS_KEY);
    const v = res ? JSON.parse(res.value) : null;
    if (Array.isArray(v)) {
      const slots = [null, null, null];
      for (let i = 0; i < 3; i++) slots[i] = v[i] || null;
      return slots;
    }
  } catch {
    // fall through to default
  }
  return [...DEFAULT_LOADOUT_PRESETS];
}
async function saveLoadoutPresets(v) {
  try {
    await window.storage.set(LOADOUT_PRESETS_KEY, JSON.stringify(v));
  } catch (e) {
    console.error("Could not save loadout presets", e);
  }
}

// Power-ups roll on every completed wave. Effects stack if rolled again.
const POWERUPS = [
  {
    id: "triple",
    label: "TRIPLE SHOT",
    detail: "fires 3 bullets in a spread",
    apply: (p) => (p.spread = Math.min(5, p.spread + 2)), // 1 -> 3 -> 5
  },
  {
    id: "rapid",
    label: "RAPID FIRE",
    detail: "faster reload",
    apply: (p) => (p.cooldown = Math.max(2, p.cooldown - 3)),
  },
  {
    id: "velocity",
    label: "OVERCHARGED ROUNDS",
    detail: "bullets travel faster",
    apply: (p) => (p.bulletSpeedMult = +(p.bulletSpeedMult + 0.35).toFixed(2)),
  },
  {
    id: "pierce",
    label: "PIERCING ROUNDS",
    detail: "bullets punch through asteroids",
    apply: (p) => (p.pierce = true),
  },
  {
    id: "thrusters",
    label: "THRUSTER BOOST",
    detail: "faster dodging",
    apply: (p) => (p.speedMult = +(p.speedMult + 0.18).toFixed(2)),
  },
];

// Frontier world power-ups — different flavor, plus two new mechanics
// (a one-time bonus life and auto-firing escort drones).
const FRONTIER_POWERUPS = [
  {
    id: "nova",
    label: "NOVA BARRAGE",
    detail: "a much wider spread shot",
    apply: (p) => (p.spread = Math.min(7, p.spread + 2)),
  },
  {
    id: "overdrive",
    label: "OVERDRIVE CORE",
    detail: "faster reload and faster dodging",
    apply: (p) => {
      p.cooldown = Math.max(2, p.cooldown - 2);
      p.speedMult = +(p.speedMult + 0.12).toFixed(2);
    },
  },
  {
    id: "cryo",
    label: "CRYO ROUNDS",
    detail: "bullets punch clean through targets",
    apply: (p) => (p.pierce = true),
  },
  {
    id: "fueltank",
    label: "FUEL TANK",
    detail: "grants a bonus life — once per run",
    // the actual life increment happens in grantPowerUp, which has
    // access to the full game state; this pool entry just needs to exist
    apply: () => {},
  },
  {
    id: "droneescort",
    label: "DRONE ESCORT",
    detail: "a wingman drone that fires alongside you",
    apply: (p) => (p.drones = Math.min(2, (p.drones || 0) + 1)),
  },
];

// Outworld power-ups — fire/gravity themed.
const OUTWORLD_POWERUPS = [
  {
    id: "solarflare",
    label: "SOLAR FLARE",
    detail: "a scorching wide spread shot",
    apply: (p) => (p.spread = Math.min(7, p.spread + 2)),
  },
  {
    id: "gravitythrusters",
    label: "GRAVITY THRUSTERS",
    detail: "faster reload and faster dodging",
    apply: (p) => {
      p.cooldown = Math.max(2, p.cooldown - 2);
      p.speedMult = +(p.speedMult + 0.12).toFixed(2);
    },
  },
  {
    id: "singularity",
    label: "SINGULARITY ROUNDS",
    detail: "bullets punch clean through targets",
    apply: (p) => (p.pierce = true),
  },
  {
    id: "plasmaaccelerator",
    label: "PLASMA ACCELERATOR",
    detail: "superheated rounds travel much faster",
    apply: (p) => (p.bulletSpeedMult = +(p.bulletSpeedMult + 0.4).toFixed(2)),
  },
  {
    id: "cometdrone",
    label: "COMET DRONE",
    detail: "a wingman drone that fires alongside you",
    apply: (p) => (p.drones = Math.min(2, (p.drones || 0) + 1)),
  },
];

// Wormhole power-ups — starlight/warp themed. Deliberately no shield.
const WORMHOLE_POWERUPS = [
  {
    id: "starburst",
    label: "STARBURST",
    detail: "a brilliant wide spread shot",
    apply: (p) => (p.spread = Math.min(7, p.spread + 2)),
  },
  {
    id: "warpthrusters",
    label: "WARP THRUSTERS",
    detail: "faster reload and faster dodging",
    apply: (p) => {
      p.cooldown = Math.max(2, p.cooldown - 2);
      p.speedMult = +(p.speedMult + 0.12).toFixed(2);
    },
  },
  {
    id: "phaserounds",
    label: "PHASE ROUNDS",
    detail: "bullets punch clean through targets",
    apply: (p) => (p.pierce = true),
  },
  {
    id: "tachyonrounds",
    label: "TACHYON ROUNDS",
    detail: "faster-than-light rounds, blistering speed",
    apply: (p) => (p.bulletSpeedMult = +(p.bulletSpeedMult + 0.4).toFixed(2)),
  },
  {
    id: "stardrone",
    label: "STAR DRONE",
    detail: "a wingman drone that fires alongside you",
    apply: (p) => (p.drones = Math.min(2, (p.drones || 0) + 1)),
  },
];

const WORLD_KEY = "void-runner-world";
// Worlds define which power-up pool, rock style, and boss scaling apply.
// Each unlocks in order — the Frontier costs 5 trophies from Homeworld,
// the Outworld costs 5 more from the Frontier, the Wormhole costs 5 more
// from the Outworld. Every jump is one-way — until the Wormhole's
// mothership is defeated, which unlocks free travel between all worlds.
const WORLDS = {
  homeworld: {
    id: "homeworld",
    name: "Homeworld",
    unlockTrophies: 0,
    powerups: POWERUPS,
    rockStyle: "rock",
    bossHpMult: 1,
    bossSpeedMult: 1,
    extraBossMove: false,
  },
  frontier: {
    id: "frontier",
    name: "The Frontier",
    unlockTrophies: 5,
    powerups: FRONTIER_POWERUPS,
    rockStyle: "crystal",
    bossHpMult: 1.6,
    bossSpeedMult: 0.85,
    extraBossMove: true,
  },
  outworld: {
    id: "outworld",
    name: "The Outworld",
    unlockTrophies: 5,
    powerups: OUTWORLD_POWERUPS,
    rockStyle: "comet",
    bossHpMult: 2.2,
    bossSpeedMult: 0.75,
    extraBossMove: true,
  },
  wormhole: {
    id: "wormhole",
    name: "The Wormhole",
    unlockTrophies: 5,
    powerups: WORMHOLE_POWERUPS,
    rockStyle: "star",
    bossHpMult: 3,
    motherShipHpMult: 15,
    bossSpeedMult: 0.68,
    extraBossMove: true,
    isFinalWorld: true,
  },
};
const WORLD_ORDER = ["homeworld", "frontier", "outworld", "wormhole"];

// Recolors the travel cutscene per destination — icy blue for the
// Frontier, purple for the Outworld, dark green for the Wormhole (which
// also gets a comms-call intro instead of a system boot readout).
function travelTheme(world) {
  if (world === "outworld") {
    return {
      streak: "rgba(200,120,255,0.7)",
      flashColor: "rgba(235,210,255,",
      arrivalBg: "#0a0316",
      monitorBorder: "#a020f0",
      monitorText: "#e0b3ff",
      bannerColor: "#e0b3ff",
      bannerGlow: "#a020f0",
      bannerText: "HYPERDRIVE ENGAGED",
    };
  }
  if (world === "wormhole") {
    return {
      streak: "rgba(80,255,160,0.7)",
      flashColor: "rgba(200,255,220,",
      arrivalBg: "#020e08",
      monitorBorder: "#1fa85a",
      monitorText: "#8affc0",
      bannerColor: "#8affc0",
      bannerGlow: "#1fa85a",
      bannerText: "WORMHOLE ENTRY",
      isCall: true,
    };
  }
  return {
    streak: "rgba(150,220,255,0.7)",
    flashColor: "rgba(220,245,255,",
    arrivalBg: "#020611",
    monitorBorder: "#4fd6ff",
    monitorText: "#8fe8ff",
    bannerColor: "#8fe8ff",
    bannerGlow: "#4fd6ff",
    bannerText: "HYPERDRIVE ENGAGED",
  };
}

async function loadWorld() {
  try {
    const res = await window.storage.get(WORLD_KEY);
    const w = res ? JSON.parse(res.value) : null;
    if (w && WORLDS[w]) return w;
  } catch {
    // fall through to default
  }
  return "homeworld";
}
async function saveWorld(w) {
  try {
    await window.storage.set(WORLD_KEY, JSON.stringify(w));
  } catch (e) {
    console.error("Could not save world selection", e);
  }
}

// Degrades roll every ~15 seconds during play — small system faults that
// briefly hinder the ship. "Lose a life" is intentionally rare.
const DEGRADES = [
  {
    id: "freeze",
    label: "NAV LOCKED",
    detail: "controls frozen",
    weight: 30,
    apply: (s) => {
      s.player.frozen = 60; // 1s
    },
  },
  {
    id: "disarm",
    label: "WEAPONS OFFLINE",
    detail: "no bullets",
    weight: 30,
    apply: (s) => {
      s.player.disarmed = 180; // 3s
    },
  },
  {
    id: "slowed",
    label: "THRUSTER FAILURE",
    detail: "movement badly slowed",
    weight: 30,
    apply: (s) => {
      s.player.slowed = 300; // 5s
    },
  },
  {
    id: "loselife",
    label: "HULL BREACH",
    detail: "-1 life",
    weight: 5,
    apply: (s) => {
      damagePlayer(s, "System Fault: Hull Breach");
    },
  },
];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// A quiet, looping WAV kept playing in the background the moment the
// person first interacts with the page. This is a well-known mobile
// Safari/iOS trick: an actual <audio> element counts as "media playback"
// rather than an "ambient" web sound, which puts the whole page's audio
// session into a category that bypasses the hardware silent/mute switch —
// so the rest of the game's Web Audio API sound effects ride along with it
// and keep working even when the phone is physically muted.
const AUDIO_UNLOCK_DATA_URI = "data:audio/wav;base64,UklGRkZWAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YSJWAAAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAQABAAEAAgACAAIAAgACAAEAAQABAAEAAAAAAAAAAAAAAP///v/+//3//f/8//z//P/7//v/+//7//v/+//7//v//P/8//3//v//////AAAAAAEAAgADAAQABQAGAAcABwAIAAgACQAJAAkACQAJAAgABwAHAAYABQAEAAIAAQAAAP///v/8//v/+v/4//f/9v/1//T/9P/0//P/8//0//T/9f/2//f/+P/5//v//P/+/wAAAQADAAUABwAIAAoADAANAA4ADwAQABAAEAAQABAADwAPAA4ADAALAAkABwAFAAIAAAD///z/+v/4//b/9P/y//D/7//t/+3/7P/s/+z/7P/t/+7/7//x//P/9f/4//r//f8AAAEABAAHAAoADAAPABEAEwAVABYAFwAYABgAGAAXABcAFQAUABIADwANAAoABwAEAAEA///7//j/9f/y/+//7P/q/+j/5//l/+X/5P/k/+X/5v/n/+n/6//u//H/9P/4//v///8CAAUACQANABAAEwAWABkAGwAdAB4AHwAfAB8AHwAeABwAGgAXABUAEQAOAAoABgACAP7/+v/2//L/7v/q/+f/5P/i/+D/3v/d/93/3f/e/9//4f/j/+b/6f/t//D/9f/5//7/AgAGAAsADwAUABgAGwAfACEAJAAlACYAJwAnACYAJQAjACAAHQAaABYAEQANAAgAAwD///n/9P/v/+v/5v/i/9//3P/Z/9f/1v/V/9X/1v/Y/9r/3P/g/+T/6P/t//L/9//9/wEABwANABIAFwAcACAAJAAoACoALAAuAC4ALgAuACwAKgAnACMAHwAaABUAEAAKAAQA///5//P/7f/n/+L/3f/Z/9X/0v/Q/8//zv/O/8//0P/T/9b/2v/e/+P/6f/v//X/+/8BAAcADgAUABoAIAAlACoALgAxADMANQA2ADYANQAzADEALQApACUAHwAZABMADAAFAP//+P/x/+v/5P/e/9n/1P/P/8z/yf/H/8b/xv/H/8n/zP/P/9P/2f/e/+T/6//y//r/AAAIAA8AFgAdACMAKQAuADIANgA5ADsAOwA7ADoAOAA2ADIALQAoACIAHAAVAA4ABwAAAPn/8f/q/+P/3f/X/9L/zv/K/8f/xv/F/8X/xv/H/8r/zv/S/9f/3f/k/+r/8f/5/wAABwAOABUAHAAjACgALgAyADYAOAA6ADsAOwA7ADkANgAyAC4AKQAjAB0AFgAPAAgAAAD6//L/6//k/97/2P/T/87/y//I/8b/xf/F/8X/x//K/83/0v/X/9z/4//q//H/+P///wYADQAVABsAIgAoAC0AMgA1ADgAOgA7ADsAOwA5ADYAMwAvACoAJAAeABcAEAAIAAEA+v/z/+z/5f/e/9n/0//P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/c/+L/6f/w//f///8FAA0AFAAbACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADMALwAqACUAHgAYABEACQACAPv/9P/t/+b/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zP/R/9b/2//h/+j/7//2//7/BAAMABMAGgAgACYALAAxADQAOAA6ADsAOwA7ADkANwA0ADAAKwAlAB8AGAARAAoAAwD8//X/7f/m/+D/2v/U/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4f/n/+7/9f/9/wMACwASABkAIAAmACsAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJgAgABkAEgALAAQA/f/2/+7/5//h/9v/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1P/a/+D/5v/t//X//P8DAAoAEQAYAB8AJQArADAANAA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABMADAAEAP7/9v/v/+j/4f/b/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9T/2f/f/+b/7f/0//v/AgAJABEAGAAeACQAKgAvADMANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGwAUAA0ABQD///f/8P/p/+L/3P/W/9H/zf/K/8f/xf/F/8X/xv/I/8v/z//T/9n/3v/l/+z/8//6/wEACAAQABcAHgAkACkALwAzADYAOQA7ADsAOwA6ADgANQAyAC0AKAAiABwAFQANAAYAAAD4//H/6v/j/93/1//S/83/yv/H/8X/xf/F/8b/yP/K/87/0//Y/97/5P/r//L/+v8AAAgADwAWAB0AIwApAC4AMgA2ADkAOgA7ADsAOgA4ADYAMgAuACgAIwAcABUADgAHAAAA+f/y/+r/5P/d/9f/0v/O/8r/x//G/8X/xf/G/8f/yv/O/9L/1//d/+P/6v/x//n/AAAHAA4AFQAcACIAKAAtADIANgA4ADoAOwA7ADsAOQA2ADIALgApACMAHQAWAA8ACAAAAPr/8v/r/+T/3v/Y/9P/zv/L/8j/xv/F/8X/xf/H/8r/zf/S/9f/3P/j/+n/8P/4////BgANABQAGwAiACgALQAxADUAOAA6ADsAOwA7ADkANgAzAC8AKgAkAB4AFwAQAAkAAQD7//P/7P/l/9//2f/T/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9z/4v/p//D/9//+/wUADAAUABsAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJQAeABgAEQAJAAIA+//0/+3/5v/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/M/9H/1f/b/+H/6P/v//b//v8EAAwAEwAaACAAJgAsADAANAA4ADoAOwA7ADsAOQA3ADQAMAArACUAHwAZABIACgADAPz/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9X/2v/g/+f/7v/1//3/AwALABIAGQAgACYAKwAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsABAD9//b/7v/n/+H/2//V/9D/zP/J/8f/xf/F/8X/xv/I/8z/0P/U/9r/4P/m/+3/9P/8/wIACgARABgAHwAlACsALwA0ADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABoAEwAMAAUA/v/3/+//6P/i/9v/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5f/s//T/+/8CAAkAEAAXAB4AJAAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAtACcAIQAbABQADQAFAP//9//w/+n/4v/c/9b/0f/N/8r/x//F/8X/xf/G/8j/y//P/9P/2P/e/+X/7P/z//r/AQAIABAAFwAdACQAKQAuADMANgA5ADsAOwA7ADoAOAA1ADIALQAoACIAHAAVAA4ABgAAAPj/8f/q/+P/3f/X/9L/zv/K/8f/xf/F/8X/xv/I/8r/zv/T/9j/3v/k/+v/8v/5/wAABwAPABYAHQAjACkALgAyADYAOQA6ADsAOwA6ADkANgAyAC4AKQAjABwAFgAOAAcAAAD5//L/6//k/93/2P/S/87/yv/I/8b/xf/F/8b/x//K/87/0v/X/93/4//q//H/+P8AAAYADgAVABwAIgAoAC0AMgA2ADgAOgA7ADsAOwA5ADYAMwAuACkAIwAdABYADwAIAAAA+v/z/+v/5P/e/9j/0//O/8v/yP/G/8X/xf/F/8f/yv/N/9H/1//c/+L/6f/w//j///8GAA0AFAAbACIAJwAtADEANQA4ADoAOwA7ADsAOQA2ADMALwAqACQAHgAXABAACQABAPv/8//s/+X/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zf/R/9b/3P/i/+j/7//3//7/BQAMABMAGgAhACcALAAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAlAB8AGAARAAoAAgD8//T/7f/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/8z/0P/V/9v/4f/o/+//9v/9/wQACwATABoAIAAmACwAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJQAfABkAEgAKAAMA/P/1/+7/5//g/9r/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1f/a/+D/5//u//X//f8DAAsAEgAZAB8AJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAAsACYAIAAaABMACwAEAP3/9v/v/+j/4f/b/9X/0P/M/8n/x//F/8X/xf/G/8j/zP/P/9T/2v/g/+b/7f/0//z/AgAKABEAGAAfACUAKgAvADQANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGgATAAwABQD+//f/7//o/+L/2//W/9H/zf/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//l/+z/8//7/wEACQAQABcAHgAkACoALwAzADcAOQA7ADsAOwA6ADgANQAxAC0AJwAiABsAFAANAAYA///4//D/6f/i/9z/1v/R/83/yv/H/8X/xf/F/8b/yP/L/87/0//Y/97/5f/r//P/+v8BAAgADwAWAB0AJAApAC4AMwA2ADkAOwA7ADsAOgA4ADUAMgAtACgAIgAcABUADgAGAAAA+P/x/+r/4//d/9f/0v/O/8r/x//F/8X/xf/G/8j/yv/O/9L/2P/d/+T/6//y//n/AAAHAA8AFgAcACMAKQAuADIANgA5ADoAOwA7ADoAOQA2ADIALgApACMAHQAWAA8ABwAAAPn/8v/r/+T/3v/Y/9P/zv/K/8j/xv/F/8X/xf/H/8r/zv/S/9f/3f/j/+r/8f/4/wAABgAOABUAHAAiACgALQAyADUAOAA6ADsAOwA7ADkANgAzAC4AKQAkAB0AFwAPAAgAAQD6//P/6//l/97/2P/T/8//y//I/8b/xf/F/8X/x//K/83/0f/W/9z/4v/p//D/9////wUADQAUABsAIQAnAC0AMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJAAeABcAEAAJAAEA+//0/+z/5f/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/b/+L/6P/v//f//v8FAAwAEwAaACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADQALwArACUAHwAYABEACgACAPz/9P/t/+b/4P/a/9T/z//M/8j/xv/F/8X/xf/H/8n/zP/Q/9X/2//h/+f/7v/2//3/BAALABIAGQAgACYALAAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsAAwD9//X/7v/n/+D/2v/V/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4P/n/+7/9f/8/wMACgASABkAHwAlACsAMAA0ADcAOQA7ADsAOwA6ADgANAAwACwAJgAgABoAEwALAAQA/v/2/+//6P/h/9v/1f/Q/8z/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5v/t//T//P8CAAoAEQAYAB8AJQAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABQADAAFAP7/9//w/+j/4v/c/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9P/2f/f/+X/7P/z//v/AQAJABAAFwAeACQAKgAvADMANgA5ADsAOwA7ADoAOAA1ADEALQAoACIAGwAUAA0ABgD///j/8P/p/+P/3P/X/9L/zf/K/8f/xf/F/8X/xv/I/8v/zv/T/9j/3v/k/+v/8v/6/wAACAAPABYAHQAjACkALgAzADYAOQA7ADsAOwA6ADgANgAyAC0AKAAiABwAFQAOAAcAAAD5//H/6v/j/93/1//S/87/yv/H/8b/xf/F/8b/x//K/87/0v/Y/93/5P/q//L/+f8AAAcADgAWABwAIwAoAC4AMgA2ADkAOgA7ADsAOgA5ADYAMgAuACkAIwAdABYADwAHAAAA+f/y/+v/5P/e/9j/0//O/8r/yP/G/8X/xf/F/8f/yv/N/9L/1//d/+P/6v/x//j/AAAGAA4AFQAcACIAKAAtADIANQA4ADoAOwA7ADsAOQA2ADMALgApACQAHQAXABAACAABAPr/8//s/+X/3v/Y/9P/z//L/8j/xv/F/8X/xf/H/8r/zf/R/9b/3P/i/+n/8P/3////BQANABQAGwAhACcALQAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAkAB4AGAAQAAkAAgD7//T/7P/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9v/4f/o/+//9v/+/wQADAATABoAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcANAAwACsAJQAfABgAEQAKAAIA/P/1/+3/5v/g/9r/1P/Q/8z/yP/G/8X/xf/F/8f/yf/M/9D/1f/b/+H/5//u//b//f8EAAsAEgAZACAAJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAArACYAIAAZABIACwADAP3/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9T/2v/g/+f/7v/1//z/AwAKABIAGQAfACUAKwAwADQANwA5ADsAOwA7ADoAOAA0ADEALAAmACAAGgATAAwABAD+//b/7//o/+H/2//V/9H/zP/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//m/+3/9P/7/wIACQARABgAHgAlACoALwAzADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABsAFAAMAAUA///3//D/6f/i/9z/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//0//Z/9//5f/s//P/+/8BAAkAEAAXAB4AJAAqAC8AMwA2ADkAOwA7ADsAOgA4ADUAMQAtACgAIgAbABUADQAGAP//+P/x/+n/4//c/9f/0v/N/8r/x//F/8X/xf/G/8j/y//O/9P/2P/e/+T/6//y//r/AAAIAA8AFgAdACMAKQAuADIANgA5ADsAOwA7ADoAOAA2ADIALQAoACIAHAAVAA4ABwAAAPn/8f/q/+P/3f/X/9L/zv/K/8f/xv/F/8X/xv/H/8r/zv/S/9f/3f/k/+r/8f/5/wAABwAOABUAHAAjACgALgAyADYAOAA6ADsAOwA7ADkANgAyAC4AKQAjAB0AFgAPAAgAAAD6//L/6//k/97/2P/T/87/y//I/8b/xf/F/8X/x//K/83/0v/X/9z/4//q//H/+P///wYADQAVABsAIgAoAC0AMgA1ADgAOgA7ADsAOwA5ADYAMwAvACoAJAAeABcAEAAIAAEA+v/z/+z/5f/e/9n/0//P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/c/+L/6f/w//f///8FAA0AFAAbACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADMALwAqACUAHgAYABEACQACAPv/9P/t/+b/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zP/R/9b/2//h/+j/7//2//7/BAAMABMAGgAgACYALAAxADQAOAA6ADsAOwA7ADkANwA0ADAAKwAlAB8AGAARAAoAAwD8//X/7f/m/+D/2v/U/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4f/n/+7/9f/9/wMACwASABkAIAAmACsAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJgAgABkAEgALAAQA/f/2/+7/5//h/9v/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1P/a/+D/5v/t//X//P8DAAoAEQAYAB8AJQArADAANAA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABMADAAEAP7/9v/v/+j/4f/b/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9T/2f/f/+b/7f/0//v/AgAJABEAGAAeACQAKgAvADMANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGwAUAA0ABQD///f/8P/p/+L/3P/W/9H/zf/K/8f/xf/F/8X/xv/I/8v/z//T/9n/3v/l/+z/8//6/wEACAAQABcAHgAkACkALwAzADYAOQA7ADsAOwA6ADgANQAyAC0AKAAiABwAFQANAAYAAAD4//H/6v/j/93/1//S/83/yv/H/8X/xf/F/8b/yP/K/87/0//Y/97/5P/r//L/+v8AAAgADwAWAB0AIwApAC4AMgA2ADkAOgA7ADsAOgA4ADYAMgAuACgAIwAcABUADgAHAAAA+f/y/+r/5P/d/9f/0v/O/8r/x//G/8X/xf/G/8f/yv/O/9L/1//d/+P/6v/x//n/AAAHAA4AFQAcACIAKAAtADIANgA4ADoAOwA7ADsAOQA2ADIALgApACMAHQAWAA8ACAAAAPr/8v/r/+T/3v/Y/9P/zv/L/8j/xv/F/8X/xf/H/8r/zf/S/9f/3P/j/+n/8P/4////BgANABQAGwAiACgALQAxADUAOAA6ADsAOwA7ADkANgAzAC8AKgAkAB4AFwAQAAkAAQD7//P/7P/l/9//2f/T/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9z/4v/p//D/9//+/wUADAAUABsAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJQAeABgAEQAJAAIA+//0/+3/5v/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/M/9H/1f/b/+H/6P/v//b//v8EAAwAEwAaACAAJgAsADAANAA4ADoAOwA7ADsAOQA3ADQAMAArACUAHwAZABIACgADAPz/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9X/2v/g/+f/7v/1//3/AwALABIAGQAgACYAKwAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsABAD9//b/7v/n/+H/2//V/9D/zP/J/8f/xf/F/8X/xv/I/8z/0P/U/9r/4P/m/+3/9P/8/wIACgARABgAHwAlACsALwA0ADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABoAEwAMAAUA/v/3/+//6P/i/9v/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5f/s//T/+/8CAAkAEAAXAB4AJAAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAtACcAIQAbABQADQAFAP//9//w/+n/4v/c/9b/0f/N/8r/x//F/8X/xf/G/8j/y//P/9P/2P/e/+X/7P/z//r/AQAIABAAFwAdACQAKQAuADMANgA5ADsAOwA7ADoAOAA1ADIALQAoACIAHAAVAA4ABgAAAPj/8f/q/+P/3f/X/9L/zv/K/8f/xf/F/8X/xv/I/8r/zv/T/9j/3v/k/+v/8v/5/wAABwAPABYAHQAjACkALgAyADYAOQA6ADsAOwA6ADkANgAyAC4AKQAjABwAFgAOAAcAAAD5//L/6//k/93/2P/S/87/yv/I/8b/xf/F/8b/x//K/87/0v/X/93/4//q//H/+P8AAAYADgAVABwAIgAoAC0AMgA2ADgAOgA7ADsAOwA5ADYAMwAuACkAIwAdABYADwAIAAAA+v/z/+v/5P/e/9j/0//O/8v/yP/G/8X/xf/F/8f/yv/N/9H/1//c/+L/6f/w//j///8GAA0AFAAbACIAJwAtADEANQA4ADoAOwA7ADsAOQA2ADMALwAqACQAHgAXABAACQABAPv/8//s/+X/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zf/R/9b/3P/i/+j/7//3//7/BQAMABMAGgAhACcALAAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAlAB8AGAARAAoAAgD8//T/7f/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/8z/0P/V/9v/4f/o/+//9v/9/wQACwATABoAIAAmACwAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJQAfABkAEgAKAAMA/P/1/+7/5//g/9r/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1f/a/+D/5//u//X//f8DAAsAEgAZAB8AJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAAsACYAIAAaABMACwAEAP3/9v/v/+j/4f/b/9X/0P/M/8n/x//F/8X/xf/G/8j/zP/P/9T/2v/g/+b/7f/0//z/AgAKABEAGAAfACUAKgAvADQANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGgATAAwABQD+//f/7//o/+L/2//W/9H/zf/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//l/+z/8//7/wEACQAQABcAHgAkACoALwAzADcAOQA7ADsAOwA6ADgANQAxAC0AJwAiABsAFAANAAYA///4//D/6f/i/9z/1v/R/83/yv/H/8X/xf/F/8b/yP/L/87/0//Y/97/5f/r//P/+v8BAAgADwAWAB0AJAApAC4AMwA2ADkAOwA7ADsAOgA4ADUAMgAtACgAIgAcABUADgAGAAAA+P/x/+r/4//d/9f/0v/O/8r/x//F/8X/xf/G/8j/yv/O/9L/2P/d/+T/6//y//n/AAAHAA8AFgAcACMAKQAuADIANgA5ADoAOwA7ADoAOQA2ADIALgApACMAHQAWAA8ABwAAAPn/8v/r/+T/3v/Y/9P/zv/K/8j/xv/F/8X/xf/H/8r/zv/S/9f/3f/j/+r/8f/4/wAABgAOABUAHAAiACgALQAyADUAOAA6ADsAOwA7ADkANgAzAC4AKQAkAB0AFwAPAAgAAQD6//P/6//l/97/2P/T/8//y//I/8b/xf/F/8X/x//K/83/0f/W/9z/4v/p//D/9////wUADQAUABsAIQAnAC0AMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJAAeABcAEAAJAAEA+//0/+z/5f/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/b/+L/6P/v//f//v8FAAwAEwAaACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADQALwArACUAHwAYABEACgACAPz/9P/t/+b/4P/a/9T/z//M/8j/xv/F/8X/xf/H/8n/zP/Q/9X/2//h/+f/7v/2//3/BAALABIAGQAgACYALAAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsAAwD9//X/7v/n/+D/2v/V/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4P/n/+7/9f/8/wMACgASABkAHwAlACsAMAA0ADcAOQA7ADsAOwA6ADgANAAwACwAJgAgABoAEwALAAQA/v/2/+//6P/h/9v/1f/Q/8z/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5v/t//T//P8CAAoAEQAYAB8AJQAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABQADAAFAP7/9//w/+j/4v/c/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9P/2f/f/+X/7P/z//v/AQAJABAAFwAeACQAKgAvADMANgA5ADsAOwA7ADoAOAA1ADEALQAoACIAGwAUAA0ABgD///j/8P/p/+P/3P/X/9L/zf/K/8f/xf/F/8X/xv/I/8v/zv/T/9j/3v/k/+v/8v/6/wAACAAPABYAHQAjACkALgAzADYAOQA7ADsAOwA6ADgANgAyAC0AKAAiABwAFQAOAAcAAAD5//H/6v/j/93/1//S/87/yv/H/8b/xf/F/8b/x//K/87/0v/Y/93/5P/q//L/+f8AAAcADgAWABwAIwAoAC4AMgA2ADkAOgA7ADsAOgA5ADYAMgAuACkAIwAdABYADwAHAAAA+f/y/+v/5P/e/9j/0//O/8r/yP/G/8X/xf/F/8f/yv/N/9L/1//d/+P/6v/x//j/AAAGAA4AFQAcACIAKAAtADIANQA4ADoAOwA7ADsAOQA2ADMALgApACQAHQAXABAACAABAPr/8//s/+X/3v/Y/9P/z//L/8j/xv/F/8X/xf/H/8r/zf/R/9b/3P/i/+n/8P/3////BQANABQAGwAhACcALQAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAkAB4AGAAQAAkAAgD7//T/7P/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9v/4f/o/+//9v/+/wQADAATABoAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcANAAwACsAJQAfABgAEQAKAAIA/P/1/+3/5v/g/9r/1P/Q/8z/yP/G/8X/xf/F/8f/yf/M/9D/1f/b/+H/5//u//b//f8EAAsAEgAZACAAJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAArACYAIAAZABIACwADAP3/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9T/2v/g/+f/7v/1//z/AwAKABIAGQAfACUAKwAwADQANwA5ADsAOwA7ADoAOAA0ADEALAAmACAAGgATAAwABAD+//b/7//o/+H/2//V/9H/zP/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//m/+3/9P/7/wIACQARABgAHgAlACoALwAzADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABsAFAAMAAUA///3//D/6f/i/9z/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//0//Z/9//5f/s//P/+/8BAAkAEAAXAB4AJAAqAC8AMwA2ADkAOwA7ADsAOgA4ADUAMQAtACgAIgAbABUADQAGAP//+P/x/+n/4//c/9f/0v/N/8r/x//F/8X/xf/G/8j/y//O/9P/2P/e/+T/6//y//r/AAAIAA8AFgAdACMAKQAuADIANgA5ADsAOwA7ADoAOAA2ADIALQAoACIAHAAVAA4ABwAAAPn/8f/q/+P/3f/X/9L/zv/K/8f/xv/F/8X/xv/H/8r/zv/S/9f/3f/k/+r/8f/5/wAABwAOABUAHAAjACgALgAyADYAOAA6ADsAOwA7ADkANgAyAC4AKQAjAB0AFgAPAAgAAAD6//L/6//k/97/2P/T/87/y//I/8b/xf/F/8X/x//K/83/0v/X/9z/4//q//H/+P///wYADQAVABsAIgAoAC0AMgA1ADgAOgA7ADsAOwA5ADYAMwAvACoAJAAeABcAEAAIAAEA+v/z/+z/5f/e/9n/0//P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/c/+L/6f/w//f///8FAA0AFAAbACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADMALwAqACUAHgAYABEACQACAPv/9P/t/+b/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zP/R/9b/2//h/+j/7//2//7/BAAMABMAGgAgACYALAAxADQAOAA6ADsAOwA7ADkANwA0ADAAKwAlAB8AGAARAAoAAwD8//X/7f/m/+D/2v/U/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4f/n/+7/9f/9/wMACwASABkAIAAmACsAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJgAgABkAEgALAAQA/f/2/+7/5//h/9v/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1P/a/+D/5v/t//X//P8DAAoAEQAYAB8AJQArADAANAA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABMADAAEAP7/9v/v/+j/4f/b/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9T/2f/f/+b/7f/0//v/AgAJABEAGAAeACQAKgAvADMANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGwAUAA0ABQD///f/8P/p/+L/3P/W/9H/zf/K/8f/xf/F/8X/xv/I/8v/z//T/9n/3v/l/+z/8//6/wEACAAQABcAHgAkACkALwAzADYAOQA7ADsAOwA6ADgANQAyAC0AKAAiABwAFQANAAYAAAD4//H/6v/j/93/1//S/83/yv/H/8X/xf/F/8b/yP/K/87/0//Y/97/5P/r//L/+v8AAAgADwAWAB0AIwApAC4AMgA2ADkAOgA7ADsAOgA4ADYAMgAuACgAIwAcABUADgAHAAAA+f/y/+r/5P/d/9f/0v/O/8r/x//G/8X/xf/G/8f/yv/O/9L/1//d/+P/6v/x//n/AAAHAA4AFQAcACIAKAAtADIANgA4ADoAOwA7ADsAOQA2ADIALgApACMAHQAWAA8ACAAAAPr/8v/r/+T/3v/Y/9P/zv/L/8j/xv/F/8X/xf/H/8r/zf/S/9f/3P/j/+n/8P/4////BgANABQAGwAiACgALQAxADUAOAA6ADsAOwA7ADkANgAzAC8AKgAkAB4AFwAQAAkAAQD7//P/7P/l/9//2f/T/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9z/4v/p//D/9//+/wUADAAUABsAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJQAeABgAEQAJAAIA+//0/+3/5v/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/M/9H/1f/b/+H/6P/v//b//v8EAAwAEwAaACAAJgAsADAANAA4ADoAOwA7ADsAOQA3ADQAMAArACUAHwAZABIACgADAPz/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9X/2v/g/+f/7v/1//3/AwALABIAGQAgACYAKwAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsABAD9//b/7v/n/+H/2//V/9D/zP/J/8f/xf/F/8X/xv/I/8z/0P/U/9r/4P/m/+3/9P/8/wIACgARABgAHwAlACsALwA0ADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABoAEwAMAAUA/v/3/+//6P/i/9v/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5f/s//T/+/8CAAkAEAAXAB4AJAAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAtACcAIQAbABQADQAFAP//9//w/+n/4v/c/9b/0f/N/8r/x//F/8X/xf/G/8j/y//P/9P/2P/e/+X/7P/z//r/AQAIABAAFwAdACQAKQAuADMANgA5ADsAOwA7ADoAOAA1ADIALQAoACIAHAAVAA4ABgAAAPj/8f/q/+P/3f/X/9L/zv/K/8f/xf/F/8X/xv/I/8r/zv/T/9j/3v/k/+v/8v/5/wAABwAPABYAHQAjACkALgAyADYAOQA6ADsAOwA6ADkANgAyAC4AKQAjABwAFgAOAAcAAAD5//L/6//k/93/2P/S/87/yv/I/8b/xf/F/8b/x//K/87/0v/X/93/4//q//H/+P8AAAYADgAVABwAIgAoAC0AMgA2ADgAOgA7ADsAOwA5ADYAMwAuACkAIwAdABYADwAIAAAA+v/z/+v/5P/e/9j/0//O/8v/yP/G/8X/xf/F/8f/yv/N/9H/1//c/+L/6f/w//j///8GAA0AFAAbACIAJwAtADEANQA4ADoAOwA7ADsAOQA2ADMALwAqACQAHgAXABAACQABAPv/8//s/+X/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zf/R/9b/3P/i/+j/7//3//7/BQAMABMAGgAhACcALAAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAlAB8AGAARAAoAAgD8//T/7f/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/8z/0P/V/9v/4f/o/+//9v/9/wQACwATABoAIAAmACwAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJQAfABkAEgAKAAMA/P/1/+7/5//g/9r/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1f/a/+D/5//u//X//f8DAAsAEgAZAB8AJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAAsACYAIAAaABMACwAEAP3/9v/v/+j/4f/b/9X/0P/M/8n/x//F/8X/xf/G/8j/zP/P/9T/2v/g/+b/7f/0//z/AgAKABEAGAAfACUAKgAvADQANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGgATAAwABQD+//f/7//o/+L/2//W/9H/zf/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//l/+z/8//7/wEACQAQABcAHgAkACoALwAzADcAOQA7ADsAOwA6ADgANQAxAC0AJwAiABsAFAANAAYA///4//D/6f/i/9z/1v/R/83/yv/H/8X/xf/F/8b/yP/L/87/0//Y/97/5f/r//P/+v8BAAgADwAWAB0AJAApAC4AMwA2ADkAOwA7ADsAOgA4ADUAMgAtACgAIgAcABUADgAGAAAA+P/x/+r/4//d/9f/0v/O/8r/x//F/8X/xf/G/8j/yv/O/9L/2P/d/+T/6//y//n/AAAHAA8AFgAcACMAKQAuADIANgA5ADoAOwA7ADoAOQA2ADIALgApACMAHQAWAA8ABwAAAPn/8v/r/+T/3v/Y/9P/zv/K/8j/xv/F/8X/xf/H/8r/zv/S/9f/3f/j/+r/8f/4/wAABgAOABUAHAAiACgALQAyADUAOAA6ADsAOwA7ADkANgAzAC4AKQAkAB0AFwAPAAgAAQD6//P/6//l/97/2P/T/8//y//I/8b/xf/F/8X/x//K/83/0f/W/9z/4v/p//D/9////wUADQAUABsAIQAnAC0AMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJAAeABcAEAAJAAEA+//0/+z/5f/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/b/+L/6P/v//f//v8FAAwAEwAaACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADQALwArACUAHwAYABEACgACAPz/9P/t/+b/4P/a/9T/z//M/8j/xv/F/8X/xf/H/8n/zP/Q/9X/2//h/+f/7v/2//3/BAALABIAGQAgACYALAAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsAAwD9//X/7v/n/+D/2v/V/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4P/n/+7/9f/8/wMACgASABkAHwAlACsAMAA0ADcAOQA7ADsAOwA6ADgANAAwACwAJgAgABoAEwALAAQA/v/2/+//6P/h/9v/1f/Q/8z/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5v/t//T//P8CAAoAEQAYAB8AJQAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABQADAAFAP7/9//w/+j/4v/c/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9P/2f/f/+X/7P/z//v/AQAJABAAFwAeACQAKgAvADMANgA5ADsAOwA7ADoAOAA1ADEALQAoACIAGwAUAA0ABgD///j/8P/p/+P/3P/X/9L/zf/K/8f/xf/F/8X/xv/I/8v/zv/T/9j/3v/k/+v/8v/6/wAACAAPABYAHQAjACkALgAzADYAOQA7ADsAOwA6ADgANgAyAC0AKAAiABwAFQAOAAcAAAD5//H/6v/j/93/1//S/87/yv/H/8b/xf/F/8b/x//K/87/0v/Y/93/5P/q//L/+f8AAAcADgAWABwAIwAoAC4AMgA2ADkAOgA7ADsAOgA5ADYAMgAuACkAIwAdABYADwAHAAAA+f/y/+v/5P/e/9j/0//O/8r/yP/G/8X/xf/F/8f/yv/N/9L/1//d/+P/6v/x//j/AAAGAA4AFQAcACIAKAAtADIANQA4ADoAOwA7ADsAOQA2ADMALgApACQAHQAXABAACAABAPr/8//s/+X/3v/Y/9P/z//L/8j/xv/F/8X/xf/H/8r/zf/R/9b/3P/i/+n/8P/3////BQANABQAGwAhACcALQAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAkAB4AGAAQAAkAAgD7//T/7P/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9v/4f/o/+//9v/+/wQADAATABoAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcANAAwACsAJQAfABgAEQAKAAIA/P/1/+3/5v/g/9r/1P/Q/8z/yP/G/8X/xf/F/8f/yf/M/9D/1f/b/+H/5//u//b//f8EAAsAEgAZACAAJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAArACYAIAAZABIACwADAP3/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9T/2v/g/+f/7v/1//z/AwAKABIAGQAfACUAKwAwADQANwA5ADsAOwA7ADoAOAA0ADEALAAmACAAGgATAAwABAD+//b/7//o/+H/2//V/9H/zP/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//m/+3/9P/7/wIACQARABgAHgAlACoALwAzADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABsAFAAMAAUA///3//D/6f/i/9z/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//0//Z/9//5f/s//P/+/8BAAkAEAAXAB4AJAAqAC8AMwA2ADkAOwA7ADsAOgA4ADUAMQAtACgAIgAbABUADQAGAP//+P/x/+n/4//c/9f/0v/N/8r/x//F/8X/xf/G/8j/y//O/9P/2P/e/+T/6//y//r/AAAIAA8AFgAdACMAKQAuADIANgA5ADsAOwA7ADoAOAA2ADIALQAoACIAHAAVAA4ABwAAAPn/8f/q/+P/3f/X/9L/zv/K/8f/xv/F/8X/xv/H/8r/zv/S/9f/3f/k/+r/8f/5/wAABwAOABUAHAAjACgALgAyADYAOAA6ADsAOwA7ADkANgAyAC4AKQAjAB0AFgAPAAgAAAD6//L/6//k/97/2P/T/87/y//I/8b/xf/F/8X/x//K/83/0v/X/9z/4//q//H/+P///wYADQAVABsAIgAoAC0AMgA1ADgAOgA7ADsAOwA5ADYAMwAvACoAJAAeABcAEAAIAAEA+v/z/+z/5f/e/9n/0//P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/c/+L/6f/w//f///8FAA0AFAAbACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADMALwAqACUAHgAYABEACQACAPv/9P/t/+b/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zP/R/9b/2//h/+j/7//2//7/BAAMABMAGgAgACYALAAxADQAOAA6ADsAOwA7ADkANwA0ADAAKwAlAB8AGAARAAoAAwD8//X/7f/m/+D/2v/U/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4f/n/+7/9f/9/wMACwASABkAIAAmACsAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJgAgABkAEgALAAQA/f/2/+7/5//h/9v/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1P/a/+D/5v/t//X//P8DAAoAEQAYAB8AJQArADAANAA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABMADAAEAP7/9v/v/+j/4f/b/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9T/2f/f/+b/7f/0//v/AgAJABEAGAAeACQAKgAvADMANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGwAUAA0ABQD///f/8P/p/+L/3P/W/9H/zf/K/8f/xf/F/8X/xv/I/8v/z//T/9n/3v/l/+z/8//6/wEACAAQABcAHgAkACkALwAzADYAOQA7ADsAOwA6ADgANQAyAC0AKAAiABwAFQANAAYAAAD4//H/6v/j/93/1//S/83/yv/H/8X/xf/F/8b/yP/K/87/0//Y/97/5P/r//L/+v8AAAgADwAWAB0AIwApAC4AMgA2ADkAOgA7ADsAOgA4ADYAMgAuACgAIwAcABUADgAHAAAA+f/y/+r/5P/d/9f/0v/O/8r/x//G/8X/xf/G/8f/yv/O/9L/1//d/+P/6v/x//n/AAAHAA4AFQAcACIAKAAtADIANgA4ADoAOwA7ADsAOQA2ADIALgApACMAHQAWAA8ACAAAAPr/8v/r/+T/3v/Y/9P/zv/L/8j/xv/F/8X/xf/H/8r/zf/S/9f/3P/j/+n/8P/4////BgANABQAGwAiACgALQAxADUAOAA6ADsAOwA7ADkANgAzAC8AKgAkAB4AFwAQAAkAAQD7//P/7P/l/9//2f/T/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9z/4v/p//D/9//+/wUADAAUABsAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJQAeABgAEQAJAAIA+//0/+3/5v/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/M/9H/1f/b/+H/6P/v//b//v8EAAwAEwAaACAAJgAsADAANAA4ADoAOwA7ADsAOQA3ADQAMAArACUAHwAZABIACgADAPz/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9X/2v/g/+f/7v/1//3/AwALABIAGQAgACYAKwAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsABAD9//b/7v/n/+H/2//V/9D/zP/J/8f/xf/F/8X/xv/I/8z/0P/U/9r/4P/m/+3/9P/8/wIACgARABgAHwAlACsALwA0ADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABoAEwAMAAUA/v/3/+//6P/i/9v/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5f/s//T/+/8CAAkAEAAXAB4AJAAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAtACcAIQAbABQADQAFAP//9//w/+n/4v/c/9b/0f/N/8r/x//F/8X/xf/G/8j/y//P/9P/2P/e/+X/7P/z//r/AQAIABAAFwAdACQAKQAuADMANgA5ADsAOwA7ADoAOAA1ADIALQAoACIAHAAVAA4ABgAAAPj/8f/q/+P/3f/X/9L/zv/K/8f/xf/F/8X/xv/I/8r/zv/T/9j/3v/k/+v/8v/5/wAABwAPABYAHQAjACkALgAyADYAOQA6ADsAOwA6ADkANgAyAC4AKQAjABwAFgAOAAcAAAD5//L/6//k/93/2P/S/87/yv/I/8b/xf/F/8b/x//K/87/0v/X/93/4//q//H/+P8AAAYADgAVABwAIgAoAC0AMgA2ADgAOgA7ADsAOwA5ADYAMwAuACkAIwAdABYADwAIAAAA+v/z/+v/5P/e/9j/0//O/8v/yP/G/8X/xf/F/8f/yv/N/9H/1//c/+L/6f/w//j///8GAA0AFAAbACIAJwAtADEANQA4ADoAOwA7ADsAOQA2ADMALwAqACQAHgAXABAACQABAPv/8//s/+X/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zf/R/9b/3P/i/+j/7//3//7/BQAMABMAGgAhACcALAAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAlAB8AGAARAAoAAgD8//T/7f/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/8z/0P/V/9v/4f/o/+//9v/9/wQACwATABoAIAAmACwAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJQAfABkAEgAKAAMA/P/1/+7/5//g/9r/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1f/a/+D/5//u//X//f8DAAsAEgAZAB8AJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAAsACYAIAAaABMACwAEAP3/9v/v/+j/4f/b/9X/0P/M/8n/x//F/8X/xf/G/8j/zP/P/9T/2v/g/+b/7f/0//z/AgAKABEAGAAfACUAKgAvADQANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGgATAAwABQD+//f/7//o/+L/2//W/9H/zf/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//l/+z/8//7/wEACQAQABcAHgAkACoALwAzADcAOQA7ADsAOwA6ADgANQAxAC0AJwAiABsAFAANAAYA///4//D/6f/i/9z/1v/R/83/yv/H/8X/xf/F/8b/yP/L/87/0//Y/97/5f/r//P/+v8BAAgADwAWAB0AJAApAC4AMwA2ADkAOwA7ADsAOgA4ADUAMgAtACgAIgAcABUADgAGAAAA+P/x/+r/4//d/9f/0v/O/8r/x//F/8X/xf/G/8j/yv/O/9L/2P/d/+T/6//y//n/AAAHAA8AFgAcACMAKQAuADIANgA5ADoAOwA7ADoAOQA2ADIALgApACMAHQAWAA8ABwAAAPn/8v/r/+T/3v/Y/9P/zv/K/8j/xv/F/8X/xf/H/8r/zv/S/9f/3f/j/+r/8f/4/wAABgAOABUAHAAiACgALQAyADUAOAA6ADsAOwA7ADkANgAzAC4AKQAkAB0AFwAPAAgAAQD6//P/6//l/97/2P/T/8//y//I/8b/xf/F/8X/x//K/83/0f/W/9z/4v/p//D/9////wUADQAUABsAIQAnAC0AMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJAAeABcAEAAJAAEA+//0/+z/5f/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/b/+L/6P/v//f//v8FAAwAEwAaACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADQALwArACUAHwAYABEACgACAPz/9P/t/+b/4P/a/9T/z//M/8j/xv/F/8X/xf/H/8n/zP/Q/9X/2//h/+f/7v/2//3/BAALABIAGQAgACYALAAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsAAwD9//X/7v/n/+D/2v/V/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4P/n/+7/9f/8/wMACgASABkAHwAlACsAMAA0ADcAOQA7ADsAOwA6ADgANAAwACwAJgAgABoAEwALAAQA/v/2/+//6P/h/9v/1f/Q/8z/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5v/t//T//P8CAAoAEQAYAB8AJQAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABQADAAFAP7/9//w/+j/4v/c/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9P/2f/f/+X/7P/z//v/AQAJABAAFwAeACQAKgAvADMANgA5ADsAOwA7ADoAOAA1ADEALQAoACIAGwAUAA0ABgD///j/8P/p/+P/3P/X/9L/zf/K/8f/xf/F/8X/xv/I/8v/zv/T/9j/3v/k/+v/8v/6/wAACAAPABYAHQAjACkALgAzADYAOQA7ADsAOwA6ADgANgAyAC0AKAAiABwAFQAOAAcAAAD5//H/6v/j/93/1//S/87/yv/H/8b/xf/F/8b/x//K/87/0v/Y/93/5P/q//L/+f8AAAcADgAWABwAIwAoAC4AMgA2ADkAOgA7ADsAOgA5ADYAMgAuACkAIwAdABYADwAHAAAA+f/y/+v/5P/e/9j/0//O/8r/yP/G/8X/xf/F/8f/yv/N/9L/1//d/+P/6v/x//j/AAAGAA4AFQAcACIAKAAtADIANQA4ADoAOwA7ADsAOQA2ADMALgApACQAHQAXABAACAABAPr/8//s/+X/3v/Y/9P/z//L/8j/xv/F/8X/xf/H/8r/zf/R/9b/3P/i/+n/8P/3////BQANABQAGwAhACcALQAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAkAB4AGAAQAAkAAgD7//T/7P/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9v/4f/o/+//9v/+/wQADAATABoAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcANAAwACsAJQAfABgAEQAKAAIA/P/1/+3/5v/g/9r/1P/Q/8z/yP/G/8X/xf/F/8f/yf/M/9D/1f/b/+H/5//u//b//f8EAAsAEgAZACAAJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAArACYAIAAZABIACwADAP3/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9T/2v/g/+f/7v/1//z/AwAKABIAGQAfACUAKwAwADQANwA5ADsAOwA7ADoAOAA0ADEALAAmACAAGgATAAwABAD+//b/7//o/+H/2//V/9H/zP/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//m/+3/9P/7/wIACQARABgAHgAlACoALwAzADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABsAFAAMAAUA///3//D/6f/i/9z/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//0//Z/9//5f/s//P/+/8BAAkAEAAXAB4AJAAqAC8AMwA2ADkAOwA7ADsAOgA4ADUAMQAtACgAIgAbABUADQAGAP//+P/x/+n/4//c/9f/0v/N/8r/x//F/8X/xf/G/8j/y//O/9P/2P/e/+T/6//y//r/AAAIAA8AFgAdACMAKQAuADIANgA5ADsAOwA7ADoAOAA2ADIALQAoACIAHAAVAA4ABwAAAPn/8f/q/+P/3f/X/9L/zv/K/8f/xv/F/8X/xv/H/8r/zv/S/9f/3f/k/+r/8f/5/wAABwAOABUAHAAjACgALgAyADYAOAA6ADsAOwA7ADkANgAyAC4AKQAjAB0AFgAPAAgAAAD6//L/6//k/97/2P/T/87/y//I/8b/xf/F/8X/x//K/83/0v/X/9z/4//q//H/+P///wYADQAVABsAIgAoAC0AMgA1ADgAOgA7ADsAOwA5ADYAMwAvACoAJAAeABcAEAAIAAEA+v/z/+z/5f/e/9n/0//P/8v/yP/G/8X/xf/F/8f/yf/N/9H/1v/c/+L/6f/w//f///8FAA0AFAAbACEAJwAsADEANQA4ADoAOwA7ADsAOQA3ADMALwAqACUAHgAYABEACQACAPv/9P/t/+b/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zP/R/9b/2//h/+j/7//2//7/BAAMABMAGgAgACYALAAxADQAOAA6ADsAOwA7ADkANwA0ADAAKwAlAB8AGAARAAoAAwD8//X/7f/m/+D/2v/U/9D/zP/J/8b/xf/F/8X/xv/J/8z/0P/V/9r/4f/n/+7/9f/9/wMACwASABkAIAAmACsAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJgAgABkAEgALAAQA/f/2/+7/5//h/9v/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1P/a/+D/5v/t//X//P8DAAoAEQAYAB8AJQArADAANAA3ADkAOwA7ADsAOgA4ADUAMQAsACcAIQAaABMADAAEAP7/9v/v/+j/4f/b/9b/0f/N/8n/x//F/8X/xf/G/8j/y//P/9T/2f/f/+b/7f/0//v/AgAJABEAGAAeACQAKgAvADMANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGwAUAA0ABQD///f/8P/p/+L/3P/W/9H/zf/K/8f/xf/F/8X/xv/I/8v/z//T/9n/3v/l/+z/8//6/wEACAAQABcAHgAkACkALwAzADYAOQA7ADsAOwA6ADgANQAyAC0AKAAiABwAFQANAAYAAAD4//H/6v/j/93/1//S/83/yv/H/8X/xf/F/8b/yP/K/87/0//Y/97/5P/r//L/+v8AAAgADwAWAB0AIwApAC4AMgA2ADkAOgA7ADsAOgA4ADYAMgAuACgAIwAcABUADgAHAAAA+f/y/+r/5P/d/9f/0v/O/8r/x//G/8X/xf/G/8f/yv/O/9L/1//d/+P/6v/x//n/AAAHAA4AFQAcACIAKAAtADIANgA4ADoAOwA7ADsAOQA2ADIALgApACMAHQAWAA8ACAAAAPr/8v/r/+T/3v/Y/9P/zv/L/8j/xv/F/8X/xf/H/8r/zf/S/9f/3P/j/+n/8P/4////BgANABQAGwAiACgALQAxADUAOAA6ADsAOwA7ADkANgAzAC8AKgAkAB4AFwAQAAkAAQD7//P/7P/l/9//2f/T/8//y//I/8b/xf/F/8X/x//J/83/0f/W/9z/4v/p//D/9//+/wUADAAUABsAIQAnACwAMQA1ADgAOgA7ADsAOwA5ADcAMwAvACoAJQAeABgAEQAJAAIA+//0/+3/5v/f/9n/1P/P/8v/yP/G/8X/xf/F/8f/yf/M/9H/1f/b/+H/6P/v//b//v8EAAwAEwAaACAAJgAsADAANAA4ADoAOwA7ADsAOQA3ADQAMAArACUAHwAZABIACgADAPz/9f/u/+f/4P/a/9X/0P/M/8n/xv/F/8X/xf/G/8n/zP/Q/9X/2v/g/+f/7v/1//3/AwALABIAGQAgACYAKwAwADQANwA6ADsAOwA7ADoANwA0ADAAKwAmACAAGQASAAsABAD9//b/7v/n/+H/2//V/9D/zP/J/8f/xf/F/8X/xv/I/8z/0P/U/9r/4P/m/+3/9P/8/wIACgARABgAHwAlACsALwA0ADcAOQA7ADsAOwA6ADgANQAxACwAJwAhABoAEwAMAAUA/v/3/+//6P/i/9v/1v/R/83/yf/H/8X/xf/F/8b/yP/L/8//1P/Z/9//5f/s//T/+/8CAAkAEAAXAB4AJAAqAC8AMwA3ADkAOwA7ADsAOgA4ADUAMQAtACcAIQAbABQADQAFAP//9//w/+n/4v/c/9b/0f/N/8r/x//F/8X/xf/G/8j/y//P/9P/2P/e/+X/7P/z//r/AQAIABAAFwAdACQAKQAuADMANgA5ADsAOwA7ADoAOAA1ADIALQAoACIAHAAVAA4ABgAAAPj/8f/q/+P/3f/X/9L/zv/K/8f/xf/F/8X/xv/I/8r/zv/T/9j/3v/k/+v/8v/5/wAABwAPABYAHQAjACkALgAyADYAOQA6ADsAOwA6ADkANgAyAC4AKQAjABwAFgAOAAcAAAD5//L/6//k/93/2P/S/87/yv/I/8b/xf/F/8b/x//K/87/0v/X/93/4//q//H/+P8AAAYADgAVABwAIgAoAC0AMgA2ADgAOgA7ADsAOwA5ADYAMwAuACkAIwAdABYADwAIAAAA+v/z/+v/5P/e/9j/0//O/8v/yP/G/8X/xf/F/8f/yv/N/9H/1//c/+L/6f/w//j///8GAA0AFAAbACIAJwAtADEANQA4ADoAOwA7ADsAOQA2ADMALwAqACQAHgAXABAACQABAPv/8//s/+X/3//Z/9T/z//L/8j/xv/F/8X/xf/H/8n/zf/R/9b/3P/i/+j/7//3//7/BQAMABMAGgAhACcALAAxADUAOAA6ADsAOwA7ADkANwAzAC8AKgAlAB8AGAARAAoAAgD8//T/7f/m/9//2f/U/8//y//I/8b/xf/F/8X/x//J/8z/0P/V/9v/4f/o/+//9v/9/wQACwATABoAIAAmACwAMAA0ADcAOgA7ADsAOwA6ADcANAAwACsAJQAfABkAEgAKAAMA/P/1/+7/5//g/9r/1f/Q/8z/yf/G/8X/xf/F/8b/yf/M/9D/1f/a/+D/5//u//X//f8DAAsAEgAZAB8AJgArADAANAA3ADoAOwA7ADsAOgA3ADQAMAAsACYAIAAaABMACwAEAP3/9v/v/+j/4f/b/9X/0P/M/8n/x//F/8X/xf/G/8j/zP/P/9T/2v/g/+b/7f/0//z/AgAKABEAGAAfACUAKgAvADQANwA5ADsAOwA7ADoAOAA1ADEALAAnACEAGgATAAwABQD+//f/7//o/+L/2//W/9H/zf/J/8f/xf/F/8X/xv/I/8v/z//U/9n/3//l/+z/8//7/wEACQAQABcAHgAkACoALwAzADcAOQA7ADsAOwA6ADgANQAxAC0AJwAiABsAFAANAAYA///4//D/6f/i/9z/1v/R/83/yv/H/8X/xf/F/8b/yP/L/87/0//Y/97/5f/r//P/+v8BAAgADwAWAB0AJAApAC4AMwA2ADkAOwA7ADsAOgA4ADUAMgAtACgAIgAcABUADgAGAAAA+P/x/+r/4//d/9f/0v/O/8r/x//F/8X/xf/G/8j/yv/O/9L/2P/d/+T/6//y//n/AAAHAA8AFgAcACMAKQAuADIANgA5ADoAOwA7ADoAOQA2ADIALgApACMAHQAWAA8ABwAAAPn/8v/r/+T/3v/Y/9P/zv/K/8j/xv/F/8X/xf/H/8r/zv/S/9f/3f/j/+r/8f/4/wAABgAOABUAHAAiACcALQAxADQANwA5ADoAOgA5ADcANAAxACwAJwAiABwAFQAPAAgAAQD7//T/7f/n/+H/2//X/9P/z//N/8v/yv/K/8v/zf/P/9L/1v/b/+D/5v/s//L/+f///wUACwARABcAHQAiACYAKgAtADAAMQAyADIAMQAwAC4AKwAnACMAHgAZABMADQAHAAEA/P/2//D/6//m/+H/3f/Z/9b/1P/S/9L/0v/S/9T/1v/Y/9z/4P/k/+n/7v/z//n///8DAAkADgATABgAHAAgACQAJgAoACoAKwArACoAKQAnACQAIQAeABoAFQARAAwABwABAP3/+P/z/+//6v/m/+P/4P/d/9v/2v/Z/9n/2v/b/9z/3//h/+X/6P/s//H/9f/6//7/AgAHAAsAEAATABcAGgAdAB8AIQAiACMAIwAjACIAIAAeABwAGQAWABIADgAKAAYAAgD+//r/9v/y/+//6//p/+b/5P/i/+H/4f/h/+H/4v/j/+X/5//q/+3/8P/z//f/+//+/wEABQAIAAwADwASABUAFwAZABoAGwAcABwAGwAbABkAGAAWABQAEQAOAAsACAAFAAEA///8//n/9v/z//H/7v/s/+v/6f/p/+j/6P/o/+n/6v/r/+3/7//x//T/9v/5//z///8AAAMABgAIAAsADQAPABEAEgATABQAFAAUABQAEwATABEAEAAOAAwACgAIAAYABAABAAAA/v/7//n/9//1//T/8v/x//H/8P/w//D/8P/w//H/8v/z//T/9v/4//n/+//9////AAACAAQABQAHAAgACQAKAAsADAAMAA0ADQAMAAwADAALAAoACQAIAAYABQAEAAIAAQAAAP///v/8//v/+v/5//n/+P/3//f/9//3//f/+P/4//n/+f/6//v//P/9//7///8AAAAAAQABAAIAAwAEAAQABQAFAAUABQAFAAUABQAFAAQABAAEAAMAAwACAAIAAQAAAAAAAAAAAAAA///////////+//7//v/+//7/////////////////AAAAAAAAAAAAAAAAAAA=";

// ---------- audio ----------
// Everything is synthesized with the Web Audio API (no external assets),
// so a single shared context is reused across the whole game.
let sharedAudioCtx = null;
let audioMuted = false;
function setAudioMuted(v) {
  audioMuted = v;
}

let vibrationEnabled = true;
function setVibrationEnabled(v) {
  vibrationEnabled = v;
}
function vibrate(pattern) {
  if (!vibrationEnabled) return;
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // not supported — fine, just skip it
    }
  }
}

function getAudioCtx() {
  if (typeof window === "undefined" || audioMuted) return null;
  if (!sharedAudioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function tone(ctx, { freq, endFreq, duration, type = "square", vol = 0.25, delay = 0 }) {
  if (!ctx) return;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function noiseBurst(ctx, { duration = 0.4, vol = 0.5, filterStart = 1500, filterEnd = 80 } = {}) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 1.5);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterStart, now);
  filter.frequency.exponentialRampToValueAtTime(filterEnd, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration);
}

// Banana Bullets get a real recorded sound effect instead of a
// synthesized tone — decoded once (via atob, not fetch, since fetching a
// data: URI can be blocked inside sandboxed iframes) and cached. Loops
// continuously for as long as the player is actively firing bananas,
// through the same shared AudioContext so it respects the mute setting.
const BANANA_SFX_BASE64 =
  "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UiB0Adn/8oZX7vq4jo7XVZAFgdAp1k0NkpDApsYBaaNR7c6t9efLUzN/vaZaiqLTVRQU63/klRCOqIozJ//7/8y8//NixKodysLddsMKtv+6TM2yJCvMmuc67uBgZ8REL3TRC04cSIkhbu734ZAwM/Jptqdf+mi9/5+na/MJ/f5vlGmXzsSzoGhMZLGp0Y4CIeDwBxUsK5PPxzHcqIgEB5LeTSlLLHOmiyt2DBQ2vvlKXfgWUEJALhM0FdZE9BgaOjNUqjqJKibM1GnwqNdTKfKytc8cXesP37Vpc19Qsf/zYsTCJiwG6ZYw2VulXq8vCXHpa3odLJCuinC23B4jEw6kQLw1KCvD6pgnFjQWRuJwoTGSqBkKpCuZKsqypqNTqF61ODrep5zgWVTWIkJ/H6/Q9mWkiTJUOR+LcZWQn79RyneuDQUp0GWlELYGZRrSpdPSeLaAQeUNfH65niUotqhPXI9LmcBzmYXmxb0cfScUCsbU+7XTuEsKBlX/82DEuTO0FtVmQl/IEuYLo7GlZlR6YRzAr4isVzg8Sja1atXFbI3EiQSDplFgAJ00cLfWorWaon5AHQwltFHDsJJHbvZE5PNB8cmpinAI+sNz4hkf1R1KxqS/DXX+Szz7UZfRqKzSnRDhw4UozzFL00CkJBqz2KY+5VqY28vv/0VHNR1ULFQKQArQ2sVcFACs6733lUz1hQZjwoL/82LEeR8iwuZcYYS806osisAUkgMxW0bBYRiWhZuR2Q4vX85VbWXa0kJfJ39lbiL9EiEuWaRQW+McV3n9t8o5+z84iy/nyi975n//+du+XSVHPFaChXnt6O1vOfe1eqevMHAqAjwKqc+8RFS2VOuO6hyzoiKnZgFZB4iHBUiLcvItWWxQ9ESoTAXRN7gMKVhmDP82h0z0Fd0q/zYB//NixIweeh7Fi0wwANOaXZ/5jlJhL2lNSm//eMWQOebGGpv/9k5iOmcC0/Glhnf//mcqDEEoDBEEYNx2pqe3///qDSBEMwzktxlZqlXUzvm6b////0mywUhqYpQ5Owczi12tyu3K1qrVuV8v/////y1y/k/0IVTTM/DymzdXAg5CduU44b+rGceVtZf///////+jW05fAkEmMFQEf//zYsSiOZOGaAGayAFE5fMJaU+oXQR9R6LVTOOrtXm967+pVW7r//////////6B90HVVUzUVpczFxFyvYgKpJG12SX6eGmJM919b9VceNDShVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/82DESwAAA0gBwAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";
let bananaAudioBuffer = null;
let bananaAudioLoadPromise = null;

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function loadBananaBuffer(ctx) {
  if (bananaAudioBuffer) return Promise.resolve(bananaAudioBuffer);
  if (bananaAudioLoadPromise) return bananaAudioLoadPromise;
  bananaAudioLoadPromise = new Promise((resolve) => {
    try {
      const arrayBuffer = base64ToArrayBuffer(BANANA_SFX_BASE64);
      ctx.decodeAudioData(
        arrayBuffer,
        (decoded) => {
          bananaAudioBuffer = decoded;
          resolve(decoded);
        },
        (err) => {
          console.error("Could not decode banana sfx", err);
          bananaAudioLoadPromise = null;
          resolve(null);
        }
      );
    } catch (e) {
      console.error("Could not decode banana sfx", e);
      bananaAudioLoadPromise = null;
      resolve(null);
    }
  });
  return bananaAudioLoadPromise;
}

// One persistent looping source — started while banana bullets are
// actively firing, stopped the instant they're not (disarmed, paused,
// switched weapons, run over). Restarts seamlessly if it ever needs to.
let bananaLoopSource = null;
let bananaLoopGain = null;

function stopBananaLoop() {
  if (bananaLoopSource) {
    try {
      bananaLoopSource.stop();
    } catch {
      // already stopped — fine
    }
    try {
      bananaLoopSource.disconnect();
    } catch {
      // already disconnected — fine
    }
    bananaLoopSource = null;
  }
  if (bananaLoopGain) {
    try {
      bananaLoopGain.disconnect();
    } catch {
      // already disconnected — fine
    }
    bananaLoopGain = null;
  }
}

function setBananaLoopActive(active) {
  const ctx = getAudioCtx();
  if (!ctx || !active) {
    stopBananaLoop();
    return;
  }
  if (bananaLoopSource) return; // already looping — nothing to do
  loadBananaBuffer(ctx).then((buffer) => {
    if (!buffer) return;
    // re-check: audio may have been muted/stopped while the buffer loaded
    const liveCtx = getAudioCtx();
    if (!liveCtx || bananaLoopSource) return;
    const src = liveCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = liveCtx.createGain();
    gain.gain.value = 0.5;
    src.connect(gain).connect(liveCtx.destination);
    src.start();
    bananaLoopSource = src;
    bananaLoopGain = gain;
  });
}

const sfx = {
  hit() {
    const ctx = getAudioCtx();
    tone(ctx, { freq: 260, endFreq: 70, duration: 0.18, type: "square", vol: 0.28 });
  },
  shieldBreak() {
    const ctx = getAudioCtx();
    tone(ctx, { freq: 700, endFreq: 900, duration: 0.15, type: "sine", vol: 0.22 });
    tone(ctx, { freq: 500, endFreq: 200, duration: 0.22, type: "triangle", vol: 0.18, delay: 0.03 });
  },
  alarm() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.04);
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.linearRampToValueAtTime(980, now + 0.14);
    osc.frequency.linearRampToValueAtTime(680, now + 0.28);
    osc.frequency.linearRampToValueAtTime(980, now + 0.42);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.52);
  },
  explosion(big = false) {
    const ctx = getAudioCtx();
    noiseBurst(ctx, {
      duration: big ? 0.9 : 0.45,
      vol: big ? 0.6 : 0.42,
      filterStart: big ? 2200 : 1400,
      filterEnd: 70,
    });
    tone(ctx, { freq: big ? 140 : 100, endFreq: 25, duration: big ? 0.7 : 0.38, type: "sine", vol: big ? 0.5 : 0.32 });
  },
  bossMove(type) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (type === "spread") {
      tone(ctx, { freq: 520, endFreq: 180, duration: 0.2, type: "square", vol: 0.22 });
    } else if (type === "aimed") {
      tone(ctx, { freq: 950, endFreq: 420, duration: 0.13, type: "sawtooth", vol: 0.2 });
    } else if (type === "laser") {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.linearRampToValueAtTime(920, now + 0.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.35);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.46);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.47);
    } else if (type === "burst") {
      tone(ctx, { freq: 220, endFreq: 1100, duration: 0.32, type: "sawtooth", vol: 0.26 });
    } else if (type === "homing") {
      tone(ctx, { freq: 340, endFreq: 560, duration: 0.28, type: "sine", vol: 0.22 });
      tone(ctx, { freq: 460, endFreq: 680, duration: 0.28, type: "sine", vol: 0.16, delay: 0.08 });
    }
  },
  megaReveal() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    [220, 277.18, 329.63, 440].forEach((f, i) => {
      tone(ctx, { freq: f, duration: 0.55, type: "sawtooth", vol: 0.13, delay: i * 0.04 });
    });
    tone(ctx, { freq: 80, endFreq: 38, duration: 0.65, type: "sine", vol: 0.4 });
  },
};

// Renders one laser bolt oriented along its direction of travel: a soft
// outer glow pass underneath a bright, white-hot core gradient on top —
// reads as an actual energy beam rather than a flat colored rectangle.
function drawLaserBolt(ctx, x, y, vx, vy, len, width, core, glow) {
  const angle = Math.atan2(vy, vx || 0.0001);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineCap = "round";

  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = glow;
  ctx.lineWidth = width * 2.6;
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.stroke();

  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.45, core);
  grad.addColorStop(1, "rgba(255,255,255,0.95)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.stroke();

  ctx.restore();
}

async function loadTrophies() {
  try {
    const res = await window.storage.get(TROPHY_KEY);
    const n = res ? JSON.parse(res.value) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Retries a few times and confirms the write actually landed — mobile
// browsers can kill an in-flight save the instant a tab backgrounds, so a
// single fire-and-forget attempt isn't reliable enough for something as
// important as trophy count.
async function saveTrophies(n, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await window.storage.set(TROPHY_KEY, JSON.stringify(n));
      if (result) return true;
    } catch (e) {
      if (i === attempts - 1) console.error("Could not save trophies", e);
    }
  }
  return false;
}

async function loadCompletedGame() {
  try {
    const res = await window.storage.get(COMPLETED_KEY);
    return res ? JSON.parse(res.value) === true : false;
  } catch {
    return false;
  }
}
async function saveCompletedGame(v) {
  try {
    await window.storage.set(COMPLETED_KEY, JSON.stringify(v));
  } catch (e) {
    console.error("Could not save completion flag", e);
  }
}

const SETTINGS_KEY = "void-runner-settings";
const DEFAULT_SETTINGS = { muted: false, vibration: true, difficulty: "normal", reduceEffects: false };
const DIFFICULTIES = {
  easy: { degradeMult: 1.5, spawnMult: 1.25, bossHpMult: 0.75, label: "Easy" },
  normal: { degradeMult: 1, spawnMult: 1, bossHpMult: 1, label: "Normal" },
  hard: { degradeMult: 0.65, spawnMult: 0.75, bossHpMult: 1.3, label: "Hard" },
};

async function loadSettings() {
  try {
    const res = await window.storage.get(SETTINGS_KEY);
    const v = res ? JSON.parse(res.value) : null;
    if (v && typeof v === "object") return { ...DEFAULT_SETTINGS, ...v };
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_SETTINGS };
}
async function saveSettings(v) {
  try {
    await window.storage.set(SETTINGS_KEY, JSON.stringify(v));
  } catch (e) {
    console.error("Could not save settings", e);
  }
}

const BEST_SCORE_KEY = "void-runner-best-score";
async function loadBestScore() {
  try {
    const res = await window.storage.get(BEST_SCORE_KEY);
    const n = res ? JSON.parse(res.value) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
async function saveBestScore(n) {
  try {
    await window.storage.set(BEST_SCORE_KEY, JSON.stringify(n));
  } catch (e) {
    console.error("Could not save best score", e);
  }
}

// ---------- lifetime stats & achievements ----------
const STATS_KEY = "void-runner-stats";
const DEFAULT_STATS = {
  totalAsteroidsDestroyed: 0,
  totalBossesBeaten: 0,
  totalDeaths: 0,
  bestWave: 0,
  flawlessBossWins: 0,
  mothershipDefeated: false,
  mothershipDefeatedHard: false,
  thrusterFailureSurvived: 0,
  itemsPurchased: 0,
  lifetimeTrophies: 0,
  foundOrangeCombo: false,
  foundBlackHole: false,
  unlocked: [], // achievement ids
};

async function loadStats() {
  try {
    const res = await window.storage.get(STATS_KEY);
    const v = res ? JSON.parse(res.value) : null;
    if (v && typeof v === "object") return { ...DEFAULT_STATS, ...v, unlocked: Array.isArray(v.unlocked) ? v.unlocked : [] };
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_STATS };
}
async function saveStats(v) {
  try {
    await window.storage.set(STATS_KEY, JSON.stringify(v));
  } catch (e) {
    console.error("Could not save stats", e);
  }
}

const ACHIEVEMENTS = [
  { id: "first_blood", label: "First Blood", desc: "Destroy your first asteroid", check: (s) => s.totalAsteroidsDestroyed >= 1 },
  { id: "asteroid_500", label: "Rock Crusher", desc: "Destroy 500 asteroids (lifetime)", check: (s) => s.totalAsteroidsDestroyed >= 500 },
  { id: "asteroid_2000", label: "Belt Clearer", desc: "Destroy 2,000 asteroids (lifetime)", check: (s) => s.totalAsteroidsDestroyed >= 2000 },
  { id: "first_boss", label: "Boss Slayer", desc: "Defeat your first boss", check: (s) => s.totalBossesBeaten >= 1 },
  { id: "boss_25", label: "Veteran Commander", desc: "Defeat 25 bosses (lifetime)", check: (s) => s.totalBossesBeaten >= 25 },
  { id: "flawless_boss", label: "Untouchable", desc: "Beat a boss without taking damage", check: (s) => s.flawlessBossWins >= 1 },
  { id: "wave_10", label: "Getting Started", desc: "Reach wave 10", check: (s) => s.bestWave >= 10 },
  { id: "wave_25", label: "Mega Threat", desc: "Reach wave 25", check: (s) => s.bestWave >= 25 },
  { id: "mothership", label: "Void Conqueror", desc: "Defeat the Mothership", check: (s) => s.mothershipDefeated },
  {
    id: "mothership_hard",
    label: "Nightmare Conqueror",
    desc: "Defeat the Mothership on Hard difficulty",
    check: (s) => s.mothershipDefeatedHard,
  },
  { id: "thruster_survivor", label: "Sluggish Survivor", desc: "Survive a Thruster Failure without dying", check: (s) => s.thrusterFailureSurvived >= 1 },
  { id: "shop_spender", label: "Big Spender", desc: "Purchase 10 shop items (lifetime)", check: (s) => s.itemsPurchased >= 10 },
  { id: "trophy_collector", label: "Trophy Collector", desc: "Earn 50 trophies (lifetime)", check: (s) => s.lifetimeTrophies >= 50 },
  {
    id: "easter_egg_collector",
    label: "Easter Egg Collector",
    desc: "Find two of the game's best-kept secrets — unlocks a hidden hull",
    check: (s) => s.foundOrangeCombo && s.foundBlackHole,
  },
];

// Merges a run's outcome into lifetime stats, saves it, and returns any
// achievements that newly unlocked as a result (for a toast).
function applyStatsUpdate(prevStats, patch) {
  const next = { ...prevStats, ...patch };
  const newlyUnlocked = [];
  ACHIEVEMENTS.forEach((a) => {
    if (!next.unlocked.includes(a.id) && a.check(next)) {
      newlyUnlocked.push(a);
    }
  });
  if (newlyUnlocked.length) {
    next.unlocked = [...next.unlocked, ...newlyUnlocked.map((a) => a.id)];
  }
  return { next, newlyUnlocked };
}

const CHECKPOINT_KEY = "void-runner-checkpoint";

async function loadCheckpoint() {
  try {
    const res = await window.storage.get(CHECKPOINT_KEY);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null;
  }
}

async function saveCheckpoint(cp) {
  try {
    await window.storage.set(CHECKPOINT_KEY, JSON.stringify(cp));
  } catch (e) {
    console.error("Could not save checkpoint", e);
  }
}

async function clearCheckpoint() {
  try {
    await window.storage.delete(CHECKPOINT_KEY);
  } catch {
    // nothing was saved — fine
  }
}

// Snapshot of everything needed to pick a run back up: score/wave/lives,
// which world it's in, boss progression, and the player's stacked
// power-ups. Deliberately excludes live entities (bullets, rocks, the
// boss itself) — resuming lands back at the top of the current wave.
function buildCheckpoint(s) {
  return {
    score: s.score,
    wave: s.wave,
    lives: s.lives ?? 3,
    world: s.world || "homeworld",
    bossIndex: s.bossIndex || 0,
    difficulty: s.difficulty || "normal",
    player: {
      spread: s.player.spread,
      cooldown: s.player.cooldown,
      bulletSpeedMult: s.player.bulletSpeedMult,
      pierce: s.player.pierce,
      speedMult: s.player.speedMult,
      shieldCharges: s.player.shieldCharges || 0,
      drones: s.player.drones || 0,
      extraLifeGranted: s.player.extraLifeGranted || false,
      powerCounts: s.player.powerCounts || {},
      shape: s.player.shape,
      color: s.player.color,
      trail: s.player.trail || "none",
      bullet: s.player.bullet || "standard",
    },
    savedAt: Date.now(),
  };
}

// Quantum Fighter easter egg — the transformed ship's boss-style attacks,
// triggered by the on-screen move buttons. Cooldowns keep these as
// occasional "special moves" rather than a replacement for auto-fire.
const BOSS_MOVE_COOLDOWNS = { spread: 240, aimed: 180, laser: 300, burst: 420 };

function firePlayerBossMove(s, move) {
  const p = s.player;
  if (!p.moveCooldowns) p.moveCooldowns = { spread: 0, aimed: 0, laser: 0, burst: 0 };
  if (p.moveCooldowns[move] > 0) return false;
  p.moveCooldowns[move] = BOSS_MOVE_COOLDOWNS[move];
  const color = p.color && p.color !== "rainbow" ? p.color : "#ffd700";
  sfx.bossMove(move === "laser" ? "laser" : move === "burst" ? "burst" : move);

  if (move === "spread") {
    const count = 9;
    for (let i = 0; i < count; i++) {
      const ang = -0.95 + (i / (count - 1)) * 1.9; // fan, radians off straight up
      s.bullets.push({
        x: p.x,
        y: p.y - 16,
        vx: Math.sin(ang) * 4.2,
        vy: -Math.cos(ang) * 4.6,
        r: 5,
        special: "spread",
        color,
      });
    }
  } else if (move === "aimed") {
    let tx = p.x,
      ty = 0;
    if (s.bossActive && s.boss) {
      tx = s.boss.x;
      ty = s.boss.y;
    } else if (s.rocks.length) {
      let best = null,
        bd = Infinity;
      s.rocks.forEach((r) => {
        const d = Math.hypot(r.x - p.x, r.y - p.y);
        if (d < bd) {
          bd = d;
          best = r;
        }
      });
      if (best) {
        tx = best.x;
        ty = best.y;
      }
    }
    const baseAng = Math.atan2(tx - p.x, p.y - ty);
    [-0.16, 0, 0.16].forEach((off) => {
      const ang = baseAng + off;
      s.bullets.push({
        x: p.x,
        y: p.y - 16,
        vx: Math.sin(ang) * 6.2,
        vy: -Math.cos(ang) * 6.2,
        r: 5,
        special: "aimed",
        color,
      });
    });
  } else if (move === "laser") {
    [-6, 0, 6].forEach((ox) => {
      s.bullets.push({
        x: p.x + ox,
        y: p.y - 16,
        speed: BULLET_SPEED * 1.8,
        pierce: true,
        special: "laser",
        color,
      });
    });
  } else if (move === "burst") {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      s.bullets.push({
        x: p.x,
        y: p.y,
        vx: Math.sin(ang) * 3.6,
        vy: Math.cos(ang) * 3.6,
        r: 5,
        special: "burst",
        color,
      });
    }
  }
  return true;
}

function damagePlayer(s, cause) {
  if (s.player.hit > 0) return;
  if (s.runStats) {
    if (s.bossActive) s.runStats.tookDamageThisBoss = true;
  }
  if (s.player.shieldCharges > 0) {
    s.player.shieldCharges -= 1;
    s.player.hit = 30;
    s.shakeT = 8;
    sfx.shieldBreak();
    vibrate(40);
    for (let i = 0; i < 16; i++) {
      s.particles.push({
        x: s.player.x,
        y: s.player.y,
        vx: rand(-3, 3),
        vy: rand(-3, 3),
        life: 22,
        c: COLORS.cyan,
      });
    }
    return;
  }
  s.lives = (s.lives ?? 3) - 1;
  s.player.hit = 60;
  s.shakeT = 16;
  s.lastDamageCause = cause || "Unknown Cause";
  if (s.runStats) {
    const key = cause || "Unknown Cause";
    s.runStats.damageBySource[key] = (s.runStats.damageBySource[key] || 0) + 1;
  }
  sfx.hit();
  vibrate([60, 30, 60]);
  for (let i = 0; i < 14; i++) {
    s.particles.push({
      x: s.player.x,
      y: s.player.y,
      vx: rand(-4, 4),
      vy: rand(-4, 4),
      life: 24,
      c: COLORS.red,
    });
  }
}

function rollDegrade(s) {
  const total = DEGRADES.reduce((sum, d) => sum + d.weight, 0);
  let r = Math.random() * total;
  for (const d of DEGRADES) {
    if (r < d.weight) {
      d.apply(s);
      s.alert = { text: `SYSTEM FAULT: ${d.label}`, t: 90, warn: d.id === "loselife" };
      sfx.alarm();
      vibrate(25);
      return;
    }
    r -= d.weight;
  }
}

// Build one irregular, cratered rock silhouette. Generated once per rock at
// spawn time and reused every frame so the shape stays stable while it spins.
function makeRockGeometry(size) {
  const vertexCount = 10 + Math.floor(rand(0, 4));
  const outline = [];
  for (let i = 0; i < vertexCount; i++) {
    const ang = (i / vertexCount) * Math.PI * 2;
    const jitterAng = ang + rand(-0.12, 0.12);
    const r = size * rand(0.68, 1.14);
    outline.push({ ang: jitterAng, r });
  }
  const craterCount = Math.floor(rand(1, 4));
  const craters = [];
  for (let i = 0; i < craterCount; i++) {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(0, size * 0.45);
    craters.push({
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      r: rand(size * 0.14, size * 0.3),
    });
  }
  return { outline, craters };
}

// Build one angular crystal shard — fewer, sharper vertices than a rock,
// with internal facet lines instead of craters. Used for the Frontier
// world so its "asteroids" read as an entirely different hazard.
function makeCrystalGeometry(size) {
  const vertexCount = 6 + Math.floor(rand(0, 3));
  const outline = [];
  for (let i = 0; i < vertexCount; i++) {
    const ang = (i / vertexCount) * Math.PI * 2;
    const jitterAng = ang + rand(-0.06, 0.06);
    const r = size * (i % 2 === 0 ? rand(0.95, 1.15) : rand(0.55, 0.75));
    outline.push({ ang: jitterAng, r });
  }
  const facetCount = Math.floor(rand(2, 4));
  const facets = [];
  for (let i = 0; i < facetCount; i++) {
    const ang = rand(0, Math.PI * 2);
    facets.push({
      x1: 0,
      y1: 0,
      x2: Math.cos(ang) * size * rand(0.6, 1),
      y2: Math.sin(ang) * size * rand(0.6, 1),
    });
  }
  return { outline, facets };
}

// Build one comet core — a lumpy, irregular silhouette like a rock, plus
// a few bright "hotspot" points used for glowing fissures when rendered
// with the Outworld's fire palette and trailing tail.
function makeCometGeometry(size) {
  const vertexCount = 9 + Math.floor(rand(0, 4));
  const outline = [];
  for (let i = 0; i < vertexCount; i++) {
    const ang = (i / vertexCount) * Math.PI * 2;
    const jitterAng = ang + rand(-0.1, 0.1);
    const r = size * rand(0.7, 1.1);
    outline.push({ ang: jitterAng, r });
  }
  const hotspotCount = Math.floor(rand(2, 5));
  const hotspots = [];
  for (let i = 0; i < hotspotCount; i++) {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(0, size * 0.5);
    hotspots.push({
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      r: rand(size * 0.1, size * 0.22),
    });
  }
  return { outline, hotspots };
}

// Build one star-shaped "asteroid" for the Wormhole — a classic 5-8
// pointed star outline, no craters or facets. Rendered glowing, in a
// randomly assigned color per spawn.
function makeStarGeometry(size) {
  const points = 5 + Math.floor(rand(0, 3));
  const outline = [];
  for (let i = 0; i < points * 2; i++) {
    const ang = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? size * rand(0.95, 1.15) : size * rand(0.35, 0.5);
    outline.push({ ang, r });
  }
  return { outline };
}
const WORMHOLE_STAR_COLORS = ["#5ee6d0", "#ff5d5d", "#ffb454", "#c65bff", "#7dffb0", "#4fd6ff", "#ffe066", "#ff8fd6"];

function makeStars() {
  const layers = [
    { count: 45, speedRange: [0.2, 0.5], sizeRange: [0.5, 1.1], alpha: 0.35 },
    { count: 35, speedRange: [0.6, 1.0], sizeRange: [0.9, 1.6], alpha: 0.55 },
    { count: 22, speedRange: [1.2, 1.8], sizeRange: [1.3, 2.4], alpha: 0.85 },
  ];
  const stars = [];
  layers.forEach((layer) => {
    for (let i = 0; i < layer.count; i++) {
      stars.push({
        x: rand(0, WIDTH),
        y: rand(0, HEIGHT),
        r: rand(layer.sizeRange[0], layer.sizeRange[1]),
        speed: rand(layer.speedRange[0], layer.speedRange[1]),
        baseAlpha: layer.alpha,
        phase: rand(0, Math.PI * 2),
      });
    }
  });
  return stars;
}

function makeNebulae() {
  const palettes = [
    { c1: "rgba(120,70,200,0.10)", c2: "rgba(120,70,200,0)" },
    { c1: "rgba(40,140,150,0.09)", c2: "rgba(40,140,150,0)" },
    { c1: "rgba(200,110,60,0.07)", c2: "rgba(200,110,60,0)" },
  ];
  return palettes.map((p, i) => ({
    x: rand(WIDTH * 0.15, WIDTH * 0.85),
    y: rand(HEIGHT * 0.1, HEIGHT * 0.9),
    r: rand(160, 260),
    drift: rand(0.03, 0.08) * (i % 2 === 0 ? 1 : -1),
    c1: p.c1,
    c2: p.c2,
  }));
}

const FRONTIER_NEBULA_COLORS = [
  { c1: "rgba(80,180,255,0.13)", c2: "rgba(80,180,255,0)" },
  { c1: "rgba(180,90,255,0.11)", c2: "rgba(180,90,255,0)" },
  { c1: "rgba(120,255,220,0.08)", c2: "rgba(120,255,220,0)" },
];

const OUTWORLD_NEBULA_COLORS = [
  { c1: "rgba(160,32,240,0.14)", c2: "rgba(160,32,240,0)" },
  { c1: "rgba(220,90,255,0.11)", c2: "rgba(220,90,255,0)" },
  { c1: "rgba(90,20,140,0.12)", c2: "rgba(90,20,140,0)" },
];

const WORMHOLE_NEBULA_COLORS = [
  { c1: "rgba(20,140,80,0.16)", c2: "rgba(20,140,80,0)" },
  { c1: "rgba(50,220,120,0.10)", c2: "rgba(50,220,120,0)" },
  { c1: "rgba(10,80,50,0.16)", c2: "rgba(10,80,50,0)" },
];

// The Outworld's background black hole — a real hazard, not just scenery.
// Flying into it triggers the dedicated black-hole sequence.
const BLACKHOLE_X = WIDTH * 0.76;
const BLACKHOLE_Y = HEIGHT * 0.24;
const BLACKHOLE_PULL_RADIUS = 66;

const BOSS_MOVES = ["spread", "aimed", "laser"];
const MEGA_MOVES = ["spread", "aimed", "laser", "burst"];
const MEGA_ENTRANCE_FRAMES = 220; // ~3.6s at 60fps — slow, dramatic reveal
const NORMAL_ENTRANCE_FRAMES = 60;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

const BOSS_NAMES = {
  homeworld: ["Sentinel-Class Interceptor", "Void Reaver", "Iron Vanguard", "Crimson Warden"],
  frontier: ["Frost Sentinel", "Glacier Warden", "Ice Reaver", "Cryo Vanguard"],
  outworld: ["Ember Reaver", "Solar Warden", "Comet Vanguard", "Inferno Sentinel"],
  wormhole: ["Star Warden", "Void Sentinel", "Nova Reaver", "Prism Vanguard"],
};
const MEGA_BOSS_NAMES = {
  homeworld: "The Devastator",
  frontier: "The Glacial Colossus",
  outworld: "The Inferno Titan",
  wormhole: "The Void Empress",
};

function spawnBoss(s, bossIndex, tier, world) {
  if (s.runStats) s.runStats.tookDamageThisBoss = false;
  const worldCfg = WORLDS[world] || WORLDS.homeworld;
  const isMothership = tier === "mega" && world === "wormhole";
  const baseHp = tier === "mega" ? MEGA_BASE_HP : Math.round(BOSS_BASE_HP * Math.pow(BOSS_HP_MULT, bossIndex));
  const hpMult = isMothership ? worldCfg.motherShipHpMult || worldCfg.bossHpMult : worldCfg.bossHpMult;
  const diffMult = (DIFFICULTIES[s.difficulty] || DIFFICULTIES.normal).bossHpMult;
  const hp = Math.round(baseHp * hpMult * diffMult);
  const entranceFrames = tier === "mega" ? MEGA_ENTRANCE_FRAMES : NORMAL_ENTRANCE_FRAMES;
  let moves = tier === "mega" ? MEGA_MOVES : BOSS_MOVES;
  if (worldCfg.extraBossMove) {
    moves = tier === "mega" ? [...MEGA_MOVES, "homing"] : [...BOSS_MOVES, "burst"];
  }
  if (isMothership) {
    moves = [...moves, "bombardment"];
  }
  const namePool = BOSS_NAMES[world] || BOSS_NAMES.homeworld;
  const bossName =
    tier === "mega" ? MEGA_BOSS_NAMES[world] || "Unknown Threat" : namePool[Math.floor(rand(0, namePool.length))];
  s.boss = {
    tier,
    world,
    name: bossName,
    x: WIDTH / 2,
    startY: tier === "mega" ? -170 : -80,
    y: tier === "mega" ? -170 : -80,
    targetY: tier === "mega" ? 130 : 108,
    hp,
    maxHp: hp,
    state: "entrance",
    stateTimer: entranceFrames,
    entranceFrames,
    revealAlpha: 0,
    moves,
    moveType: null,
    moveCursor: -1,
    speedFactor: (tier === "mega" ? 0.62 : 1) * worldCfg.bossSpeedMult,
    laserX: WIDTH / 2,
    fired: false,
    flash: 0,
  };
  s.bossBullets = [];
  s.rocks = [];
  if (isMothership) {
    s.alert = { text: `⚠⚠ MOTHERSHIP DETECTED: ${bossName} ⚠⚠`, t: entranceFrames + 30, warn: true };
    sfx.alarm();
  } else if (tier === "mega") {
    s.alert = { text: `⚠ MEGA THREAT DETECTED: ${bossName} ⚠`, t: entranceFrames + 30, warn: true };
    sfx.alarm();
  } else {
    s.alert = { text: `WARNING — ${bossName.toUpperCase()} DETECTED`, t: 130, warn: true };
  }
}

export default function AloneAmongTheStars() {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("cutscene"); // cutscene | tutorial | start | travel | playing | gameover | won | blackhole
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [wave, setWave] = useState(1);
  const [statusFlags, setStatusFlags] = useState({ frozen: false, disarmed: false, slowed: false });
  const [bossMoveUI, setBossMoveUI] = useState({ transformed: false, cooldowns: null });
  const [bossHud, setBossHud] = useState(null); // { hp, maxHp, tier }
  const [trophies, setTrophies] = useState(0);
  const [deathCause, setDeathCause] = useState(null);
  const [paused, setPaused] = useState(false);
  const [blackholeFailed, setBlackholeFailed] = useState(false);
  const [finalVictory, setFinalVictory] = useState(false);
  const [completedGame, setCompletedGame] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const audioUnlockRef = useRef(null);
  const [shipConfig, setShipConfig] = useState(DEFAULT_SHIP_CONFIG);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showPowerups, setShowPowerups] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [secretMessage, setSecretMessage] = useState(null);
  const [cutsceneCaption, setCutsceneCaption] = useState("Homeworld — Launch Day");
  const [tutorialPage, setTutorialPage] = useState(0);
  const [selectedWorld, setSelectedWorld] = useState("homeworld");
  const [savedCheckpoint, setSavedCheckpoint] = useState(null);
  const [ownedItems, setOwnedItems] = useState(DEFAULT_OWNED);
  const [showShop, setShowShop] = useState(false);
  const [shopTab, setShopTab] = useState("shapes");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showOptions, setShowOptions] = useState(false);
  const [showBossRush, setShowBossRush] = useState(false);
  const [bossRushSelection, setBossRushSelection] = useState(null); // { world, tier } while a rush run is active
  const [bossRushResult, setBossRushResult] = useState(null); // "win" | null, shown briefly on return
  const [lifetimeStats, setLifetimeStats] = useState(DEFAULT_STATS);
  const [showAchievements, setShowAchievements] = useState(false);
  const [achievementToast, setAchievementToast] = useState(null); // achievement object briefly shown
  const [runSummary, setRunSummary] = useState(null); // stats snapshot from the run that just ended
  const [loadoutPresets, setLoadoutPresets] = useState(DEFAULT_LOADOUT_PRESETS);

  const stateRef = useRef(null);
  const trophiesRef = useRef(0);
  const trophiesDirtyRef = useRef(false);
  const shipConfigRef = useRef(DEFAULT_SHIP_CONFIG);
  const shipConfigDirtyRef = useRef(false);
  const ownedItemsRef = useRef(DEFAULT_OWNED);
  const statsRef = useRef(DEFAULT_STATS);
  const ownedItemsDirtyRef = useRef(false);
  const pausedRef = useRef(false);
  const bgRef = useRef({ stars: makeStars(), nebulae: makeNebulae(), t: 0 });
  const cutsceneRef = useRef({ t: 0, figures: null, speedLines: null });
  const travelRef = useRef({ t: 0, stars: null, streaks: null });
  const blackholeRef = useRef({ t: 0, embers: null });
  const blackholeCheckpointRef = useRef(null);
  const keysRef = useRef({});
  const rafRef = useRef(null);
  const touchRef = useRef({ active: false, x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    loadTrophies().then((n) => {
      if (!cancelled) {
        setTrophies(n);
        trophiesRef.current = n;
      }
    });
    loadShipConfig().then((cfg) => {
      if (!cancelled) {
        setShipConfig(cfg);
        shipConfigRef.current = cfg;
      }
    });
    loadWorld().then((w) => {
      if (!cancelled) setSelectedWorld(w);
    });
    loadCheckpoint().then((cp) => {
      if (!cancelled) setSavedCheckpoint(cp);
    });
    loadCompletedGame().then((v) => {
      if (!cancelled) setCompletedGame(v);
    });
    loadOwnedItems().then((v) => {
      if (!cancelled) {
        setOwnedItems(v);
        ownedItemsRef.current = v;
      }
    });
    loadSettings().then((v) => {
      if (!cancelled) {
        setSettings(v);
        setAudioMuted(v.muted);
        setVibrationEnabled(v.vibration);
      }
    });
    loadBestScore().then((n) => {
      if (!cancelled) setBest(n);
    });
    loadStats().then((v) => {
      if (!cancelled) {
        setLifetimeStats(v);
        statsRef.current = v;
      }
    });
    loadLoadoutPresets().then((v) => {
      if (!cancelled) setLoadoutPresets(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      if ("muted" in patch) {
        setAudioMuted(next.muted);
        if (audioUnlockRef.current) {
          if (next.muted) audioUnlockRef.current.pause();
          else audioUnlockRef.current.play().catch(() => {});
        }
      }
      if ("vibration" in patch) setVibrationEnabled(next.vibration);
      return next;
    });
  }, []);

  // Persists a new trophy count with retries, and remembers whether the
  // write actually landed so the tab-hide safety net (below) knows to
  // try again if it didn't.
  const persistTrophies = useCallback(async (n) => {
    trophiesRef.current = n;
    trophiesDirtyRef.current = true;
    const ok = await saveTrophies(n);
    if (ok && trophiesRef.current === n) trophiesDirtyRef.current = false;
  }, []);

  const persistShipConfig = useCallback(async (cfg) => {
    shipConfigRef.current = cfg;
    shipConfigDirtyRef.current = true;
    const ok = await saveShipConfig(cfg);
    if (ok && shipConfigRef.current === cfg) shipConfigDirtyRef.current = false;
  }, []);

  const persistOwnedItems = useCallback(async (owned) => {
    ownedItemsRef.current = owned;
    ownedItemsDirtyRef.current = true;
    const ok = await saveOwnedItems(owned);
    if (ok && ownedItemsRef.current === owned) ownedItemsDirtyRef.current = false;
  }, []);

  const updateShipConfig = useCallback(
    (patch) => {
      setShipConfig((prev) => {
        const next = { ...prev, ...patch };
        persistShipConfig(next);
        return next;
      });
    },
    [persistShipConfig]
  );

  // Saves the current shape/color/trail/bullet loadout into a named slot
  // (0-2), or equips a previously saved slot.
  const saveLoadoutSlot = useCallback(
    (index) => {
      setLoadoutPresets((prev) => {
        const next = [...prev];
        next[index] = {
          shape: shipConfig.shape,
          color: shipConfig.color,
          trail: shipConfig.trail || "none",
          bullet: shipConfig.bullet || "standard",
        };
        saveLoadoutPresets(next);
        return next;
      });
    },
    [shipConfig]
  );

  const loadLoadoutSlot = useCallback(
    (index) => {
      const slot = loadoutPresets[index];
      if (!slot) return;
      updateShipConfig(slot);
    },
    [loadoutPresets, updateShipConfig]
  );

  // Buys (and immediately equips) a shop item. category is one of
  // "shapes" | "colors" | "trails" | "bullets"; item is the catalog entry.
  const purchaseItem = useCallback(
    (category, item) => {
      const already = ownedItems[category]?.includes(item.id);
      if (!already) {
        if (trophiesRef.current < item.cost) return;
        const next = trophiesRef.current - item.cost;
        setTrophies(next);
        persistTrophies(next);
        setOwnedItems((prev) => {
          const nextOwned = { ...prev, [category]: [...prev[category], item.id] };
          persistOwnedItems(nextOwned);
          return nextOwned;
        });
        const { next: nextStats, newlyUnlocked } = applyStatsUpdate(statsRef.current, {
          itemsPurchased: statsRef.current.itemsPurchased + 1,
        });
        statsRef.current = nextStats;
        setLifetimeStats(nextStats);
        saveStats(nextStats);
        if (newlyUnlocked.length) {
          setAchievementToast(newlyUnlocked[0]);
          setTimeout(() => setAchievementToast(null), 3200);
        }
      }
      if (category === "shapes") updateShipConfig({ shape: item.id });
      else if (category === "colors") updateShipConfig({ color: item.hex });
      else if (category === "trails") updateShipConfig({ trail: item.id });
      else if (category === "bullets") updateShipConfig({ bullet: item.id });
    },
    [ownedItems, persistTrophies, updateShipConfig]
  );

  const chooseWorld = useCallback(
    (w) => {
      if (completedGame) {
        // free travel between all worlds, unlocked by beating the mothership
        if (w === selectedWorld) return;
        setSelectedWorld(w);
        saveWorld(w);
        return;
      }
      const currentIdx = WORLD_ORDER.indexOf(selectedWorld);
      const targetIdx = WORLD_ORDER.indexOf(w);
      if (targetIdx === currentIdx) return; // already here
      if (targetIdx !== currentIdx + 1) return; // can't skip ahead or go back
      if (trophiesRef.current < 5) return;
      setSelectedWorld(w);
      saveWorld(w);
      setTrophies(0);
      persistTrophies(0);
      setStatus("travel");
    },
    [selectedWorld, persistTrophies, completedGame]
  );

  // Browsers won't play audio until the person has interacted with the
  // page, so the first click/tap/keypress unlocks the shared AudioContext.
  // It also does two things specifically to keep sound working when an
  // iPhone's hardware silent switch is on: sets the (still draft-stage,
  // Safari-only) AudioSession type to "playback", and — as a fallback for
  // Safari versions that don't have that API yet — starts a quiet looping
  // <audio> track, since real <audio>/<video> elements get treated as
  // "media" rather than "ambient" sound. Neither of these is a guaranteed
  // fix; Apple hasn't fully nailed down or documented this behavior, and
  // it's known to be inconsistent across iOS versions even among sites
  // using both tricks together.
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx) setAudioReady(true);
      if (typeof navigator !== "undefined" && "audioSession" in navigator) {
        try {
          navigator.audioSession.type = "playback";
        } catch {
          // draft API, shape may vary — harmless if it throws
        }
      }
      if (!audioMuted && audioUnlockRef.current && audioUnlockRef.current.paused) {
        audioUnlockRef.current.play().catch(() => {
          // autoplay can still be blocked in some contexts — harmless, the
          // next interaction will retry
        });
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Title-screen music — a looping space-arcade arpeggio + bassline,
  // synthesized on the fly. Paused during active gameplay.
  useEffect(() => {
    if (status === "playing" || !audioReady) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const melody = [392, 440, 523.25, 659.25, 523.25, 440, 392, 349.23];
    const bass = [196, 196, 130.81, 130.81];
    let step = 0;
    const stepMs = 190;
    const id = setInterval(() => {
      const c = getAudioCtx();
      if (!c) return;
      tone(c, { freq: melody[step % melody.length], duration: 0.17, type: "square", vol: 0.05 });
      if (step % 2 === 0) {
        tone(c, { freq: bass[(step / 2) % bass.length], duration: 0.32, type: "triangle", vol: 0.06 });
      }
      step++;
    }, stepMs);
    return () => clearInterval(id);
  }, [status, audioReady]);

  const initState = useCallback(() => {
    stateRef.current = {
      player: {
        x: WIDTH / 2,
        y: HEIGHT - 90,
        vx: 0,
        vy: 0,
        cool: 0,
        hit: 0,
        cooldown: BASE_COOL,
        spread: 1,
        bulletSpeedMult: 1,
        speedMult: 1,
        pierce: false,
        powerCounts: {},
        shieldCharges: 0,
        drones: 0,
        extraLifeGranted: false,
        frozen: 0,
        disarmed: 0,
        slowed: 0,
        transformed: false,
        moveCooldowns: { spread: 0, aimed: 0, laser: 0, burst: 0 },
      },
      bullets: [],
      rocks: [],
      bossBullets: [],
      particles: [],
      stars: makeStars(),
      nebulae: makeNebulae(),
      t: 0,
      spawnTimer: 0,
      degradeTimer: DEGRADE_INTERVAL,
      score: 0,
      wave: 1,
      shakeT: 0,
      banner: null, // { text, sub, t }
      alert: null, // { text, t, warn }
      boss: null,
      bossActive: false,
      bossIndex: 0,
      lastBossWave: 0,
      finale: null, // { x, y, timer, tier }
      deathSequence: null, // { x, y, timer, cause }
      lastDamageCause: null,
      world: "homeworld",
      difficulty: "normal",
      reduceEffects: false,
      bossRush: false,
      runStats: {
        asteroidsDestroyed: 0,
        bossesBeaten: 0,
        flawlessBossWins: 0,
        tookDamageThisBoss: false,
        survivedThrusterFailure: false,
        damageBySource: {},
        startedAt: Date.now(),
      },
    };
  }, []);

  const startGame = useCallback(() => {
    initState();
    stateRef.current.player.shape = shipConfig.shape;
    stateRef.current.player.color = shipConfig.color;
    stateRef.current.player.trail = shipConfig.trail || "none";
    stateRef.current.player.bullet = shipConfig.bullet || "standard";
    stateRef.current.world = selectedWorld;
    stateRef.current.difficulty = settings.difficulty;
    stateRef.current.reduceEffects = settings.reduceEffects;
    stateRef.current.degradeTimer =
      DEGRADE_INTERVAL * (DIFFICULTIES[settings.difficulty] || DIFFICULTIES.normal).degradeMult;
    setScore(0);
    setWave(1);
    setStatusFlags({ frozen: false, disarmed: false });
    setBossHud(null);
    setDeathCause(null);
    setPaused(false);
    setFinalVictory(false);
    setShowShop(false);
    setBossRushSelection(null);
    setStatus("playing");
    if (savedCheckpoint) {
      clearCheckpoint();
      setSavedCheckpoint(null);
    }
  }, [initState, shipConfig, selectedWorld, savedCheckpoint, settings.difficulty, settings.reduceEffects]);

  // Boss Rush — jump straight into a fight with a chosen boss, no waves,
  // no trophy on the line. Only worlds the player has actually reached
  // are selectable (or all of them once the game's been completed).
  const startBossRush = useCallback(
    (world, tier) => {
      initState();
      const s = stateRef.current;
      s.player.shape = shipConfig.shape;
      s.player.color = shipConfig.color;
      s.player.trail = shipConfig.trail || "none";
      s.player.bullet = shipConfig.bullet || "standard";
      s.world = world;
      s.difficulty = settings.difficulty;
      s.reduceEffects = settings.reduceEffects;
      s.degradeTimer = DEGRADE_INTERVAL * (DIFFICULTIES[settings.difficulty] || DIFFICULTIES.normal).degradeMult;
      s.bossRush = true;
      s.bossActive = true;
      s.wave = tier === "mega" ? 25 : 5;
      spawnBoss(s, 0, tier, world);
      setScore(0);
      setWave(s.wave);
      setStatusFlags({ frozen: false, disarmed: false });
      setBossHud(null);
      setDeathCause(null);
      setPaused(false);
      setFinalVictory(false);
      setShowShop(false);
      setShowBossRush(false);
      setBossRushResult(null);
      setBossRushSelection({ world, tier });
      setStatus("playing");
    },
    [initState, shipConfig, settings.difficulty, settings.reduceEffects]
  );

  const retryBossRush = useCallback(() => {
    if (!bossRushSelection) return;
    startBossRush(bossRushSelection.world, bossRushSelection.tier);
  }, [bossRushSelection, startBossRush]);

  // Merges a finished run's stats into lifetime totals, persists them,
  // snapshots a run summary for the result screen, and surfaces any
  // achievement that just unlocked. Boss Rush runs still populate the
  // summary screen but don't touch lifetime stats (practice doesn't count).
  const flushRunStats = useCallback((s, { died, trophiesEarned = 0 }) => {
    const rs = s.runStats || {};
    setRunSummary({
      wave: s.wave,
      score: s.score,
      asteroidsDestroyed: rs.asteroidsDestroyed || 0,
      bossesBeaten: rs.bossesBeaten || 0,
      damageBySource: rs.damageBySource || {},
      died,
      bossRush: !!s.bossRush,
    });
    if (s.bossRush) return;
    const patch = {
      totalAsteroidsDestroyed: statsRef.current.totalAsteroidsDestroyed + (rs.asteroidsDestroyed || 0),
      totalBossesBeaten: statsRef.current.totalBossesBeaten + (rs.bossesBeaten || 0),
      totalDeaths: statsRef.current.totalDeaths + (died ? 1 : 0),
      bestWave: Math.max(statsRef.current.bestWave, s.wave),
      flawlessBossWins: statsRef.current.flawlessBossWins + (rs.flawlessBossWins || 0),
      mothershipDefeated: statsRef.current.mothershipDefeated || (!died && s.world === "wormhole" && s.wave >= 25),
      mothershipDefeatedHard:
        statsRef.current.mothershipDefeatedHard ||
        (!died && s.world === "wormhole" && s.wave >= 25 && s.difficulty === "hard"),
      thrusterFailureSurvived:
        statsRef.current.thrusterFailureSurvived + (rs.survivedThrusterFailure ? 1 : 0),
      lifetimeTrophies: statsRef.current.lifetimeTrophies + trophiesEarned,
      foundOrangeCombo: statsRef.current.foundOrangeCombo || !!rs.foundOrangeCombo,
      foundBlackHole: statsRef.current.foundBlackHole || !!rs.foundBlackHole,
    };
    const { next, newlyUnlocked } = applyStatsUpdate(statsRef.current, patch);
    statsRef.current = next;
    setLifetimeStats(next);
    saveStats(next);
    if (newlyUnlocked.some((a) => a.id === "easter_egg_collector")) {
      setOwnedItems((prev) => {
        if (prev.shapes.includes("egg")) return prev;
        const nextOwned = { ...prev, shapes: [...prev.shapes, "egg"] };
        persistOwnedItems(nextOwned);
        return nextOwned;
      });
    }
    if (newlyUnlocked.length) {
      setAchievementToast(newlyUnlocked[0]);
      setTimeout(() => setAchievementToast(null), 3200);
    }
  }, []);

  const resumeGame = useCallback(() => {
    if (!savedCheckpoint) return;
    initState();
    const s = stateRef.current;
    const cp = savedCheckpoint;
    s.score = cp.score;
    s.wave = cp.wave;
    s.lives = cp.lives;
    s.world = cp.world || "homeworld";
    s.bossIndex = cp.bossIndex || 0;
    s.difficulty = cp.difficulty || settings.difficulty;
    s.reduceEffects = settings.reduceEffects;
    s.degradeTimer = DEGRADE_INTERVAL * (DIFFICULTIES[s.difficulty] || DIFFICULTIES.normal).degradeMult;
    Object.assign(s.player, cp.player || {});
    setScore(cp.score);
    setWave(cp.wave);
    setStatusFlags({ frozen: false, disarmed: false });
    setBossHud(null);
    setDeathCause(null);
    setPaused(false);
    setFinalVictory(false);
    setStatus("playing");
  }, [initState, savedCheckpoint, settings.difficulty, settings.reduceEffects]);

  const goHome = useCallback(() => {
    setBossRushSelection(null);
    setStatus("start");
  }, []);

  // Quit from the pause menu — saves the current run as a checkpoint (so
  // it shows up as "Resume" on the title screen) rather than discarding it.
  const quitToHome = useCallback(() => {
    const s = stateRef.current;
    if (s && s.lives > 0) {
      const cp = buildCheckpoint(s);
      saveCheckpoint(cp);
      setSavedCheckpoint(cp);
    }
    setPaused(false);
    setStatus("start");
  }, []);

  // "Try Again" from the black hole's MISSION FAILED screen — restores
  // the run to exactly how it was right before flying into the black hole.
  const tryAgainFromBlackhole = useCallback(() => {
    const cp = blackholeCheckpointRef.current;
    if (!cp) {
      setStatus("start");
      return;
    }
    initState();
    const s = stateRef.current;
    s.score = cp.score;
    s.wave = cp.wave;
    s.lives = cp.lives;
    s.world = cp.world || "outworld";
    s.bossIndex = cp.bossIndex || 0;
    Object.assign(s.player, cp.player || {});
    s.runStats.foundBlackHole = true; // they had to find it to get here
    setScore(cp.score);
    setWave(cp.wave);
    setStatusFlags({ frozen: false, disarmed: false });
    setBossHud(null);
    setDeathCause(null);
    setBlackholeFailed(false);
    setPaused(false);
    setStatus("playing");
  }, [initState]);

  const quitFromBlackhole = useCallback(() => {
    if (stateRef.current) {
      stateRef.current.runStats.foundBlackHole = true;
      flushRunStats(stateRef.current, { died: true });
    }
    setBlackholeFailed(false);
    setStatus("start");
  }, [flushRunStats]);

  // Full progress reset — trophies, world unlock progress, and the
  // mission-complete flag all go back to zero. Ship customization is left
  // alone since that's a preference, not progress.
  const restartGame = useCallback(() => {
    setTrophies(0);
    trophiesRef.current = 0;
    persistTrophies(0);
    setSelectedWorld("homeworld");
    saveWorld("homeworld");
    setCompletedGame(false);
    saveCompletedGame(false);
    clearCheckpoint();
    setSavedCheckpoint(null);
    setFinalVictory(false);
    setConfirmRestart(false);
  }, [persistTrophies]);

  const grantPowerUp = (s, bannerText) => {
    const p = s.player;
    let pool = (WORLDS[s.world] || WORLDS.homeworld).powerups;
    if (p.extraLifeGranted) {
      pool = pool.filter((pu) => pu.id !== "fueltank");
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    pick.apply(p);
    if (pick.id === "fueltank" && !p.extraLifeGranted) {
      p.extraLifeGranted = true;
      s.lives = (s.lives ?? 3) + 1;
    }
    p.powerCounts[pick.id] = (p.powerCounts[pick.id] || 0) + 1;
    s.banner = { text: bannerText, sub: `POWER UP: ${pick.label}`, t: 130 };
  };

  // Keyboard
  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.key.toLowerCase()] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      if (e.key === " ") {
        if (status === "cutscene") setStatus("tutorial");
        else if (status === "travel") setStatus("start");
        else if (status === "start" || status === "gameover" || status === "won") startGame();
      }
      if ((e.key === "Escape" || e.key.toLowerCase() === "p") && status === "playing") {
        setPaused((v) => {
          const next = !v;
          if (next && stateRef.current && stateRef.current.lives > 0) {
            const cp = buildCheckpoint(stateRef.current);
            saveCheckpoint(cp);
            setSavedCheckpoint(cp);
          }
          return next;
        });
      }
    };
    const up = (e) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [status, startGame]);

  // Keep a ref in sync so the gameplay loop (which doesn't restart on
  // every pause toggle) can check pause state live.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Save progress the moment the tab is backgrounded or torn down — this is
  // what actually fires reliably on mobile when someone switches apps or
  // closes the tab (unlike beforeunload, which mobile browsers often skip).
  useEffect(() => {
    const saveNow = () => {
      if (status === "playing" && stateRef.current && stateRef.current.lives > 0) {
        saveCheckpoint(buildCheckpoint(stateRef.current));
      }
      // trophies are precious — re-flush if the original save after a win
      // never got confirmed (e.g. the tab was killed mid-write)
      if (trophiesDirtyRef.current) {
        saveTrophies(trophiesRef.current).then((ok) => {
          if (ok) trophiesDirtyRef.current = false;
        });
      }
      // same treatment for purchased shop items and the equipped loadout —
      // this is exactly what was getting lost on tab close before
      if (ownedItemsDirtyRef.current) {
        saveOwnedItems(ownedItemsRef.current).then((ok) => {
          if (ok) ownedItemsDirtyRef.current = false;
        });
      }
      if (shipConfigDirtyRef.current) {
        saveShipConfig(shipConfigRef.current).then((ok) => {
          if (ok) shipConfigDirtyRef.current = false;
        });
      }
    };
    const onVisibility = () => {
      if (document.hidden) saveNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", saveNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", saveNow);
    };
  }, [status]);

  // Decorative background for the title / end screens — the gameplay loop
  // below only runs while playing, so this keeps a living starfield, a
  // slow-turning galaxy, and a ringed planet visible behind those overlays.
  useEffect(() => {
    if (
      status === "playing" ||
      status === "cutscene" ||
      status === "travel" ||
      status === "blackhole" ||
      status === "homecoming"
    )
      return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const bg = bgRef.current;

    const drawIdle = () => {
      bg.t++;
      bg.stars.forEach((st) => {
        st.y += st.speed * 0.6;
        if (st.y > HEIGHT + 2) {
          st.y = -2;
          st.x = rand(0, WIDTH);
        }
      });
      bg.nebulae.forEach((n) => {
        n.x += n.drift;
        if (n.x < -n.r) n.x = WIDTH + n.r;
        if (n.x > WIDTH + n.r) n.x = -n.r;
      });

      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // distant spiral galaxy — the signature backdrop element for the
      // title screen
      ctx.save();
      ctx.translate(WIDTH * 0.7, HEIGHT * 0.26);
      ctx.rotate(bg.t * 0.0008);
      const galaxyGlow = ctx.createRadialGradient(0, 0, 3, 0, 0, 140);
      galaxyGlow.addColorStop(0, "rgba(255,255,255,0.85)");
      galaxyGlow.addColorStop(0.12, "rgba(210,180,255,0.4)");
      galaxyGlow.addColorStop(0.45, "rgba(120,80,200,0.14)");
      galaxyGlow.addColorStop(1, "rgba(120,80,200,0)");
      ctx.fillStyle = galaxyGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 140, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = "rgba(200,170,255,0.14)";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(0, 0, 42 + i * 24, i * 2.05, i * 2.05 + 2.6);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();

      // distant ringed planet
      ctx.save();
      ctx.translate(WIDTH * 0.15, HEIGHT * 0.8);
      const planetGrad = ctx.createRadialGradient(-9, -9, 3, 0, 0, 30);
      planetGrad.addColorStop(0, "#a7e3ff");
      planetGrad.addColorStop(0.55, "#3d6f9c");
      planetGrad.addColorStop(1, "#122036");
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      ctx.fillStyle = planetGrad;
      ctx.fill();
      ctx.save();
      ctx.rotate(-0.32);
      ctx.strokeStyle = "rgba(220,205,255,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 46, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.restore();

      bg.nebulae.forEach((n) => {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, n.c1);
        g.addColorStop(1, n.c2);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      });

      bg.stars.forEach((st) => {
        const twinkle = 0.5 + 0.5 * Math.sin(bg.t * 0.04 + st.phase);
        ctx.globalAlpha = st.baseAlpha * (0.5 + 0.5 * twinkle);
        ctx.fillStyle = COLORS.white;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(drawIdle);
    };
    raf = requestAnimationFrame(drawIdle);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // Opening cutscene — homeworld launch, liftoff, atmosphere exit, then a
  // space flyby. Runs once on load (skippable), then hands off to the
  // tutorial. Fully procedural canvas drawing, no external assets.
  useEffect(() => {
    if (status !== "cutscene") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const cs = cutsceneRef.current;
    cs.t = 0;
    if (!cs.figures) {
      cs.figures = Array.from({ length: 5 }, (_, i) => ({
        x: WIDTH * 0.34 + i * 24 + rand(-4, 4),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.1, 0.16),
      }));
    }
    if (!cs.speedLines) {
      cs.speedLines = Array.from({ length: 26 }, () => ({
        ang: rand(0, Math.PI * 2),
        dist: rand(20, 240),
        len: rand(30, 90),
        speed: rand(3, 7),
      }));
    }
    let raf;
    let lastCaption = "";

    const drawFigure = (x, groundY, waveAngle) => {
      ctx.save();
      ctx.translate(x, groundY);
      ctx.strokeStyle = "#150f22";
      ctx.fillStyle = "#150f22";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -18, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 2);
      ctx.moveTo(0, 2);
      ctx.lineTo(-4, 13);
      ctx.moveTo(0, 2);
      ctx.lineTo(4, 13);
      ctx.moveTo(0, -11);
      ctx.lineTo(-5, -3);
      ctx.stroke();
      ctx.save();
      ctx.translate(0, -11);
      ctx.rotate(waveAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(6, -7);
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    };

    const drawHeroShip = (x, y, scale, tilt, flame, accent) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(scale, scale);

      if (flame > 0) {
        const fg = ctx.createLinearGradient(0, 16, 0, 16 + flame);
        fg.addColorStop(0, "rgba(255,255,255,0.95)");
        fg.addColorStop(0.4, accent);
        fg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(0, 16 + flame / 2, 5, flame / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // bold cel-shaded hull — flat fill, thick outline, single highlight
      // stripe, in the anime "hero shot" mold
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(9, -8);
      ctx.lineTo(22, 8);
      ctx.lineTo(11, 12);
      ctx.lineTo(9, 22);
      ctx.lineTo(0, 17);
      ctx.lineTo(-9, 22);
      ctx.lineTo(-11, 12);
      ctx.lineTo(-22, 8);
      ctx.lineTo(-9, -8);
      ctx.closePath();
      ctx.fillStyle = "#2b2e33";
      ctx.fill();
      ctx.strokeStyle = "#0a0a0c";
      ctx.lineWidth = 2.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(4, -6);
      ctx.lineTo(0, 4);
      ctx.lineTo(-4, -6);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, -14, 2.6, 4.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#eafcff";
      ctx.fill();
      ctx.strokeStyle = "#0a0a0c";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    };

    const draw = () => {
      try {
      cs.t++;
      const t = cs.t;
      const overall = Math.min(1, t / CUTSCENE_DURATION);

      let phase, p;
      if (t < CUTSCENE_GROUND_END) {
        phase = "ground";
        p = t / CUTSCENE_GROUND_END;
      } else if (t < CUTSCENE_LIFTOFF_END) {
        phase = "liftoff";
        p = (t - CUTSCENE_GROUND_END) / (CUTSCENE_LIFTOFF_END - CUTSCENE_GROUND_END);
      } else if (t < CUTSCENE_ASCENT_END) {
        phase = "ascent";
        p = (t - CUTSCENE_LIFTOFF_END) / (CUTSCENE_ASCENT_END - CUTSCENE_LIFTOFF_END);
      } else {
        phase = "space";
        p = (t - CUTSCENE_ASCENT_END) / (CUTSCENE_DURATION - CUTSCENE_ASCENT_END);
      }

      const captions = {
        ground: "Homeworld — Launch Day",
        liftoff: "Farewell...",
        ascent: "Breaking atmosphere...",
        space: "Alone among the stars.",
      };
      if (captions[phase] !== lastCaption) {
        lastCaption = captions[phase];
        setCutsceneCaption(lastCaption);
      }

      const accent =
        shipConfig.color === "rainbow" ? `hsl(${(t * 2) % 360},85%,62%)` : shipConfig.color || COLORS.amber;
      const sky = skyColorsAt(overall);

      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      skyGrad.addColorStop(0, sky.top);
      skyGrad.addColorStop(1, sky.bottom);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // stars fade in from the ascent phase onward
      if (overall > 0.45) {
        const starAlpha = Math.min(1, (overall - 0.45) / 0.35);
        bgRef.current.stars.forEach((st) => {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.04 + st.phase);
          ctx.globalAlpha = starAlpha * st.baseAlpha * (0.5 + 0.5 * twinkle);
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(st.x, (st.y + t * 0.4) % HEIGHT, st.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      // ground / horizon — visible during ground and fading through liftoff
      if (phase === "ground" || phase === "liftoff") {
        const groundFade = phase === "ground" ? 1 : Math.max(0, 1 - p * 1.6);
        const groundY = HEIGHT * 0.66;
        ctx.save();
        ctx.globalAlpha = groundFade;

        // distant mountains
        ctx.fillStyle = "#2a1f3d";
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        for (let x = 0; x <= WIDTH; x += 40) {
          ctx.lineTo(x, groundY - 20 - 34 * Math.abs(Math.sin(x * 0.01 + 2)));
        }
        ctx.lineTo(WIDTH, groundY);
        ctx.closePath();
        ctx.fill();

        // foreground ground plane
        ctx.fillStyle = "#1a1428";
        ctx.fillRect(0, groundY, WIDTH, HEIGHT - groundY);

        // launch pad glow under the ship
        const padX = WIDTH * 0.58;
        const padGrad = ctx.createRadialGradient(padX, groundY, 4, padX, groundY, 70);
        padGrad.addColorStop(0, "rgba(255,220,160,0.35)");
        padGrad.addColorStop(1, "rgba(255,220,160,0)");
        ctx.fillStyle = padGrad;
        ctx.beginPath();
        ctx.arc(padX, groundY, 70, 0, Math.PI * 2);
        ctx.fill();

        // waving crowd, fades out quickly once liftoff begins
        if (phase === "ground" || p < 0.35) {
          const figAlpha = phase === "ground" ? 1 : Math.max(0, 1 - p / 0.35);
          ctx.globalAlpha = groundFade * figAlpha;
          cs.figures.forEach((f) => {
            const wave = Math.sin(t * f.speed + f.phase) * 0.7;
            drawFigure(f.x, groundY + 4, wave);
          });
        }
        ctx.restore();
      }

      // speed lines — anime-style motion streaks, ramping up through
      // ascent and into the final space flyby
      if (phase === "ascent" || phase === "space") {
        const intensity = phase === "ascent" ? p : 1;
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.4;
        cs.speedLines.forEach((ln) => {
          ln.dist += ln.speed * (0.6 + intensity);
          if (ln.dist > 340) ln.dist = 10;
          const cx = WIDTH / 2 + Math.cos(ln.ang) * ln.dist;
          const cy = HEIGHT / 2 + Math.sin(ln.ang) * ln.dist;
          const ex = WIDTH / 2 + Math.cos(ln.ang) * (ln.dist + ln.len);
          const ey = HEIGHT / 2 + Math.sin(ln.ang) * (ln.dist + ln.len);
          ctx.globalAlpha = 0.25 * intensity;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        });
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // clouds streaking past during ascent
      if (phase === "ascent") {
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - p * 0.6);
        ctx.fillStyle = "#e8e4f0";
        for (let i = 0; i < 5; i++) {
          const cy = ((i * 137 + t * 6) % (HEIGHT + 60)) - 30;
          ctx.beginPath();
          ctx.ellipse(WIDTH * (0.2 + 0.15 * i), cy, 46, 8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // the ship itself — three staged shots: idle on the pad, climbing
      // away, then a hero flyby through open space
      if (phase === "ground") {
        const idleFlame = 3 + Math.sin(t * 0.3) * 2;
        drawHeroShip(WIDTH * 0.58, HEIGHT * 0.63, 0.85, 0, Math.max(0, idleFlame), accent);
      } else if (phase === "liftoff") {
        const ease = easeOutCubic(p);
        const x = WIDTH * 0.58 + Math.sin(p * 2) * 6;
        const y = HEIGHT * 0.63 - ease * HEIGHT * 0.5;
        const scale = 0.85 - ease * 0.35;
        const tilt = -ease * 0.12;
        const flame = 14 + Math.sin(t * 0.6) * 5 + p * 10;
        drawHeroShip(x, y, scale, tilt, flame, accent);
      } else if (phase === "ascent") {
        const ease = easeOutCubic(p);
        const x = WIDTH * 0.6 + ease * 40;
        const y = HEIGHT * 0.13 - ease * HEIGHT * 0.25;
        const scale = Math.max(0.08, 0.5 - ease * 0.42);
        const tilt = -0.12 - ease * 0.1;
        drawHeroShip(x, y, scale, tilt, 10, accent);
      } else if (phase === "space") {
        const ease = easeOutCubic(Math.min(1, p * 1.15));
        const x = WIDTH * 0.12 + ease * WIDTH * 0.62;
        const y = HEIGHT * 0.5 - Math.sin(p * Math.PI) * 60;
        const tilt = -0.22 + Math.sin(p * Math.PI) * 0.1;
        // motion trail
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 60, y + 14);
        ctx.lineTo(x - 14, y + 4);
        ctx.stroke();
        ctx.restore();
        drawHeroShip(x, y, 1.15, tilt, 16, accent);
      }

      // cinematic letterbox bars
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WIDTH, 36);
      ctx.fillRect(0, HEIGHT - 36, WIDTH, 36);

      // fade to black at the very end, into the tutorial
      if (t > CUTSCENE_DURATION - 50) {
        const fadeAlpha = Math.min(1, (t - (CUTSCENE_DURATION - 50)) / 50);
        ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }

      if (t >= CUTSCENE_DURATION) {
        setStatus("tutorial");
        return;
      }
      raf = requestAnimationFrame(draw);
      } catch (e) {
        console.error("Opening cutscene frame error, recovering:", e);
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [status, shipConfig.color]);

  // Travel cutscene — plays whenever the ship jumps to a new world.
  // Pilot POV: cockpit frame, a monitor readout typing out the launch
  // sequence, then a hyperspace warp into an exterior hero shot of the
  // ship rocketing off into the new world's starfield. Recolored per
  // destination via travelTheme() — icy blue for the Frontier, purple
  // for the Outworld.
  useEffect(() => {
    if (status !== "travel") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const tv = travelRef.current;
    tv.t = 0;
    if (!tv.stars) {
      tv.stars = Array.from({ length: 70 }, () => ({
        x: rand(0, WIDTH),
        y: rand(0, HEIGHT),
        r: rand(0.6, 2),
        phase: rand(0, Math.PI * 2),
      }));
    }
    if (!tv.streaks) {
      tv.streaks = Array.from({ length: 40 }, () => ({
        ang: rand(0, Math.PI * 2),
        dist: rand(10, 260),
        speed: rand(3, 8),
      }));
    }

    const PER_LINE = 150; // ~2.5s per line at 60fps
    const theme = travelTheme(selectedWorld);
    const LINES = theme.isCall
      ? [
          "We have enough data.",
          "We have sent a wormhole to your location.",
          "There seems to be an unknown anomaly inside of it...",
          "...but it's nothing you can't handle, right?",
        ]
      : ["ENHANCING NITRO-BOOSTERS...", "PREPARING SHIP ENGINE...", "INITIATING HYPERDRIVE..."];
    const COCKPIT_END = LINES.length * PER_LINE;
    const WARP_END = COCKPIT_END + 180;
    const DURATION = WARP_END + 110;

    let raf;

    const drawCockpitFrame = () => {
      // dashboard
      ctx.fillStyle = "#0a0c10";
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT);
      ctx.lineTo(0, HEIGHT - 96);
      ctx.lineTo(WIDTH * 0.2, HEIGHT - 148);
      ctx.lineTo(WIDTH * 0.8, HEIGHT - 148);
      ctx.lineTo(WIDTH, HEIGHT - 96);
      ctx.lineTo(WIDTH, HEIGHT);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#232b38";
      ctx.lineWidth = 2;
      ctx.stroke();

      // canopy struts, top corners
      ctx.fillStyle = "#0a0c10";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(WIDTH * 0.2, 0);
      ctx.lineTo(0, HEIGHT * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(WIDTH, 0);
      ctx.lineTo(WIDTH * 0.8, 0);
      ctx.lineTo(WIDTH, HEIGHT * 0.24);
      ctx.closePath();
      ctx.fill();

      // center windshield strut
      ctx.fillStyle = "#12161c";
      ctx.fillRect(WIDTH / 2 - 3, 0, 6, HEIGHT * 0.18);
    };

    const drawBossPortrait = () => {
      // a stern commander on a video call — headset, hair pulled back,
      // narrow serious eyes, mid-speech. Deliberately different styling
      // from the pilot's own terrified portrait used elsewhere.
      const mx = WIDTH * 0.5;
      const my = HEIGHT * 0.34;
      ctx.save();
      ctx.translate(mx, my);

      ctx.fillStyle = "#04070a";
      ctx.fillRect(-80, -70, 160, 140);
      ctx.shadowColor = theme.monitorBorder;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = theme.monitorBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(-80, -70, 160, 140);
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(-68, -58, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ff4040";
      ctx.fill();
      ctx.textAlign = "left";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#ff8080";
      ctx.fillText("LIVE — COMMAND", -60, -55);

      ctx.save();
      ctx.translate(0, 10);

      ctx.beginPath();
      ctx.ellipse(0, -6, 42, 48, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#241a14";
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 2, 34, 40, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#d9a878";
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-36, -6);
      ctx.quadraticCurveTo(-30, -40, 0, -42);
      ctx.quadraticCurveTo(30, -40, 36, -6);
      ctx.quadraticCurveTo(20, -20, 0, -22);
      ctx.quadraticCurveTo(-20, -20, -36, -6);
      ctx.closePath();
      ctx.fillStyle = "#241a14";
      ctx.fill();

      ctx.strokeStyle = "#241a14";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-22, -8);
      ctx.lineTo(-6, -10);
      ctx.moveTo(6, -10);
      ctx.lineTo(22, -8);
      ctx.stroke();

      [-13, 13].forEach((ex) => {
        ctx.beginPath();
        ctx.ellipse(ex, 0, 7, 4.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, 0, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#2a1a10";
        ctx.fill();
      });

      ctx.beginPath();
      ctx.ellipse(0, 22, 5, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#5a2a20";
      ctx.fill();

      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -6, 40, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(34, 10);
      ctx.quadraticCurveTo(40, 20, 20, 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(20, 26, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#1a1a1a";
      ctx.fill();

      ctx.restore();
      ctx.restore();
    };

    const drawSubtitles = (t) => {
      const idx = Math.min(LINES.length - 1, Math.floor(t / PER_LINE));
      const start = idx * PER_LINE;
      const line = LINES[idx];
      const typed = Math.min(line.length, Math.floor(((t - start) / (PER_LINE * 0.55)) * line.length));
      const shown = line.slice(0, typed);
      const cursor = typed < line.length && Math.floor(t / 8) % 2 === 0 ? "_" : "";
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "13px 'JetBrains Mono', 'Courier New', monospace";
      ctx.fillStyle = theme.monitorText;
      ctx.shadowColor = theme.monitorBorder;
      ctx.shadowBlur = 6;
      ctx.fillText(`"${shown}${cursor}"`, WIDTH / 2, HEIGHT - 162);
      ctx.shadowBlur = 0;
      ctx.restore();
    };

    const drawMonitor = (t) => {
      if (theme.isCall) {
        drawBossPortrait();
        drawSubtitles(t);
        return;
      }
      const mx = WIDTH * 0.62;
      const my = HEIGHT - 116;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-0.04);
      ctx.fillStyle = "#04070a";
      ctx.fillRect(-92, -40, 184, 80);
      ctx.shadowColor = theme.monitorBorder;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = theme.monitorBorder;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-92, -40, 184, 80);
      ctx.shadowBlur = 0;

      ctx.textAlign = "left";
      ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
      LINES.forEach((line, i) => {
        const start = i * PER_LINE;
        if (t < start) return;
        const typed = Math.min(line.length, Math.floor(((t - start) / (PER_LINE * 0.55)) * line.length));
        const shown = line.slice(0, typed);
        const cursor = typed < line.length && Math.floor(t / 8) % 2 === 0 ? "_" : "";
        ctx.fillStyle = theme.monitorText;
        ctx.fillText(shown + cursor, -80, -18 + i * 18);
      });
      ctx.restore();
    };

    const drawHeroShip = (x, y, scale, tilt, flame, accent) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(scale, scale);
      if (flame > 0) {
        const fg = ctx.createLinearGradient(0, 16, 0, 16 + flame);
        fg.addColorStop(0, "rgba(255,255,255,0.95)");
        fg.addColorStop(0.4, accent);
        fg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(0, 16 + flame / 2, 5, flame / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(9, -8);
      ctx.lineTo(22, 8);
      ctx.lineTo(11, 12);
      ctx.lineTo(9, 22);
      ctx.lineTo(0, 17);
      ctx.lineTo(-9, 22);
      ctx.lineTo(-11, 12);
      ctx.lineTo(-22, 8);
      ctx.lineTo(-9, -8);
      ctx.closePath();
      ctx.fillStyle = "#2b2e33";
      ctx.fill();
      ctx.strokeStyle = "#0a0a0c";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(4, -6);
      ctx.lineTo(0, 4);
      ctx.lineTo(-4, -6);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.restore();
    };

    const draw = () => {
      try {
      tv.t++;
      const t = tv.t;
      const accent =
        shipConfig.color === "rainbow" ? `hsl(${(t * 2) % 360},85%,62%)` : shipConfig.color || COLORS.amber;

      let phase;
      if (t < COCKPIT_END) phase = "cockpit";
      else if (t < WARP_END) phase = "warp";
      else phase = "arrival";

      // background: deep space, shifting toward the destination's tint
      ctx.fillStyle = phase === "arrival" ? theme.arrivalBg : "#05060a";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      tv.stars.forEach((st) => {
        const twinkle = 0.5 + 0.5 * Math.sin(t * 0.05 + st.phase);
        ctx.globalAlpha = 0.5 * (0.5 + 0.5 * twinkle);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(st.x, (st.y + t * (phase === "cockpit" ? 0.3 : 0)) % HEIGHT, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      if (phase === "cockpit") {
        drawCockpitFrame();
        drawMonitor(t);
      } else if (phase === "warp") {
        const wp = (t - COCKPIT_END) / (WARP_END - COCKPIT_END);
        if (theme.isCall) {
          // a swirling green wormhole vortex, pulling the ship inward
          ctx.save();
          ctx.translate(WIDTH / 2, HEIGHT / 2);
          const arms = 5;
          for (let a = 0; a < arms; a++) {
            ctx.strokeStyle = theme.streak;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.55 * wp;
            ctx.beginPath();
            const baseAng = (a / arms) * Math.PI * 2 + t * 0.05;
            for (let r = 10; r < 320; r += 6) {
              const ang = baseAng + r * 0.026 - wp * 4;
              const x = Math.cos(ang) * r;
              const y = Math.sin(ang) * r;
              if (r === 10) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          ctx.restore();
          ctx.globalAlpha = 1;

          const vGlow = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 4, WIDTH / 2, HEIGHT / 2, 60 + wp * 80);
          vGlow.addColorStop(0, "rgba(120,255,180,0.5)");
          vGlow.addColorStop(1, "rgba(20,140,80,0)");
          ctx.fillStyle = vGlow;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        } else {
          ctx.save();
          ctx.strokeStyle = theme.streak;
          ctx.lineWidth = 1.6;
          tv.streaks.forEach((ln) => {
            ln.dist += ln.speed * (1 + wp * 4);
            if (ln.dist > 320) ln.dist = 10;
            const len = 30 + wp * 140;
            const cx = WIDTH / 2 + Math.cos(ln.ang) * ln.dist;
            const cy = HEIGHT / 2 + Math.sin(ln.ang) * ln.dist;
            const ex = WIDTH / 2 + Math.cos(ln.ang) * (ln.dist + len);
            const ey = HEIGHT / 2 + Math.sin(ln.ang) * (ln.dist + len);
            ctx.globalAlpha = 0.5 * wp;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          });
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        if (wp > 0.7) {
          ctx.fillStyle = `${theme.flashColor}${(wp - 0.7) / 0.3})`;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        }
      } else {
        const ap = Math.min(1, (t - WARP_END) / (DURATION - WARP_END));
        const ease = easeOutCubic(Math.min(1, ap * 1.15));
        const x = WIDTH * 0.1 + ease * WIDTH * 0.7;
        const y = HEIGHT * 0.5 - Math.sin(ap * Math.PI) * 50;
        const tilt = -0.2 + Math.sin(ap * Math.PI) * 0.1;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 60, y + 12);
        ctx.lineTo(x - 14, y + 3);
        ctx.stroke();
        ctx.restore();
        drawHeroShip(x, y, 1.1, tilt, 16, accent);

        ctx.textAlign = "center";
        ctx.fillStyle = theme.bannerColor;
        ctx.font = "bold 13px 'JetBrains Mono', 'Courier New', monospace";
        ctx.shadowColor = theme.bannerGlow;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = Math.min(1, ap * 3) * (1 - Math.max(0, ap - 0.8) / 0.2);
        ctx.fillText(theme.bannerText, WIDTH / 2, 50);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        if (t > DURATION - 45) {
          const fadeAlpha = Math.min(1, (t - (DURATION - 45)) / 45);
          ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        }
      }

      // cinematic letterbox bars, consistent with the opening cutscene
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WIDTH, 30);
      ctx.fillRect(0, HEIGHT - 30, WIDTH, 30);

      if (t >= DURATION) {
        setStatus("start");
        return;
      }
      raf = requestAnimationFrame(draw);
      } catch (e) {
        console.error("Travel cutscene frame error, recovering:", e);
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [status, shipConfig.color, selectedWorld]);

  // Black hole sequence — triggered by flying into the Outworld's
  // background black hole. Pull-in, a hallucinated destruction of the
  // homeworld, the pilot's terrified face, an asteroid breaking through
  // the illusion, then a CONNECTION LOST static screen before handing
  // off to the MISSION FAILED overlay (rendered as normal HTML/JSX).
  useEffect(() => {
    if (status !== "blackhole") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const bh = blackholeRef.current;
    bh.t = 0;
    if (!bh.embers) {
      bh.embers = Array.from({ length: 40 }, () => ({
        ang: rand(0, Math.PI * 2),
        dist: rand(10, 300),
        speed: rand(0.6, 2.2),
        size: rand(1, 3),
      }));
    }

    const PULLIN_END = 90;
    const HALLUCINATION_END = PULLIN_END + 280;
    const FACE_END = HALLUCINATION_END + 130;
    const IMPACT_END = FACE_END + 70;
    const STATIC_END = IMPACT_END + 180;

    let raf;
    let noiseData = null;

    const drawFace = (fear) => {
      // simple anime-style terrified portrait: big eyes, raised brows,
      // open mouth, a sweat drop, warm rim-light from the fire behind him
      const cx = WIDTH / 2;
      const cy = HEIGHT / 2 - 10;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = fear;

      // hair (back)
      ctx.beginPath();
      ctx.ellipse(0, -12, 62, 66, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#2a2118";
      ctx.fill();

      // face
      ctx.beginPath();
      ctx.ellipse(0, 0, 50, 58, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#e6bd93";
      ctx.fill();

      // warm rim light from the burning planet behind him
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      const rim = ctx.createLinearGradient(-50, -58, 50, 58);
      rim.addColorStop(0, "rgba(255,140,50,0.5)");
      rim.addColorStop(0.35, "rgba(255,140,50,0)");
      rim.addColorStop(1, "rgba(255,140,50,0)");
      ctx.fillStyle = rim;
      ctx.fillRect(-60, -70, 120, 140);
      ctx.restore();

      // hair (front fringe)
      ctx.beginPath();
      ctx.moveTo(-52, -20);
      ctx.quadraticCurveTo(-10, -60, 30, -46);
      ctx.quadraticCurveTo(48, -40, 52, -10);
      ctx.quadraticCurveTo(20, -32, -5, -30);
      ctx.quadraticCurveTo(-30, -28, -52, -20);
      ctx.closePath();
      ctx.fillStyle = "#2a2118";
      ctx.fill();

      // eyebrows — raised in fear
      ctx.strokeStyle = "#2a2118";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-32, -22);
      ctx.lineTo(-10, -28);
      ctx.moveTo(10, -28);
      ctx.lineTo(32, -22);
      ctx.stroke();

      // wide terrified eyes
      [-20, 20].forEach((ex) => {
        ctx.beginPath();
        ctx.ellipse(ex, -6, 13, 15, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#1a1410";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, -4, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#3a2410";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex - 2, -6, 2, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      });

      // open, gasping mouth
      ctx.beginPath();
      ctx.ellipse(0, 26, 9, 13, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3a1410";
      ctx.fill();

      // sweat drop
      ctx.beginPath();
      ctx.moveTo(40, -18);
      ctx.quadraticCurveTo(46, -6, 40, 2);
      ctx.quadraticCurveTo(34, -6, 40, -18);
      ctx.fillStyle = "rgba(190,225,255,0.85)";
      ctx.fill();

      ctx.restore();
    };

    const draw = () => {
      try {
      bh.t++;
      const t = bh.t;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      if (t < PULLIN_END) {
        // ---------- pull-in ----------
        const p = t / PULLIN_END;
        const zoom = 1 + p * 2.2;
        ctx.save();
        ctx.translate(WIDTH / 2, HEIGHT / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-WIDTH / 2, -HEIGHT / 2);

        bgRef.current.stars.forEach((st) => {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        const glow = ctx.createRadialGradient(
          WIDTH / 2,
          HEIGHT / 2,
          10,
          WIDTH / 2,
          HEIGHT / 2,
          180 + p * 300
        );
        glow.addColorStop(0, "rgba(160,32,240,0.5)");
        glow.addColorStop(0.4, "rgba(120,20,200,0.2)");
        glow.addColorStop(1, "rgba(120,20,200,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.beginPath();
        ctx.arc(WIDTH / 2, HEIGHT / 2, 40 + p * 20, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = `rgba(0,0,0,${p * p})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      } else if (t < HALLUCINATION_END) {
        // ---------- hallucination: homeworld being destroyed ----------
        const local = t - PULLIN_END;
        const total = HALLUCINATION_END - PULLIN_END;
        const p = local / total;
        const fadeIn = Math.min(1, local / 30);

        if (!bh.cityLights) {
          bh.cityLights = Array.from({ length: 16 }, () => {
            const ang = rand(0, Math.PI * 2);
            const dist = rand(0, 0.85);
            return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist * 0.6, phase: rand(0, Math.PI * 2) };
          });
        }

        const skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
        skyGrad.addColorStop(0, "#1a0a08");
        skyGrad.addColorStop(1, "#3a1206");
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.save();
        ctx.globalAlpha = fadeIn;
        ctx.translate(WIDTH / 2, HEIGHT / 2 - 20);
        const planetR = 150 + p * 60;

        // thin Earth-like atmosphere haze, still visible early on — this
        // is a living world, not just a rock — then burns away
        const atmoAlpha = Math.max(0, 0.55 - p * 0.9);
        if (atmoAlpha > 0) {
          ctx.beginPath();
          ctx.arc(0, 0, planetR + 6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(140,200,255,${atmoAlpha})`;
          ctx.lineWidth = 5;
          ctx.stroke();
        }

        const pg = ctx.createRadialGradient(-40, -40, 20, 0, 0, planetR);
        pg.addColorStop(0, "#8a5a3a");
        pg.addColorStop(0.5, "#5a2e18");
        pg.addColorStop(1, "#2a1208");
        ctx.beginPath();
        ctx.arc(0, 0, planetR, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();

        // scattered city lights — proof someone lives there — flickering
        // out (and turning red) as the destruction spreads
        bh.cityLights.forEach((c) => {
          const lx = c.x * planetR;
          const ly = c.y * planetR;
          const alive = Math.random() > p * 1.1;
          const twinkle = 0.6 + 0.4 * Math.sin(t * 0.2 + c.phase);
          ctx.beginPath();
          ctx.arc(lx, ly, alive ? 2 : 2.4, 0, Math.PI * 2);
          ctx.fillStyle = alive ? `rgba(255,235,180,${0.7 * twinkle})` : "rgba(255,60,30,0.8)";
          ctx.shadowColor = alive ? "#ffe6a0" : "#ff3a1a";
          ctx.shadowBlur = alive ? 4 : 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        // spreading cracks, more as time passes
        const crackCount = Math.floor(3 + p * 9);
        ctx.strokeStyle = "rgba(255,140,40,0.9)";
        ctx.lineWidth = 2;
        for (let i = 0; i < crackCount; i++) {
          const ang = (i / crackCount) * Math.PI * 2 + i * 0.7;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          let x = 0,
            y = 0,
            a = ang;
          for (let seg = 0; seg < 4; seg++) {
            a += rand(-0.3, 0.3);
            x += Math.cos(a) * (planetR / 4);
            y += Math.sin(a) * (planetR / 4);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // explosion blooms erupting from the surface
        if (p > 0.3) {
          for (let i = 0; i < 3; i++) {
            const ang = rand(0, Math.PI * 2);
            const ex = Math.cos(ang) * planetR * rand(0.6, 1);
            const ey = Math.sin(ang) * planetR * rand(0.6, 1);
            const eg = ctx.createRadialGradient(ex, ey, 2, ex, ey, 30 + p * 20);
            eg.addColorStop(0, "rgba(255,220,150,0.9)");
            eg.addColorStop(0.5, "rgba(255,120,40,0.5)");
            eg.addColorStop(1, "rgba(255,80,20,0)");
            ctx.fillStyle = eg;
            ctx.beginPath();
            ctx.arc(ex, ey, 30 + p * 20, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();

        // "HOMEWORLD" caption, echoing the opening cutscene so it's
        // unmistakable which world this is
        const capAlpha = local < 90 ? Math.min(1, local / 20) * (1 - Math.max(0, local - 60) / 30) : 0;
        if (capAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = capAlpha;
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffe0c0";
          ctx.font = "italic bold 16px 'Orbitron', 'JetBrains Mono', monospace";
          ctx.shadowColor = "#ff8040";
          ctx.shadowBlur = 10;
          ctx.fillText("HOMEWORLD", WIDTH / 2, 60);
          ctx.shadowBlur = 0;
          ctx.restore();
        }

        // drifting embers
        bh.embers.forEach((e) => {
          e.dist += e.speed;
          if (e.dist > 340) e.dist = 0;
          const ex = WIDTH / 2 + Math.cos(e.ang) * e.dist;
          const ey = HEIGHT / 2 + Math.sin(e.ang) * e.dist * 0.7;
          ctx.globalAlpha = fadeIn * 0.7;
          ctx.fillStyle = "#ffb454";
          ctx.beginPath();
          ctx.arc(ex, ey, e.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      } else if (t < FACE_END) {
        // ---------- the pilot's face ----------
        const local = t - HALLUCINATION_END;
        const total = FACE_END - HALLUCINATION_END;
        const fear = Math.min(1, local / 25);

        const bgGrad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 20, WIDTH / 2, HEIGHT / 2, 400);
        bgGrad.addColorStop(0, "#2a0f08");
        bgGrad.addColorStop(1, "#0a0402");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        drawFace(fear);

        ctx.textAlign = "center";
        ctx.globalAlpha = Math.max(0, Math.min(1, (local - 60) / 30));
        ctx.fillStyle = "#ffb0a0";
        ctx.font = "italic 12px 'JetBrains Mono', monospace";
        ctx.fillText("This isn't real...", WIDTH / 2, HEIGHT - 90);
        ctx.globalAlpha = 1;
      } else if (t < IMPACT_END) {
        // ---------- an asteroid breaks through the illusion ----------
        const local = t - FACE_END;
        const total = IMPACT_END - FACE_END;
        const p = local / total;

        const bgGrad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 20, WIDTH / 2, HEIGHT / 2, 400);
        bgGrad.addColorStop(0, "#2a0f08");
        bgGrad.addColorStop(1, "#0a0402");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        drawFace(1);

        // glitch cracks tearing across the illusion
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          const gy = rand(0, HEIGHT);
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(WIDTH, gy + rand(-20, 20));
          ctx.stroke();
        }

        // the comet rushing straight at the viewer
        const scale = 0.05 + p * p * 3;
        ctx.save();
        ctx.translate(WIDTH * 0.5, HEIGHT * 0.42);
        ctx.scale(scale, scale);
        const cg = ctx.createRadialGradient(0, 0, 5, 0, 0, 60);
        cg.addColorStop(0, "#fff6d8");
        cg.addColorStop(0.4, "#ff5a1e");
        cg.addColorStop(1, "#5a1408");
        ctx.beginPath();
        ctx.arc(0, 0, 60, 0, Math.PI * 2);
        ctx.fillStyle = cg;
        ctx.shadowColor = "#ff7a2e";
        ctx.shadowBlur = 40;
        ctx.fill();
        ctx.restore();

        if (p > 0.82) {
          ctx.fillStyle = `rgba(255,230,210,${(p - 0.82) / 0.18})`;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        }
      } else if (t < STATIC_END) {
        // ---------- CONNECTION LOST ----------
        const local = t - IMPACT_END;
        if (!noiseData) noiseData = ctx.createImageData(WIDTH, HEIGHT);
        if (t % 2 === 0) {
          const buf = noiseData.data;
          for (let i = 0; i < buf.length; i += 4) {
            const v = Math.random() * 255;
            buf[i] = v;
            buf[i + 1] = v;
            buf[i + 2] = v;
            buf[i + 3] = 255;
          }
        }
        ctx.putImageData(noiseData, 0, 0);

        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        for (let y = 0; y < HEIGHT; y += 3) {
          ctx.fillStyle = "rgba(0,0,0,0.15)";
          ctx.fillRect(0, y, WIDTH, 1);
        }

        // monitor bezel
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 18;
        ctx.strokeRect(9, 9, WIDTH - 18, HEIGHT - 18);

        if (Math.floor(local / 10) % 3 !== 0) {
          ctx.textAlign = "center";
          ctx.fillStyle = "#ff4040";
          ctx.font = "bold 26px 'JetBrains Mono', monospace";
          ctx.shadowColor = "#ff4040";
          ctx.shadowBlur = 14;
          ctx.fillText("CONNECTION LOST", WIDTH / 2, HEIGHT / 2);
          ctx.shadowBlur = 0;
          ctx.font = "11px 'JetBrains Mono', monospace";
          ctx.fillStyle = "#ff8080";
          ctx.fillText("SIGNAL FROM OUTWORLD UNIT — NO RESPONSE", WIDTH / 2, HEIGHT / 2 + 26);
        }
      } else {
        // held on the static screen while the MISSION FAILED overlay
        // (real HTML, for working buttons) takes over
        if (!blackholeFailed) setBlackholeFailed(true);
      }

      if (t < STATIC_END) {
        raf = requestAnimationFrame(draw);
      }
      } catch (e) {
        console.error("Black hole sequence frame error, recovering:", e);
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // Homecoming — plays after the Wormhole's mothership is defeated. The
  // ship descends and lands back on the homeworld, the same figures from
  // the opening cutscene now cheering instead of waving goodbye, before
  // handing off to the MISSION ACCOMPLISHED win screen.
  useEffect(() => {
    if (status !== "homecoming") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const hc = { t: 0, figures: null, confetti: null };
    if (!hc.figures) {
      hc.figures = Array.from({ length: 6 }, (_, i) => ({
        x: WIDTH * 0.3 + i * 24 + rand(-4, 4),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.12, 0.2),
      }));
    }
    if (!hc.confetti) {
      hc.confetti = Array.from({ length: 60 }, () => ({
        x: rand(0, WIDTH),
        y: rand(-HEIGHT, 0),
        speed: rand(1.5, 3.5),
        drift: rand(-0.6, 0.6),
        color: [COLORS.amber, COLORS.cyan, COLORS.green, COLORS.violet, COLORS.white][Math.floor(rand(0, 5))],
        size: rand(2, 4),
      }));
    }

    const DESCENT_END = 150;
    const LANDING_END = 210;
    const DURATION = 480;
    let raf;
    let accent = shipConfig.color || COLORS.amber;

    const drawCelebrateFigure = (x, groundY, t, phase) => {
      const jump = Math.max(0, Math.sin(t * 0.15 + phase)) * 6;
      ctx.save();
      ctx.translate(x, groundY - jump);
      ctx.strokeStyle = "#1a1425";
      ctx.fillStyle = "#1a1425";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -18, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 2);
      ctx.moveTo(0, 2);
      ctx.lineTo(-4, 13);
      ctx.moveTo(0, 2);
      ctx.lineTo(4, 13);
      // both arms raised in celebration
      ctx.moveTo(0, -11);
      ctx.lineTo(-9, -22);
      ctx.moveTo(0, -11);
      ctx.lineTo(9, -22);
      ctx.stroke();
      ctx.restore();
    };

    const drawHeroShip = (x, y, scale, tilt, flame) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(scale, scale);
      if (flame > 0) {
        const fg = ctx.createLinearGradient(0, 16, 0, 16 + flame);
        fg.addColorStop(0, "rgba(255,255,255,0.95)");
        fg.addColorStop(0.4, accent);
        fg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(0, 16 + flame / 2, 5, flame / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(9, -8);
      ctx.lineTo(22, 8);
      ctx.lineTo(11, 12);
      ctx.lineTo(9, 22);
      ctx.lineTo(0, 17);
      ctx.lineTo(-9, 22);
      ctx.lineTo(-11, 12);
      ctx.lineTo(-22, 8);
      ctx.lineTo(-9, -8);
      ctx.closePath();
      ctx.fillStyle = "#2b2e33";
      ctx.fill();
      ctx.strokeStyle = "#0a0a0c";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(4, -6);
      ctx.lineTo(0, 4);
      ctx.lineTo(-4, -6);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.restore();
    };

    const draw = () => {
      try {
      hc.t++;
      const t = hc.t;
      const groundY = HEIGHT * 0.66;
      if (shipConfig.color === "rainbow") accent = `hsl(${(t * 2) % 360},85%,62%)`;

      let phase;
      if (t < DESCENT_END) phase = "descent";
      else if (t < LANDING_END) phase = "landing";
      else phase = "celebrate";

      const skyP = Math.min(1, t / DESCENT_END);
      const sky = skyColorsAt(1 - skyP * 0.85);
      const skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      skyGrad.addColorStop(0, sky.top);
      skyGrad.addColorStop(1, sky.bottom);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      if (skyP < 1) {
        bgRef.current.stars.forEach((st) => {
          ctx.globalAlpha = (1 - skyP) * st.baseAlpha;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      // mountains + ground
      ctx.fillStyle = "#3a2f4d";
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      for (let x = 0; x <= WIDTH; x += 40) {
        ctx.lineTo(x, groundY - 20 - 34 * Math.abs(Math.sin(x * 0.01 + 2)));
      }
      ctx.lineTo(WIDTH, groundY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#241a34";
      ctx.fillRect(0, groundY, WIDTH, HEIGHT - groundY);

      const padX = WIDTH * 0.58;
      const padGrad = ctx.createRadialGradient(padX, groundY, 4, padX, groundY, 80);
      padGrad.addColorStop(0, "rgba(255,220,160,0.4)");
      padGrad.addColorStop(1, "rgba(255,220,160,0)");
      ctx.fillStyle = padGrad;
      ctx.beginPath();
      ctx.arc(padX, groundY, 80, 0, Math.PI * 2);
      ctx.fill();

      if (phase === "descent") {
        const ease = easeOutCubic(t / DESCENT_END);
        const x = padX + (1 - ease) * -40;
        const y = HEIGHT * 0.1 + ease * (groundY - 20 - HEIGHT * 0.1);
        const scale = 0.3 + ease * 0.55;
        drawHeroShip(x, y, scale, 0.08 - ease * 0.08, 12 + Math.sin(t * 0.4) * 4);
      } else {
        drawHeroShip(padX, groundY - 20, 0.85, 0, phase === "landing" ? 5 : 3);

        if (phase === "celebrate") {
          const cheerAlpha = Math.min(1, (t - LANDING_END) / 30);
          ctx.globalAlpha = cheerAlpha;
          hc.figures.forEach((f) => drawCelebrateFigure(f.x, groundY + 4, t, f.phase));
          ctx.globalAlpha = 1;

          hc.confetti.forEach((c) => {
            c.y += c.speed;
            c.x += c.drift;
            if (c.y > HEIGHT) {
              c.y = -10;
              c.x = rand(0, WIDTH);
            }
            ctx.globalAlpha = cheerAlpha * 0.9;
            ctx.fillStyle = c.color;
            ctx.fillRect(c.x, c.y, c.size, c.size);
          });
          ctx.globalAlpha = 1;

          ctx.textAlign = "center";
          ctx.fillStyle = COLORS.amber;
          ctx.font = "italic 14px 'JetBrains Mono', monospace";
          ctx.globalAlpha = Math.min(1, (t - LANDING_END - 20) / 30);
          ctx.fillText("Welcome home.", WIDTH / 2, 70);
          ctx.globalAlpha = 1;
        }
      }

      if (t > DURATION - 45) {
        const fadeAlpha = Math.min(1, (t - (DURATION - 45)) / 45);
        ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WIDTH, 30);
      ctx.fillRect(0, HEIGHT - 30, WIDTH, 30);

      if (t >= DURATION) {
        setStatus("won");
        return;
      }
      raf = requestAnimationFrame(draw);
      } catch (e) {
        console.error("Homecoming sequence frame error, recovering:", e);
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [status, shipConfig.color]);

  // Main loop
  useEffect(() => {
    if (status !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const loop = () => {
      const s = stateRef.current;

      // ---------- pause ----------
      // Frozen solid: no state mutation, no timers, no rendering — the
      // last drawn frame just sits there behind the pause overlay.
      if (pausedRef.current) {
        stopBananaLoop();
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      s.t++;

      // ---------- death explosion sequence ----------
      // Once triggered, this branch owns the frame: gameplay is frozen and
      // we just play out a dramatic explosion at the point of death before
      // handing off to the game-over screen.
      if (s.deathSequence) {
        const ds = s.deathSequence;
        ds.timer--;

        if (ds.timer % 6 === 0 && ds.timer > 0) {
          for (let i = 0; i < 14; i++) {
            const ang = rand(0, Math.PI * 2);
            const dist = rand(0, 26);
            s.particles.push({
              x: ds.x + Math.cos(ang) * dist,
              y: ds.y + Math.sin(ang) * dist,
              vx: Math.cos(ang) * rand(2, 7),
              vy: Math.sin(ang) * rand(2, 7),
              life: rand(24, 42),
              c: [COLORS.red, COLORS.amber, COLORS.white][Math.floor(rand(0, 3))],
            });
          }
          s.shakeT = 14;
          if (ds.timer % 18 === 0) sfx.explosion(false);
        }

        s.particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life--;
        });
        s.particles = s.particles.filter((p) => p.life > 0);
        s.stars.forEach((st) => {
          st.y += st.speed;
          if (st.y > HEIGHT + 2) {
            st.y = -2;
            st.x = rand(0, WIDTH);
          }
        });
        if (s.shakeT > 0) s.shakeT--;

        const shakeX = s.shakeT > 0 ? rand(-5, 5) : 0;
        const shakeY = s.shakeT > 0 ? rand(-5, 5) : 0;

        ctx.save();
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        s.nebulae.forEach((n) => {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
          g.addColorStop(0, n.c1);
          g.addColorStop(1, n.c2);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        });
        s.stars.forEach((st) => {
          const twinkle = 0.5 + 0.5 * Math.sin(s.t * 0.04 + st.phase);
          ctx.globalAlpha = st.baseAlpha * (0.5 + 0.5 * twinkle);
          ctx.fillStyle = COLORS.white;
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        ctx.translate(shakeX, shakeY);

        // expanding shockwave ring
        const elapsed = 70 - ds.timer;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 40);
        ctx.strokeStyle = COLORS.amber;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ds.x, ds.y, elapsed * 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        s.particles.forEach((p) => {
          ctx.globalAlpha = Math.max(0, p.life / 42);
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        ctx.restore();

        if (ds.timer <= 0) {
          setBest((b) => { const next = Math.max(b, s.score); if (next !== b) saveBestScore(next); return next; });
          setDeathCause(ds.cause);
          flushRunStats(s, { died: true });
          setStatus("gameover");
          clearCheckpoint();
          setSavedCheckpoint(null);
          return;
        }

        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // --- input ---
      const k = keysRef.current;
      let ax = 0,
        ay = 0;
      if (k["arrowleft"] || k["a"]) ax -= 1;
      if (k["arrowright"] || k["d"]) ax += 1;
      if (k["arrowup"] || k["w"]) ay -= 1;
      if (k["arrowdown"] || k["s"]) ay += 1;

      if (touchRef.current.active) {
        const dx = touchRef.current.x - s.player.x;
        const dy = touchRef.current.y - s.player.y;
        const d = Math.hypot(dx, dy);
        if (d > 4) {
          ax = dx / d;
          ay = dy / d;
        }
      }

      if (s.player.frozen > 0) {
        ax = 0;
        ay = 0;
        s.player.frozen--;
      }

      const mag = Math.hypot(ax, ay) || 1;
      const slowFactor = s.player.slowed > 0 ? 0.32 : 1;
      const spd = PLAYER_SPEED * s.player.speedMult * slowFactor;
      s.player.vx = (ax / mag) * spd;
      s.player.vy = (ay / mag) * spd;
      s.player.x = Math.min(WIDTH - PLAYER_SIZE, Math.max(PLAYER_SIZE, s.player.x + s.player.vx));
      s.player.y = Math.min(HEIGHT - PLAYER_SIZE, Math.max(PLAYER_SIZE, s.player.y + s.player.vy));
      if (s.player.slowed === 1) s.runStats.survivedThrusterFailure = true;
      if (s.player.slowed > 0) s.player.slowed--;
      if (s.player.transformed && s.player.moveCooldowns) {
        for (const k in s.player.moveCooldowns) {
          if (s.player.moveCooldowns[k] > 0) s.player.moveCooldowns[k]--;
        }
      }

      // engine trail — a fading particle stream behind the ship, if equipped
      if (s.player.trail && s.player.trail !== "none" && s.t % (s.reduceEffects ? 5 : 2) === 0) {
        const trailDef = SHOP_TRAILS.find((tr) => tr.id === s.player.trail);
        if (trailDef) {
          s.particles.push({
            x: s.player.x + rand(-2, 2),
            y: s.player.y + 14 + rand(-2, 2),
            vx: -s.player.vx * 0.15 + rand(-0.3, 0.3),
            vy: -s.player.vy * 0.15 + rand(0.3, 1),
            life: 20,
            c: trailDef.hex,
          });
        }
      }

      // auto-fire (spread / cooldown / bullet speed all scale with power-ups)
      s.player.cool--;
      if (s.player.cool <= 0) {
        s.player.cool = s.player.cooldown;
        if (s.player.disarmed <= 0) {
          const n = s.player.spread;
          const spacing = 9;
          const bulletType = s.player.bullet || "standard";
          const isBanana = bulletType === "bl_banana";
          for (let i = 0; i < n; i++) {
            const offset = (i - (n - 1) / 2) * spacing;
            s.bullets.push({
              x: s.player.x + offset,
              y: s.player.y - 18,
              speed: BULLET_SPEED * s.player.bulletSpeedMult,
              pierce: s.player.pierce,
              type: bulletType,
              ...(isBanana
                ? {
                    vx: 0,
                    vy: -BULLET_SPEED * s.player.bulletSpeedMult,
                    bananaT: 0,
                    bananaSide: i % 2 === 0 ? 1 : -1,
                  }
                : {}),
            });
          }
          const droneCount = s.player.drones || 0;
          if (droneCount > 0) {
            const droneOffsets = droneCount === 1 ? [22] : [-22, 22];
            droneOffsets.forEach((dx, i) => {
              s.bullets.push({
                x: s.player.x + dx,
                y: s.player.y - 6,
                speed: BULLET_SPEED * s.player.bulletSpeedMult,
                pierce: s.player.pierce,
                drone: true,
                type: bulletType,
                ...(isBanana
                  ? {
                      vx: 0,
                      vy: -BULLET_SPEED * s.player.bulletSpeedMult,
                      bananaT: 0,
                      bananaSide: i % 2 === 0 ? 1 : -1,
                    }
                  : {}),
              });
            });
          }
        }
      }
      if (s.player.disarmed > 0) s.player.disarmed--;
      setBananaLoopActive(s.player.bullet === "bl_banana" && s.player.disarmed <= 0 && s.lives > 0);
      if (
        s.player.color === "#ff8c1a" &&
        s.player.trail === "tr_orange" &&
        s.player.bullet === "bl_fire" &&
        s.runStats
      ) {
        s.runStats.foundOrangeCombo = true;
      }

      // periodic system faults — every ~15 seconds during play (scaled by difficulty)
      s.degradeTimer--;
      if (s.degradeTimer <= 0) {
        rollDegrade(s);
        s.degradeTimer = DEGRADE_INTERVAL * (DIFFICULTIES[s.difficulty] || DIFFICULTIES.normal).degradeMult;
      }

      // bullets
      s.bullets.forEach((b) => {
        if (b.vx !== undefined || b.vy !== undefined) {
          b.x += b.vx || 0;
          b.y += b.vy || 0;
        } else {
          b.y -= b.speed || BULLET_SPEED;
          if (b.vxOverride) b.x += b.vxOverride;
        }
        b.justSpawned = false;

        // banana bullets boomerang — fly straight briefly, then arc back
        // toward wherever the ship currently is, if they haven't hit
        // anything yet. Vanishes quietly once it "returns to hand."
        if (b.type === "bl_banana") {
          b.bananaT = (b.bananaT || 0) + 1;
          if (b.bananaT > 35) {
            const spd = Math.hypot(b.vx || 0, b.vy || -BULLET_SPEED) || 4;
            const dx = s.player.x - b.x;
            const dy = s.player.y - b.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist < 22) {
              b.dead = true;
            } else {
              const desiredVx = (dx / dist) * spd;
              const desiredVy = (dy / dist) * spd;
              const turnStrength = 0.1;
              let nvx = (b.vx || 0) + (desiredVx - (b.vx || 0)) * turnStrength;
              let nvy = (b.vy || -BULLET_SPEED) + (desiredVy - (b.vy || -BULLET_SPEED)) * turnStrength;
              const curSpd = Math.hypot(nvx, nvy) || spd;
              b.vx = (nvx / curSpd) * spd;
              b.vy = (nvy / curSpd) * spd;
            }
          }
        }
      });
      s.bullets = s.bullets.filter((b) => b.y > -20 && b.y < HEIGHT + 40 && b.x > -20 && b.x < WIDTH + 20);

      // black hole bullets gently pull nearby rocks toward their path
      s.bullets.forEach((b) => {
        if (b.type !== "bl_blackhole") return;
        s.rocks.forEach((r) => {
          const dx = b.x - r.x;
          const dy = b.y - r.y;
          const d = Math.hypot(dx, dy);
          if (d < 55 && d > 1) {
            r.vx += (dx / d) * 0.06;
          }
        });
      });

      // wave progression — every completed wave grants a random power-up.
      // Suppressed mid-boss-fight and during the win finale so boss-hit
      // score bumps don't skip waves or fire a stray banner after wave 25.
      const wave = 1 + Math.floor(s.score / 300);
      if (wave > s.wave && !s.bossActive && !s.finale) {
        s.wave = wave;
        grantPowerUp(s, `WAVE ${s.wave} CLEARED`);
      }

      // trigger a boss encounter every BOSS_WAVE_INTERVAL waves; wave 25 is
      // the mega boss instead of a regular one
      if (!s.bossActive && !s.finale && wave % BOSS_WAVE_INTERVAL === 0 && s.lastBossWave !== wave) {
        s.lastBossWave = wave;
        s.wave = wave;
        s.bossActive = true;
        if (wave === MEGA_WAVE) {
          spawnBoss(s, s.bossIndex, "mega", s.world);
        } else {
          spawnBoss(s, s.bossIndex, "normal", s.world);
          s.bossIndex++;
        }
      }

      // spawn rocks — paused during boss encounters and the win finale
      if (!s.bossActive && !s.finale) {
        s.spawnTimer--;
        if (s.spawnTimer <= 0) {
          const speed = rand(2 + wave * 0.25, 3.6 + wave * 0.35);
          const size = rand(14, 30);
          const rockStyle = (WORLDS[s.world] || WORLDS.homeworld).rockStyle;
          const geo =
            rockStyle === "crystal"
              ? makeCrystalGeometry(size)
              : rockStyle === "comet"
              ? makeCometGeometry(size)
              : rockStyle === "star"
              ? makeStarGeometry(size)
              : makeRockGeometry(size);
          s.rocks.push({
            x: rand(size, WIDTH - size),
            y: -size,
            vx: rand(-0.6, 0.6),
            vy: speed,
            size,
            hp: size > 24 ? 2 : 1,
            spin: rand(-0.045, 0.045),
            a: rand(0, Math.PI * 2),
            style: rockStyle,
            color: WORMHOLE_STAR_COLORS[Math.floor(rand(0, WORMHOLE_STAR_COLORS.length))],
            outline: geo.outline,
            craters: geo.craters,
            facets: geo.facets,
            hotspots: geo.hotspots,
          });
          s.spawnTimer = Math.max(14, 46 - wave * 2) * ((DIFFICULTIES[s.difficulty] || DIFFICULTIES.normal).spawnMult);
        }
      }

      // move rocks
      s.rocks.forEach((r) => {
        r.x += r.vx;
        r.y += r.vy;
        r.a += r.spin;
      });
      s.rocks = s.rocks.filter((r) => r.y < HEIGHT + 40);

      // ---------- boss update ----------
      if (s.bossActive && s.boss) {
        const boss = s.boss;
        const enraged = boss.tier === "mega" && boss.hp < boss.maxHp * 0.4;
        const factor = boss.speedFactor * (enraged ? 0.72 : 1);
        const scaled = (frames) => Math.max(6, Math.round(frames * factor));

        if (boss.state === "entrance") {
          const elapsed = boss.entranceFrames - boss.stateTimer;
          const progress = Math.min(1, elapsed / boss.entranceFrames);
          boss.y = boss.startY + (boss.targetY - boss.startY) * easeOutCubic(progress);
          boss.revealAlpha = progress;
          boss.stateTimer--;
          if (boss.stateTimer <= 0) {
            boss.y = boss.targetY;
            boss.revealAlpha = 1;
            boss.state = "idle";
            boss.stateTimer = scaled(70);
            if (boss.tier === "mega") sfx.megaReveal();
          }
        } else if (boss.state === "idle") {
          boss.x = WIDTH / 2 + Math.sin(s.t * (boss.tier === "mega" ? 0.024 : 0.018)) * 150;
          boss.stateTimer--;
          if (boss.stateTimer <= 0) {
            boss.moveCursor = (boss.moveCursor + 1) % boss.moves.length;
            boss.moveType = boss.moves[boss.moveCursor];
            boss.fired = false;
            boss.laserX = boss.x;
            boss.state = "telegraph";
            boss.stateTimer = scaled(boss.moveType === "laser" ? 45 : 22);
          }
        } else if (boss.state === "telegraph") {
          boss.stateTimer--;
          if (boss.moveType === "laser") boss.laserX = boss.x; // lock aim point
          if (boss.stateTimer <= 0) {
            boss.state = "firing";
            boss.stateTimer = scaled(boss.moveType === "laser" ? 24 : 12);
          }
        } else if (boss.state === "firing") {
          if (!boss.fired) {
            boss.fired = true;
            sfx.bossMove(boss.moveType);
            const speedBoost = boss.tier === "mega" ? 1.35 : 1;
            if (boss.moveType === "spread") {
              const count = boss.tier === "mega" ? 9 : 7;
              for (let i = 0; i < count; i++) {
                const ang = -0.95 + (i / (count - 1)) * 1.9;
                s.bossBullets.push({
                  x: boss.x,
                  y: boss.y + 26,
                  vx: Math.sin(ang) * 3.6 * speedBoost,
                  vy: Math.cos(ang) * 3.6 * speedBoost,
                  r: 4.5,
                  kind: "bolt",
                });
              }
            } else if (boss.moveType === "aimed") {
              const dx = s.player.x - boss.x;
              const dy = s.player.y - boss.y;
              const baseAng = Math.atan2(dx, dy);
              const offsets = boss.tier === "mega" ? [-0.24, -0.08, 0.08, 0.24] : [-0.16, 0, 0.16];
              offsets.forEach((off) => {
                const ang = baseAng + off;
                s.bossBullets.push({
                  x: boss.x,
                  y: boss.y + 26,
                  vx: Math.sin(ang) * 5.4 * speedBoost,
                  vy: Math.cos(ang) * 5.4 * speedBoost,
                  r: 4.5,
                  kind: "seeker",
                });
              });
            } else if (boss.moveType === "burst") {
              // mega-only: a full radial ring — the "special ability"
              const count = 18;
              for (let i = 0; i < count; i++) {
                const ang = (i / count) * Math.PI * 2;
                s.bossBullets.push({
                  x: boss.x,
                  y: boss.y,
                  vx: Math.sin(ang) * 3.1,
                  vy: Math.cos(ang) * 3.1,
                  r: 4,
                  kind: "ring",
                });
              }
            } else if (boss.moveType === "homing") {
              // Frontier mega-only: slow-tracking bolts that steer toward
              // the player every frame — the more advanced enemy tech
              const count = 3;
              for (let i = 0; i < count; i++) {
                const ang = -0.3 + i * 0.3;
                s.bossBullets.push({
                  x: boss.x + (i - 1) * 16,
                  y: boss.y + 22,
                  vx: Math.sin(ang) * 2.6,
                  vy: Math.cos(ang) * 2.6,
                  r: 5,
                  kind: "homing",
                  homing: true,
                });
              }
            } else if (boss.moveType === "bombardment") {
              // Mothership-only: telegraphed impact zones — a growing
              // warning ring, then a brief damaging flash. Dodge the
              // zones instead of dodging projectiles.
              const count = 4;
              for (let i = 0; i < count; i++) {
                s.bossBullets.push({
                  x: rand(50, WIDTH - 50),
                  y: rand(HEIGHT * 0.42, HEIGHT * 0.82),
                  vx: 0,
                  vy: 0,
                  r: 8,
                  kind: "zone",
                  telegraph: 55,
                  maxR: 36,
                  activeFrames: 0,
                });
              }
              sfx.bossMove("burst");
            }
            // laser damage is resolved per-frame below while firing
          }
          if (boss.moveType === "laser") {
            const halfWidth = boss.tier === "mega" ? (boss.world === "wormhole" ? 40 : 28) : 20;
            if (Math.abs(s.player.x - boss.laserX) < halfWidth && s.player.y > boss.y) {
              damagePlayer(s, boss.tier === "mega" ? "Mega Boss: Sweeping Beam" : "Boss: Sweeping Beam");
            }
          }
          boss.stateTimer--;
          if (boss.stateTimer <= 0) {
            boss.state = "idle";
            boss.stateTimer = scaled(75);
          }
        }

        // boss bullets move + offscreen cull (homing bolts steer toward
        // the player a little each frame before moving)
        s.bossBullets.forEach((b) => {
          if (b.homing) {
            const dx = s.player.x - b.x;
            const dy = s.player.y - b.y;
            const d = Math.hypot(dx, dy) || 1;
            const turn = 0.09;
            b.vx += (dx / d) * turn;
            b.vy += (dy / d) * turn;
            const spd = Math.hypot(b.vx, b.vy);
            const maxSpd = 4.4;
            if (spd > maxSpd) {
              b.vx = (b.vx / spd) * maxSpd;
              b.vy = (b.vy / spd) * maxSpd;
            }
          }
        });
        s.bossBullets.forEach((b) => {
          b.x += b.vx;
          b.y += b.vy;
        });
        s.bossBullets = s.bossBullets.filter(
          (b) => b.kind === "zone" || (b.y > -20 && b.y < HEIGHT + 20 && b.x > -20 && b.x < WIDTH + 20)
        );

        // bombardment zones: grow through a telegraph warning, then a
        // brief damaging window, then despawn
        s.bossBullets.forEach((b) => {
          if (b.kind !== "zone") return;
          if (b.telegraph > 0) {
            b.telegraph--;
            const p = 1 - b.telegraph / 55;
            b.r = 8 + p * (b.maxR - 8);
            if (b.telegraph <= 0) b.activeFrames = 16;
          } else if (b.activeFrames > 0) {
            b.activeFrames--;
            b.r = b.maxR;
            if (Math.hypot(b.x - s.player.x, b.y - s.player.y) < b.r && s.player.hit <= 0) {
              damagePlayer(s, "Mothership: Bombardment");
            }
            if (b.activeFrames <= 0) b.dead = true;
          }
        });
        s.bossBullets = s.bossBullets.filter((b) => !b.dead);

        // boss bullets vs player (bombardment zones handled above instead)
        for (const b of s.bossBullets) {
          if (b.dead || b.kind === "zone") continue;
          const d = Math.hypot(b.x - s.player.x, b.y - s.player.y);
          if (d < b.r + 9) {
            b.dead = true;
            const causeMap = {
              seeker: boss.tier === "mega" ? "Mega Boss: Aimed Volley" : "Boss: Aimed Volley",
              ring: "Mega Boss: Radial Burst",
              bolt: boss.tier === "mega" ? "Mega Boss: Flak Barrage" : "Boss: Flak Barrage",
              homing: "Mega Boss: Homing Volley",
            };
            damagePlayer(s, causeMap[b.kind] || "Boss Fire");
          }
        }
        s.bossBullets = s.bossBullets.filter((b) => !b.dead);

        // player bullets vs boss (invulnerable during entrance)
        if (boss.state !== "entrance") {
          for (const b of s.bullets) {
            if (b.dead || b.justSpawned) continue;
            if (b.pierce && b.hitBoss) continue;
            const d = Math.hypot(boss.x - b.x, boss.y - b.y);
            const hitRadius = boss.tier === "mega" && boss.world === "wormhole" ? 60 : 34;
            if (d < hitRadius) {
              if (b.pierce) b.hitBoss = true;
              else b.dead = true;
              boss.hp -= bulletDamage(s, b);
              boss.flash = 6;
              s.score += 2;

              // splitting bullets spawn two smaller bullets on boss hits too
              if (b.type === "bl_split" && !b.isChild) {
                [-0.3, 0.3].forEach((off) => {
                  s.bullets.push({
                    x: b.x,
                    y: b.y,
                    vxOverride: Math.sin(off) * 2.4,
                    speed: (b.speed || BULLET_SPEED) * 0.85,
                    pierce: false,
                    type: "bl_split",
                    isChild: true,
                    small: true,
                    justSpawned: true,
                  });
                });
              }

              for (let i = 0; i < 3; i++) {
                s.particles.push({
                  x: b.x,
                  y: b.y,
                  vx: rand(-1.5, 1.5),
                  vy: rand(-1.5, 1.5),
                  life: 14,
                  c: COLORS.cyan,
                });
              }
              if (boss.hp <= 0) {
                if (!s.bossRush) {
                  s.runStats.bossesBeaten++;
                  if (!s.runStats.tookDamageThisBoss) s.runStats.flawlessBossWins++;
                }
                if (s.bossRush) {
                  // any boss defeat during Boss Rush ends the session —
                  // no trophy, no wave continuation, just a clean finish
                  s.finale = {
                    x: boss.x,
                    y: boss.y,
                    timer: 130,
                    total: 130,
                    tier: boss.tier,
                    world: boss.world,
                    bossRush: true,
                  };
                  s.rocks = [];
                  s.shakeT = 28;
                  sfx.explosion(boss.tier === "mega");
                } else if (boss.tier === "mega") {
                  // hand off to the explosion / win sequence instead of
                  // clearing immediately — no more asteroids from here on
                  const isMothershipKill = boss.world === "wormhole";
                  s.finale = {
                    x: boss.x,
                    y: boss.y,
                    timer: isMothershipKill ? 200 : 160,
                    total: isMothershipKill ? 200 : 160,
                    tier: "mega",
                    world: boss.world,
                  };
                  s.rocks = [];
                  s.shakeT = 30;
                  sfx.explosion(true);
                } else {
                  s.score += 300;
                  for (let i = 0; i < 30; i++) {
                    s.particles.push({
                      x: boss.x,
                      y: boss.y,
                      vx: rand(-6, 6),
                      vy: rand(-6, 6),
                      life: 34,
                      c: i % 2 === 0 ? COLORS.amber : COLORS.red,
                    });
                  }
                  s.shakeT = 26;
                  sfx.explosion(false);
                  grantPowerUp(s, "BOSS SIGNAL TERMINATED");
                }
                s.bossActive = false;
                s.boss = null;
                s.bossBullets = [];
                break;
              }
            }
          }
          s.bullets = s.bullets.filter((b) => !b.dead);
        }

        // boss contact damage (invulnerable while still materializing)
        const contactRadius = s.boss && s.boss.tier === "mega" && s.boss.world === "wormhole" ? 68 : 42;
        if (s.boss && s.boss.state !== "entrance" && Math.hypot(s.boss.x - s.player.x, s.boss.y - s.player.y) < contactRadius) {
          damagePlayer(
            s,
            s.boss.tier === "mega" ? (s.boss.world === "wormhole" ? "Mothership: Collision" : "Mega Boss: Collision") : "Boss: Collision"
          );
        }
        if (s.boss && s.boss.flash > 0) s.boss.flash--;
      }

      // ---------- mega boss explosion / win finale ----------
      if (s.finale) {
        s.finale.timer--;
        if (s.finale.timer % 6 === 0) {
          for (let i = 0; i < 10; i++) {
            const ang = rand(0, Math.PI * 2);
            const dist = rand(0, 46);
            s.particles.push({
              x: s.finale.x + Math.cos(ang) * dist,
              y: s.finale.y + Math.sin(ang) * dist,
              vx: rand(-5, 5),
              vy: rand(-5, 5),
              life: rand(20, 34),
              c: [COLORS.violet, COLORS.cyan, COLORS.white, COLORS.amber][Math.floor(rand(0, 4))],
            });
          }
          s.shakeT = 10;
          if (s.finale.timer % 24 === 0) sfx.explosion(false);
        }
      }

      // bullet-rock collisions
      for (const r of s.rocks) {
        for (const b of s.bullets) {
          if (b.dead || b.justSpawned) continue;
          if (b.pierce && b.hitRocks && b.hitRocks.includes(r)) continue;
          const d = Math.hypot(r.x - b.x, r.y - b.y);
          if (d < r.size) {
            if (b.pierce) {
              b.hitRocks = b.hitRocks || [];
              b.hitRocks.push(r);
            } else {
              b.dead = true;
            }
            r.hp -= bulletDamage(s, b);

            // ice bullets chill the target, slowing its fall
            if (b.type === "bl_ice") {
              r.vy *= 0.6;
              r.vx *= 0.6;
            }

            // explosive bullets splash nearby rocks too
            if (b.type === "bl_explosive") {
              for (const other of s.rocks) {
                if (other === r || other.dead) continue;
                if (Math.hypot(other.x - r.x, other.y - r.y) < 44) {
                  other.hp -= bulletDamage(s, b);
                  if (other.hp <= 0) {
                    other.dead = true;
                    s.score += other.size > 24 ? 25 : 15;
                    s.runStats.asteroidsDestroyed++;
                  }
                }
              }
              for (let i = 0; i < 10; i++) {
                const ang = rand(0, Math.PI * 2);
                s.particles.push({
                  x: r.x,
                  y: r.y,
                  vx: Math.cos(ang) * rand(1, 4),
                  vy: Math.sin(ang) * rand(1, 4),
                  life: 20,
                  c: COLORS.red,
                });
              }
            }

            // splitting bullets spawn two smaller bullets continuing on
            if (b.type === "bl_split" && !b.isChild) {
              [-0.3, 0.3].forEach((off) => {
                s.bullets.push({
                  x: b.x,
                  y: b.y,
                  vxOverride: Math.sin(off) * 2.4,
                  speed: (b.speed || BULLET_SPEED) * 0.85,
                  pierce: false,
                  type: "bl_split",
                  isChild: true,
                  small: true,
                  justSpawned: true,
                });
              });
            }

            if (r.hp <= 0) {
              r.dead = true;
              s.score += r.size > 24 ? 25 : 15;
              s.runStats.asteroidsDestroyed++;
              for (let i = 0; i < 8; i++) {
                s.particles.push({
                  x: r.x,
                  y: r.y,
                  vx: rand(-3, 3),
                  vy: rand(-3, 3),
                  life: 22,
                  c: COLORS.amber,
                });
              }
            } else {
              for (let i = 0; i < 3; i++) {
                s.particles.push({
                  x: b.x,
                  y: b.y,
                  vx: rand(-1.5, 1.5),
                  vy: rand(-1.5, 1.5),
                  life: 14,
                  c: COLORS.cyan,
                });
              }
            }
          }
        }
      }
      s.bullets = s.bullets.filter((b) => !b.dead);
      s.rocks = s.rocks.filter((r) => !r.dead);

      // player-rock collision
      for (const r of s.rocks) {
        const d = Math.hypot(r.x - s.player.x, r.y - s.player.y);
        if (d < r.size * 0.75 + 8 && s.player.hit <= 0) {
          r.dead = true;
          damagePlayer(s, "Asteroid Collision");
        }
      }
      s.rocks = s.rocks.filter((r) => !r.dead);

      // black hole hazard — unique to the Outworld. Flying into it hands
      // off to its own dedicated sequence rather than a normal death.
      if (s.world === "outworld") {
        const bhDist = Math.hypot(BLACKHOLE_X - s.player.x, BLACKHOLE_Y - s.player.y);
        if (bhDist < BLACKHOLE_PULL_RADIUS) {
          if (s.runStats) s.runStats.foundBlackHole = true;
          const cp = buildCheckpoint(s);
          blackholeCheckpointRef.current = cp;
          saveCheckpoint(cp);
          setSavedCheckpoint(cp);
          setStatus("blackhole");
          return;
        }
      }

      if (s.player.hit > 0) s.player.hit--;
      if (s.shakeT > 0) s.shakeT--;
      if (s.banner && s.banner.t > 0) s.banner.t--;
      else if (s.banner) s.banner = null;
      if (s.alert && s.alert.t > 0) s.alert.t--;
      else if (s.alert) s.alert = null;

      if (s.lives === undefined) s.lives = 3;

      // periodic fallback checkpoint save, in case visibility/pagehide
      // events don't fire (some mobile browsers are inconsistent)
      if (s.t % 1200 === 0 && s.lives > 0) {
        saveCheckpoint(buildCheckpoint(s));
        if (trophiesDirtyRef.current) {
          saveTrophies(trophiesRef.current).then((ok) => {
            if (ok) trophiesDirtyRef.current = false;
          });
        }
        if (ownedItemsDirtyRef.current) {
          saveOwnedItems(ownedItemsRef.current).then((ok) => {
            if (ok) ownedItemsDirtyRef.current = false;
          });
        }
        if (shipConfigDirtyRef.current) {
          saveShipConfig(shipConfigRef.current).then((ok) => {
            if (ok) shipConfigDirtyRef.current = false;
          });
        }
      }

      // particles
      s.particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
      });
      s.particles = s.particles.filter((p) => p.life > 0);

      // starfield drift
      s.stars.forEach((st) => {
        st.y += st.speed;
        if (st.y > HEIGHT + 2) {
          st.y = -2;
          st.x = rand(0, WIDTH);
        }
      });
      s.nebulae.forEach((n) => {
        n.x += n.drift;
        if (n.x < -n.r) n.x = WIDTH + n.r;
        if (n.x > WIDTH + n.r) n.x = -n.r;
      });

      setScore(s.score);
      setWave(s.wave);
      setStatusFlags({
        frozen: s.player.frozen > 0,
        disarmed: s.player.disarmed > 0,
        slowed: s.player.slowed > 0,
      });
      setBossMoveUI(
        s.player.transformed
          ? { transformed: true, cooldowns: { ...s.player.moveCooldowns } }
          : { transformed: false, cooldowns: null }
      );
      setBossHud(
        s.bossActive && s.boss
          ? { hp: Math.max(0, s.boss.hp), maxHp: s.boss.maxHp, tier: s.boss.tier, world: s.boss.world, name: s.boss.name }
          : null
      );

      // death check — hand off to the explosion sequence instead of
      // ending the game immediately
      if (s.lives <= 0 && !s.deathSequence) {
        s.deathSequence = {
          x: s.player.x,
          y: s.player.y,
          timer: 70,
          cause: s.lastDamageCause || "Unknown Cause",
        };
        s.shakeT = 30;
        sfx.explosion(true);
        for (let i = 0; i < 36; i++) {
          const ang = rand(0, Math.PI * 2);
          s.particles.push({
            x: s.player.x + Math.cos(ang) * rand(0, 10),
            y: s.player.y + Math.sin(ang) * rand(0, 10),
            vx: Math.cos(ang) * rand(2, 7),
            vy: Math.sin(ang) * rand(2, 7),
            life: rand(26, 44),
            c: [COLORS.red, COLORS.amber, COLORS.white][Math.floor(rand(0, 3))],
          });
        }
      }

      // win check — finale explosion has finished playing out
      if (s.finale && s.finale.timer <= 0) {
        if (s.finale.bossRush) {
          setBest((b) => { const next = Math.max(b, s.score); if (next !== b) saveBestScore(next); return next; });
          setBossRushResult("win");
          flushRunStats(s, { died: false });
          setStatus("start");
          return;
        }
        setBest((b) => { const next = Math.max(b, s.score); if (next !== b) saveBestScore(next); return next; });
        const nextTrophies = trophiesRef.current + 1;
        setTrophies(nextTrophies);
        persistTrophies(nextTrophies);
        flushRunStats(s, { died: false, trophiesEarned: 1 });
        clearCheckpoint();
        setSavedCheckpoint(null);
        if (s.finale.world === "wormhole") {
          setFinalVictory(true);
          setCompletedGame(true);
          saveCompletedGame(true);
          setStatus("homecoming");
        } else {
          setStatus("won");
        }
        return;
      }

      // ---------- render ----------
      const shakeX = s.shakeT > 0 ? rand(-4, 4) : 0;
      const shakeY = s.shakeT > 0 ? rand(-4, 4) : 0;
      const isFrontierWorld = s.world === "frontier";
      const isOutworldWorld = s.world === "outworld";
      const isWormholeWorld = s.world === "wormhole";

      ctx.save();
      ctx.fillStyle = isWormholeWorld
        ? "#020e08"
        : isOutworldWorld
        ? "#0a0316"
        : isFrontierWorld
        ? "#020611"
        : COLORS.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // nebula clouds — dark green in the Wormhole, purple in the
      // Outworld, icy/violet in the Frontier, warm default on Homeworld
      s.nebulae.forEach((n, i) => {
        const palette = isWormholeWorld
          ? WORMHOLE_NEBULA_COLORS[i % WORMHOLE_NEBULA_COLORS.length]
          : isOutworldWorld
          ? OUTWORLD_NEBULA_COLORS[i % OUTWORLD_NEBULA_COLORS.length]
          : isFrontierWorld
          ? FRONTIER_NEBULA_COLORS[i % FRONTIER_NEBULA_COLORS.length]
          : n;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, palette.c1);
        g.addColorStop(1, palette.c2);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      });

      // a slow drifting aurora band, unique to the Frontier
      if (isFrontierWorld) {
        const auroraY = HEIGHT * 0.32 + Math.sin(s.t * 0.008) * 50;
        const ag = ctx.createLinearGradient(0, auroraY - 70, 0, auroraY + 70);
        ag.addColorStop(0, "rgba(90,255,205,0)");
        ag.addColorStop(0.5, "rgba(90,255,205,0.07)");
        ag.addColorStop(1, "rgba(90,255,205,0)");
        ctx.fillStyle = ag;
        ctx.fillRect(0, auroraY - 70, WIDTH, 140);
      }

      // a giant black hole looming in the background, unique to the
      // Outworld — dark event horizon with a slow-turning accretion disk.
      // Flying into it (checked in the main update loop) triggers the
      // black-hole sequence.
      if (isOutworldWorld) {
        ctx.save();
        ctx.translate(BLACKHOLE_X, BLACKHOLE_Y);

        const glow = ctx.createRadialGradient(0, 0, 40, 0, 0, 210);
        glow.addColorStop(0, "rgba(160,32,240,0.35)");
        glow.addColorStop(0.5, "rgba(120,20,200,0.14)");
        glow.addColorStop(1, "rgba(120,20,200,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 210, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.rotate(s.t * 0.0025);
        for (let i = 0; i < 3; i++) {
          const rOuter = 60 + i * 20;
          const diskGrad = ctx.createLinearGradient(-rOuter, 0, rOuter, 0);
          diskGrad.addColorStop(0, "rgba(230,190,255,0)");
          diskGrad.addColorStop(0.5, `rgba(230,190,255,${0.35 - i * 0.09})`);
          diskGrad.addColorStop(1, "rgba(230,190,255,0)");
          ctx.strokeStyle = diskGrad;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(0, 0, rOuter, rOuter * 0.32, 0.3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

        // event horizon
        ctx.beginPath();
        ctx.arc(0, 0, 46, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.strokeStyle = "rgba(200,150,255,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // faint hint at the actual pull radius — real danger, not just backdrop
        ctx.beginPath();
        ctx.arc(0, 0, BLACKHOLE_PULL_RADIUS, 0, Math.PI * 2);
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "rgba(200,150,255,0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
      }

      // starfield
      s.stars.forEach((st) => {
        const twinkle = 0.5 + 0.5 * Math.sin(s.t * 0.04 + st.phase);
        ctx.globalAlpha = st.baseAlpha * (0.5 + 0.5 * twinkle);
        ctx.fillStyle = isWormholeWorld
          ? "#c8ffe0"
          : isOutworldWorld
          ? "#e6d0ff"
          : isFrontierWorld
          ? "#dff6ff"
          : COLORS.white;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // subtle radial vignette so the play field reads as a contained void
      const vg = ctx.createRadialGradient(
        WIDTH / 2,
        HEIGHT / 2,
        HEIGHT * 0.15,
        WIDTH / 2,
        HEIGHT / 2,
        HEIGHT * 0.75
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");

      ctx.translate(shakeX, shakeY);

      // particles
      s.particles.forEach((p) => {
        ctx.globalAlpha = Math.max(0, p.life / 26);
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      });
      ctx.globalAlpha = 1;

      // rocks — irregular cratered silhouettes (Homeworld), faceted icy
      // crystal shards (Frontier), or fiery comets (Outworld)
      s.rocks.forEach((r) => {
        ctx.save();
        ctx.translate(r.x, r.y);

        const danger = r.hp > 1;

        if (r.style === "comet") {
          // tail trails opposite the direction of travel, independent of
          // the core's own spin
          const tailAngle = Math.atan2(-r.vy, -r.vx || 0.0001);
          ctx.save();
          ctx.rotate(tailAngle);
          const tailLen = r.size * 3.4;
          const tailGrad = ctx.createLinearGradient(0, 0, tailLen, 0);
          tailGrad.addColorStop(0, danger ? "rgba(255,90,30,0.55)" : "rgba(255,170,50,0.45)");
          tailGrad.addColorStop(0.5, "rgba(255,120,40,0.18)");
          tailGrad.addColorStop(1, "rgba(255,120,40,0)");
          ctx.fillStyle = tailGrad;
          ctx.beginPath();
          ctx.moveTo(0, -r.size * 0.4);
          ctx.lineTo(tailLen, 0);
          ctx.lineTo(0, r.size * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          ctx.rotate(r.a);
          const grad = ctx.createRadialGradient(0, 0, r.size * 0.1, 0, 0, r.size * 1.15);
          grad.addColorStop(0, "#fff6d8");
          grad.addColorStop(0.35, danger ? "#ff5a1e" : "#ffae3c");
          grad.addColorStop(1, danger ? "#5a1408" : "#7a2a08");

          ctx.beginPath();
          r.outline.forEach((pt, i) => {
            const px = Math.cos(pt.ang) * pt.r;
            const py = Math.sin(pt.ang) * pt.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.shadowColor = "#ff7a2e";
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = danger ? "#ffd27a" : "#fff0c2";
          ctx.lineWidth = 1.3;
          ctx.stroke();

          (r.hotspots || []).forEach((h) => {
            ctx.beginPath();
            ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,240,180,0.85)";
            ctx.fill();
          });
        } else if (r.style === "crystal") {
          ctx.rotate(r.a);
          const grad = ctx.createRadialGradient(
            -r.size * 0.3,
            -r.size * 0.3,
            r.size * 0.1,
            0,
            0,
            r.size * 1.2
          );
          grad.addColorStop(0, danger ? "#e8fbff" : "#bff3ff");
          grad.addColorStop(0.55, danger ? "#5a3ac9" : "#2fb8c9");
          grad.addColorStop(1, danger ? "#241959" : "#0d2b3a");

          ctx.beginPath();
          r.outline.forEach((pt, i) => {
            const px = Math.cos(pt.ang) * pt.r;
            const py = Math.sin(pt.ang) * pt.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = danger ? "#c65bff" : "#e8fbff";
          ctx.lineWidth = 1.4;
          ctx.stroke();

          ctx.strokeStyle = "rgba(255,255,255,0.4)";
          ctx.lineWidth = 0.8;
          (r.facets || []).forEach((f) => {
            ctx.beginPath();
            ctx.moveTo(f.x1, f.y1);
            ctx.lineTo(f.x2, f.y2);
            ctx.stroke();
          });
        } else if (r.style === "star") {
          ctx.rotate(r.a);
          const color = r.color || "#5ee6d0";
          const twinkle = 0.75 + 0.25 * Math.sin(s.t * 0.15 + r.x);

          // soft halo
          const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r.size * 2.2);
          halo.addColorStop(0, color + "55");
          halo.addColorStop(1, color + "00");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(0, 0, r.size * 2.2, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          r.outline.forEach((pt, i) => {
            const px = Math.cos(pt.ang) * pt.r;
            const py = Math.sin(pt.ang) * pt.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.globalAlpha = twinkle;
          ctx.shadowColor = color;
          ctx.shadowBlur = danger ? 16 : 10;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = danger ? "#fff" : "rgba(255,255,255,0.6)";
          ctx.lineWidth = danger ? 1.6 : 1;
          ctx.stroke();

          // bright white core
          ctx.beginPath();
          ctx.arc(0, 0, r.size * 0.22, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
        } else {
          ctx.rotate(r.a);
          const grad = ctx.createRadialGradient(
            -r.size * 0.32,
            -r.size * 0.32,
            r.size * 0.1,
            0,
            0,
            r.size * 1.15
          );
          grad.addColorStop(0, danger ? COLORS.rockCoreHiDanger : COLORS.rockCoreHi);
          grad.addColorStop(1, danger ? COLORS.rockCoreLoDanger : COLORS.rockCoreLo);

          ctx.beginPath();
          r.outline.forEach((pt, i) => {
            const px = Math.cos(pt.ang) * pt.r;
            const py = Math.sin(pt.ang) * pt.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = danger ? COLORS.red : COLORS.amber;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          (r.craters || []).forEach((c) => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.4)";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x - c.r * 0.25, c.y - c.r * 0.25, c.r * 0.7, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.lineWidth = 1;
            ctx.stroke();
          });
        }

        ctx.restore();
      });

      // ---------- boss ----------
      if (s.bossActive && s.boss) {
        const boss = s.boss;
        const isMega = boss.tier === "mega";
        const isFrontier = boss.world === "frontier";
        const isOutworld = boss.world === "outworld";
        const isWormholeBoss = boss.world === "wormhole";
        const isMothership = isMega && isWormholeBoss;
        const primary = isWormholeBoss
          ? isMega
            ? "#0d5c3a"
            : "#1a8a4a"
          : isOutworld
          ? isMega
            ? "#c026ff"
            : "#9333ea"
          : isFrontier
          ? isMega
            ? "#8b5bff"
            : "#2fb8ff"
          : isMega
          ? COLORS.violet
          : COLORS.red;
        const accent = isWormholeBoss
          ? isMega
            ? "#baffd9"
            : "#7dffb0"
          : isOutworld
          ? isMega
            ? "#f3d9ff"
            : "#e0b3ff"
          : isFrontier
          ? isMega
            ? "#e8fbff"
            : "#bff3ff"
          : isMega
          ? COLORS.cyan
          : COLORS.amber;
        const isEntrance = boss.state === "entrance";
        const revealProgress = isEntrance ? boss.revealAlpha ?? 0 : 1;
        const revealFlicker = isMega && isEntrance ? 0.5 + 0.5 * Math.abs(Math.sin(s.t * 0.85)) : 1;
        const reveal = revealProgress * revealFlicker;
        const baseScale = isMothership ? 2.3 : isMega ? 1.4 : 1;
        const scale = baseScale * (isMega && isEntrance ? 0.65 + 0.35 * revealProgress : 1);

        // laser telegraph / beam
        if (boss.moveType === "laser" && (boss.state === "telegraph" || boss.state === "firing")) {
          const active = boss.state === "firing";
          const halfW = isMothership ? 40 : isMega ? 28 : 18;
          ctx.save();
          ctx.globalAlpha = active ? 0.55 : 0.22 + 0.15 * Math.sin(s.t * 0.6);
          ctx.fillStyle = primary;
          ctx.fillRect(boss.laserX - halfW, boss.y + 24, halfW * 2, HEIGHT);
          ctx.restore();
        }

        ctx.save();
        ctx.translate(boss.x, boss.y);
        ctx.scale(scale, scale);

        // slow-rotating outer scan ring — reads as sensor/shield array
        ctx.save();
        ctx.rotate(s.t * 0.015);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.4 * reveal;
        ctx.lineWidth = 1;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, 52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // engine flare, rear-facing
        ctx.save();
        ctx.globalAlpha = (0.55 + 0.25 * Math.sin(s.t * 0.4)) * reveal;
        ctx.fillStyle = accent;
        [-22, 22].forEach((ox) => {
          ctx.beginPath();
          ctx.ellipse(ox, 30, 5, rand(6, 11), 0, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();

        // main hull — angular layered silhouette
        const flashOn = boss.flash > 0;
        ctx.beginPath();
        ctx.moveTo(0, -36);
        ctx.lineTo(20, -14);
        ctx.lineTo(52, -6);
        ctx.lineTo(60, 12);
        ctx.lineTo(30, 22);
        ctx.lineTo(32, 38);
        ctx.lineTo(10, 26);
        ctx.lineTo(0, 34);
        ctx.lineTo(-10, 26);
        ctx.lineTo(-32, 38);
        ctx.lineTo(-30, 22);
        ctx.lineTo(-60, 12);
        ctx.lineTo(-52, -6);
        ctx.lineTo(-20, -14);
        ctx.closePath();
        ctx.fillStyle = flashOn ? COLORS.white : primary;
        ctx.globalAlpha = (flashOn ? 0.92 : 0.18) * reveal;
        ctx.fill();
        ctx.strokeStyle = flashOn ? COLORS.white : primary;
        ctx.globalAlpha = reveal;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // armor seam details
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.55 * reveal;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-24, -6);
        ctx.lineTo(24, -6);
        ctx.moveTo(-16, 10);
        ctx.lineTo(16, 10);
        ctx.stroke();
        ctx.globalAlpha = reveal;

        // side turret pods (recoil-flash when firing)
        [-1, 1].forEach((side) => {
          ctx.save();
          ctx.translate(side * 46, 4);
          ctx.beginPath();
          ctx.arc(0, 0, 7, 0, Math.PI * 2);
          ctx.fillStyle = boss.state === "firing" ? accent : primary;
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        });

        // core glow — double ring for the mega tier
        ctx.beginPath();
        ctx.arc(0, 0, isMega ? 11 : 8, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (isMega) {
          ctx.beginPath();
          ctx.arc(0, 0, 19, 0, Math.PI * 2);
          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.55 * reveal;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        ctx.restore();

        // materializing scan-sweep — a bright line travels down the
        // silhouette while the mega boss assembles itself
        if (isMega && isEntrance) {
          const sweepY = boss.y - 46 + revealProgress * 96;
          ctx.save();
          ctx.globalAlpha = 0.6;
          const sweepGrad = ctx.createLinearGradient(boss.x - 70, sweepY, boss.x + 70, sweepY);
          sweepGrad.addColorStop(0, "rgba(94,230,208,0)");
          sweepGrad.addColorStop(0.5, "rgba(220,250,255,0.85)");
          sweepGrad.addColorStop(1, "rgba(94,230,208,0)");
          ctx.strokeStyle = sweepGrad;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(boss.x - 70, sweepY);
          ctx.lineTo(boss.x + 70, sweepY);
          ctx.stroke();
          ctx.restore();
        }

        // hp bar — fades in with the reveal, so it isn't legible before
        // the mega boss has actually finished materializing
        const barW = isMothership ? 380 : isMega ? 320 : 260;
        const pct = Math.max(0, boss.hp / boss.maxHp);
        ctx.save();
        ctx.globalAlpha = reveal;
        ctx.textAlign = "center";
        ctx.fillStyle = isMothership ? "#1fa85a" : isMega ? COLORS.violetDim : COLORS.redDim;
        ctx.font = "10px 'JetBrains Mono', 'Courier New', monospace";
        ctx.fillText(
          isMega && isEntrance
            ? "SCANNING..."
            : isMothership
            ? "MOTHERSHIP"
            : isMega
            ? "MEGA THREAT"
            : (boss.name || "HOSTILE SIGNAL").toUpperCase(),
          WIDTH / 2,
          26
        );
        ctx.strokeStyle = COLORS.amberDim;
        ctx.lineWidth = 1;
        ctx.strokeRect(WIDTH / 2 - barW / 2, 32, barW, 8);
        ctx.fillStyle = isMothership ? "#7dffb0" : isMega ? COLORS.violet : pct > 0.3 ? COLORS.red : COLORS.amber;
        ctx.fillRect(WIDTH / 2 - barW / 2, 32, barW * pct, 8);
        ctx.restore();
      }

      // mega boss explosion ghost during the win finale
      if (s.finale) {
        const total = s.finale.total || 160;
        const t = s.finale.timer;
        const elapsed = total - t;
        const alpha = Math.max(0, Math.min(1, t / 40));
        const ringRadius = Math.max(0, 30 + elapsed * 1.4);
        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.translate(s.finale.x, s.finale.y);
        ctx.rotate(s.t * 0.05);
        ctx.strokeStyle = COLORS.violet;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // boss bullets — energy bolts oriented along their travel path
      s.bossBullets.forEach((b) => {
        if (b.kind === "zone") return; // rendered separately below
        const color =
          b.kind === "homing"
            ? "#4fd6ff"
            : b.kind === "seeker"
            ? COLORS.red
            : b.kind === "ring"
            ? COLORS.violet
            : COLORS.amber;
        drawLaserBolt(ctx, b.x, b.y, b.vx, b.vy, 15, b.r * 1.5, color, color);
      });

      // bombardment zones — growing warning ring, then a bright impact flash
      s.bossBullets.forEach((b) => {
        if (b.kind !== "zone") return;
        ctx.save();
        if (b.telegraph > 0) {
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(s.t * 0.6);
          ctx.strokeStyle = "#1a8a4a";
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
          g.addColorStop(0, "rgba(220,255,235,0.9)");
          g.addColorStop(0.5, "rgba(90,255,160,0.55)");
          g.addColorStop(1, "rgba(20,140,80,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      // player bullets — bright laser beams with a soft glow, styled per
      // equipped bullet type (or per special boss-move for the
      // transformed Quantum Fighter)
      s.bullets.forEach((b) => {
        if (b.special) {
          const vx = b.vx !== undefined ? b.vx : 0;
          const vy = b.vy !== undefined ? b.vy : -(b.speed || BULLET_SPEED);
          drawLaserBolt(ctx, b.x, b.y, vx, vy, 18, 3.2, b.color, b.color);
          return;
        }
        if (b.type === "bl_banana") {
          const ang = Math.atan2(b.vy || -BULLET_SPEED, b.vx || 0);
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(ang + s.t * 0.3);
          ctx.strokeStyle = "#f5d505";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.shadowColor = "#f5d505";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(0, 3, 8, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.restore();
          return;
        }
        const typeColor = BULLET_TYPE_COLORS[b.type];
        const color = typeColor || (b.pierce ? COLORS.red : COLORS.cyan);
        const len = b.small ? 12 : 20;
        const width = b.small ? 1.8 : 2.6;
        drawLaserBolt(ctx, b.x, b.y, b.vxOverride || 0, -1, len, width, color, color);

        if (
          (b.type === "bl_fire" || b.type === "bl_star" || b.type === "bl_toxic" || b.type === "bl_plasma") &&
          s.t % 3 === 0
        ) {
          s.particles.push({
            x: b.x + rand(-2, 2),
            y: b.y + 8,
            vx: rand(-0.4, 0.4),
            vy: rand(0.5, 1.2),
            life: 14,
            c: b.type === "bl_star" ? WORMHOLE_STAR_COLORS[Math.floor(rand(0, WORMHOLE_STAR_COLORS.length))] : color,
          });
        }

        if (b.type === "bl_blackhole") {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = "#c65bff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 8 + Math.sin(s.t * 0.3) * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });

      // player — a small detailed fighter craft: metallic fuselage,
      // swept wings, cockpit canopy, wingtip nav lights, twin engines
      const blink = s.player.hit > 0 && Math.floor(s.t / 4) % 2 === 0;
      if (!blink && !s.deathSequence) {
        ctx.save();
        ctx.translate(s.player.x, s.player.y);
        const frozenNow = s.player.frozen > 0;
        const disarmedNow = s.player.disarmed > 0;
        const shipColor = s.player.color === "rainbow" ? `hsl(${(s.t * 2) % 360},85%,62%)` : s.player.color;
        const accent = frozenNow ? COLORS.cyan : disarmedNow ? COLORS.redDim : shipColor || COLORS.amber;
        const shapePoints = SHIP_SHAPES[s.player.shape] || SHIP_SHAPES.interceptor;
        let leftPt = shapePoints[0],
          rightPt = shapePoints[0];
        shapePoints.forEach((p) => {
          if (p[0] < leftPt[0]) leftPt = p;
          if (p[0] > rightPt[0]) rightPt = p;
        });

        // twin engine flares (drawn first, behind the hull)
        if (s.player.transformed) {
          // Quantum Fighter easter egg — a small boss-styled hull with a
          // rotating scan ring and a glowing core, in the ship's own color
          ctx.save();
          ctx.rotate(s.t * 0.02);
          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(0, 0, 20, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.restore();

          ctx.beginPath();
          ctx.moveTo(0, -16);
          ctx.lineTo(9, -6);
          ctx.lineTo(22, -3);
          ctx.lineTo(26, 5);
          ctx.lineTo(13, 10);
          ctx.lineTo(14, 17);
          ctx.lineTo(0, 13);
          ctx.lineTo(-14, 17);
          ctx.lineTo(-13, 10);
          ctx.lineTo(-26, 5);
          ctx.lineTo(-22, -3);
          ctx.lineTo(-9, -6);
          ctx.closePath();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.shadowColor = accent;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.restore();
        } else {
        const flicker = 0.6 + 0.4 * Math.sin(s.t * 0.5);
        if (!frozenNow) {
          [-6, 6].forEach((ox) => {
            const flen = disarmedNow ? rand(5, 8) : rand(8, 14);
            const fg = ctx.createLinearGradient(ox, 15, ox, 15 + flen);
            fg.addColorStop(0, "rgba(255,255,255,0.9)");
            fg.addColorStop(0.4, accent);
            fg.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = fg;
            ctx.globalAlpha = flicker;
            ctx.beginPath();
            ctx.ellipse(ox, 15 + flen / 2, 2.4, flen / 2, 0, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.globalAlpha = 1;
        }

        // fuselage — swaps in whichever hull preset is selected
        const hullGrad = ctx.createLinearGradient(0, -17, 0, 15);
        hullGrad.addColorStop(0, "#eef2f5");
        hullGrad.addColorStop(0.45, frozenNow ? "#8fd8cc" : disarmedNow ? "#9a5a5a" : accent);
        hullGrad.addColorStop(1, "#26282c");
        ctx.beginPath();
        shapePoints.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = hullGrad;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.3;
        ctx.fill();
        ctx.stroke();

        // panel seam (angular hulls) or a painted pattern (the egg hull)
        if (s.player.shape === "egg") {
          ctx.save();
          ctx.beginPath();
          shapePoints.forEach(([px, py], i) => {
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.clip();
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = "#ff8fd6";
          ctx.fillRect(-15, -3, 30, 4);
          ctx.globalAlpha = 0.85;
          [
            [-6, -11, "#8fe8ff"],
            [6, -9, "#ffe066"],
            [-7, 7, "#b3ffb3"],
            [7, 9, "#8fe8ff"],
            [0, 13, "#ffe066"],
          ].forEach(([dx, dy, color]) => {
            ctx.beginPath();
            ctx.arc(dx, dy, 1.8, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          });
          ctx.globalAlpha = 1;
          ctx.restore();
        } else {
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, -13);
          ctx.lineTo(0, 9);
          ctx.stroke();
        }

        // cockpit canopy
        const glassGrad = ctx.createRadialGradient(-0.6, -9, 0.3, 0, -8, 3.6);
        glassGrad.addColorStop(0, "#eafcff");
        glassGrad.addColorStop(1, frozenNow ? "#1c6f66" : "#1b4a66");
        ctx.beginPath();
        ctx.ellipse(0, -8, 2.2, 3.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = glassGrad;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 0.6;
        ctx.stroke();

        // wingtip navigation lights (red left / green right, subtle blink)
        const navBlink = Math.floor(s.t / 18) % 2 === 0;
        ctx.beginPath();
        ctx.arc(leftPt[0], leftPt[1], navBlink ? 1.4 : 0.9, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.red;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rightPt[0], rightPt[1], navBlink ? 1.4 : 0.9, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.green;
        ctx.fill();

        ctx.restore();
        }

        // escort drones, small diamond hulls that trail either side
        const droneCount = s.player.drones || 0;
        if (droneCount > 0) {
          const droneOffsets = droneCount === 1 ? [22] : [-22, 22];
          droneOffsets.forEach((dx) => {
            ctx.save();
            ctx.translate(s.player.x + dx, s.player.y + 10 + Math.sin(s.t * 0.15 + dx) * 3);
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(4, 0);
            ctx.lineTo(0, 6);
            ctx.lineTo(-4, 0);
            ctx.closePath();
            ctx.fillStyle = "rgba(94,230,208,0.25)";
            ctx.strokeStyle = COLORS.cyan;
            ctx.lineWidth = 1.2;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          });
        }

        // shield bubble while a shield charge is active
        if (s.player.shieldCharges > 0) {
          ctx.save();
          ctx.translate(s.player.x, s.player.y);
          ctx.globalAlpha = 0.35 + 0.15 * Math.sin(s.t * 0.2);
          ctx.strokeStyle = COLORS.cyan;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 2, 24, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // power-up banner
      if (s.banner) {
        const fadeIn = Math.min(1, (130 - s.banner.t) / 14);
        const fadeOut = Math.min(1, s.banner.t / 20);
        const alpha = Math.min(fadeIn, fadeOut);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.fillStyle = COLORS.cyan;
        ctx.font = "bold 20px 'JetBrains Mono', 'Courier New', monospace";
        ctx.shadowColor = COLORS.cyan;
        ctx.shadowBlur = 12;
        ctx.fillText(s.banner.text, WIDTH / 2, HEIGHT / 2 - 100);
        ctx.font = "14px 'JetBrains Mono', 'Courier New', monospace";
        ctx.fillStyle = COLORS.amber;
        ctx.shadowColor = COLORS.amber;
        ctx.shadowBlur = 8;
        ctx.fillText(s.banner.sub, WIDTH / 2, HEIGHT / 2 - 74);
        ctx.restore();
      }

      // system fault / warning alert
      if (s.alert) {
        const total = s.alert.warn ? 150 : 90;
        const fadeIn = Math.min(1, (total - s.alert.t) / 10);
        const fadeOut = Math.min(1, s.alert.t / 18);
        const alpha = Math.min(fadeIn, fadeOut);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.fillStyle = s.alert.warn ? COLORS.red : COLORS.amber;
        ctx.font = "bold 14px 'JetBrains Mono', 'Courier New', monospace";
        ctx.shadowColor = s.alert.warn ? COLORS.red : COLORS.amber;
        ctx.shadowBlur = 10;
        ctx.fillText(s.alert.text, WIDTH / 2, s.bossActive ? 64 : 46);
        ctx.restore();
      }

      ctx.fillStyle = vg;
      ctx.fillRect(-shakeX, -shakeY, WIDTH, HEIGHT);

      ctx.restore();

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopBananaLoop();
    };
  }, [status]);

  // touch controls
  const onPointerDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Easter egg: clicking directly on the Quantum Fighter mid-run
    // transforms it into a boss-styled ship with special attacks.
    // Mouse/pen only — on touch devices, normal dodge taps land near the
    // ship constantly, so this would trigger by accident all the time.
    if (
      status === "playing" &&
      !pausedRef.current &&
      e.pointerType !== "touch" &&
      shipConfig.shape === "quantum" &&
      stateRef.current
    ) {
      const s = stateRef.current;
      const d = Math.hypot(x - s.player.x, y - s.player.y);
      if (d < 26) {
        s.player.transformed = !s.player.transformed;
        sfx.megaReveal();
        return;
      }
    }

    touchRef.current = { active: true, x, y };
  };
  const onPointerMove = (e) => {
    if (!touchRef.current.active) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    touchRef.current.x = (e.clientX - rect.left) * scaleX;
    touchRef.current.y = (e.clientY - rect.top) * scaleY;
  };
  const onPointerUp = () => {
    touchRef.current.active = false;
  };

  const lives = stateRef.current?.lives ?? 3;
  const hasBonusLife = stateRef.current?.player?.extraLifeGranted ?? false;

  return (
    <div
      className="vr-root"
      style={{
        position: "relative",
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        gap: 12,
      }}
    >
      <audio
        ref={audioUnlockRef}
        src={AUDIO_UNLOCK_DATA_URI}
        loop
        playsInline
        preload="auto"
        style={{ display: "none" }}
        onCanPlay={(e) => {
          e.currentTarget.volume = 0.02;
        }}
      />

      <button
        onClick={() => {
          setTrophies(5);
          persistTrophies(5);
          setSecretMessage("🏆 Trophies set to 5");
          setTimeout(() => setSecretMessage(null), 1200);
        }}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "fixed",
          left: 4,
          bottom: 4,
          width: 26,
          height: 26,
          zIndex: 999,
          borderRadius: "50%",
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "default",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
        }}
      />
      <button
        onClick={() => {
          const next = trophiesRef.current + 10;
          setTrophies(next);
          persistTrophies(next);
          setSecretMessage("🏆 +10 Trophies");
          setTimeout(() => setSecretMessage(null), 1200);
        }}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "fixed",
          right: 4,
          bottom: 4,
          width: 26,
          height: 26,
          zIndex: 999,
          borderRadius: "50%",
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "default",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
        }}
      />
      {secretMessage && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 999,
            padding: "8px 16px",
            background: "rgba(5,6,10,0.9)",
            border: `1px solid ${COLORS.amber}`,
            color: COLORS.amber,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 2,
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          {secretMessage}
        </div>
      )}

      {achievementToast && (
        <div
          className="vr-achievement-toast"
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
            background: "rgba(10,6,16,0.95)",
            border: `1px solid ${COLORS.violet}`,
            boxShadow: `0 0 18px rgba(198,91,255,0.4)`,
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 22 }}>🏅</span>
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: COLORS.violetDim,
              }}
            >
              Achievement Unlocked
            </div>
            <div
              style={{
                fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                fontSize: 13,
                letterSpacing: 1,
                color: "#e0b3ff",
              }}
            >
              {achievementToast.label}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
        html, body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
        .vr-root {
          min-height: 100vh;
          min-height: 100dvh;
          overscroll-behavior: none;
          -webkit-tap-highlight-color: transparent;
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          padding-top: max(16px, env(safe-area-inset-top));
          padding-bottom: max(16px, env(safe-area-inset-bottom));
          padding-left: max(16px, env(safe-area-inset-left));
          padding-right: max(16px, env(safe-area-inset-right));
        }
        .vr-tap-target {
          min-height: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        @keyframes vr-title-flicker {
          0%, 100% { opacity: 1; }
          92% { opacity: 1; }
          93% { opacity: 0.55; }
          94% { opacity: 1; }
          96% { opacity: 0.75; }
          97% { opacity: 1; }
        }
        .vr-title { animation: vr-title-flicker 5s infinite; }
        .vr-btn {
          transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
        }
        .vr-btn:hover {
          background: ${COLORS.amber};
          color: #0a0a0a;
          box-shadow: 0 0 18px rgba(255,180,84,0.45);
        }
        .vr-btn-alt:hover {
          background: ${COLORS.cyan};
          color: #0a0a0a;
          box-shadow: 0 0 18px rgba(94,230,208,0.45);
        }
        @keyframes vr-trophy-pop {
          0% { transform: scale(0) rotate(-20deg); opacity: 0; }
          55% { transform: scale(1.35) rotate(10deg); opacity: 1; }
          75% { transform: scale(0.92) rotate(-4deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .vr-trophy-pop {
          display: inline-block;
          animation: vr-trophy-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        @keyframes vr-achievement-slide {
          0% { transform: translate(-50%, -30px); opacity: 0; }
          15% { transform: translate(-50%, 0); opacity: 1; }
          85% { transform: translate(-50%, 0); opacity: 1; }
          100% { transform: translate(-50%, -12px); opacity: 0; }
        }
        .vr-achievement-toast {
          animation: vr-achievement-slide 3.2s ease both;
        }
      `}</style>

      {status !== "cutscene" &&
        status !== "travel" &&
        status !== "blackhole" &&
        status !== "homecoming" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: WIDTH,
            maxWidth: "100%",
            color: COLORS.amber,
            letterSpacing: 2,
            fontSize: 12,
            textTransform: "uppercase",
            padding: "6px 10px",
            background: COLORS.panel,
            border: `1px solid ${COLORS.amberFaint}`,
          }}
        >
          <span>Score <b style={{ color: COLORS.white }}>{score.toString().padStart(5, "0")}</b></span>
          <span style={{ color: COLORS.cyan }}>Wave {wave}</span>
          <span style={{ letterSpacing: 3 }}>
          <span style={{ color: COLORS.red }}>
            {"◆".repeat(Math.max(0, Math.min(lives, 3)))}
            {"◇".repeat(Math.max(0, 3 - Math.min(lives, 3)))}
          </span>
          {hasBonusLife && <span style={{ color: COLORS.green }}>{lives >= 4 ? "◆" : "◇"}</span>}
        </span>
        {status === "playing" && (
          <button
            onClick={() => {
              setPaused(true);
              if (stateRef.current && stateRef.current.lives > 0) {
                const cp = buildCheckpoint(stateRef.current);
                saveCheckpoint(cp);
                setSavedCheckpoint(cp);
              }
            }}
            aria-label="Pause"
            style={{
              background: "transparent",
              border: `1px solid ${COLORS.amberFaint}`,
              color: COLORS.amber,
              fontFamily: "inherit",
              fontSize: 18,
              lineHeight: 1,
              padding: "8px 14px",
              minWidth: 40,
              minHeight: 40,
              cursor: "pointer",
              letterSpacing: 0,
            }}
          >
            ⏸
          </button>
        )}
      </div>
      )}

      {status === "playing" && (statusFlags.frozen || statusFlags.disarmed || statusFlags.slowed || bossHud) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            width: WIDTH,
            maxWidth: "100%",
            justifyContent: "center",
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          {bossHud && (
            <span
              style={{
                color: bossHud.world === "wormhole" && bossHud.tier === "mega" ? "#7dffb0" : bossHud.tier === "mega" ? COLORS.violet : COLORS.red,
                border: `1px solid ${bossHud.tier === "mega" ? COLORS.violetDim : COLORS.redDim}`,
                padding: "2px 8px",
              }}
            >
              {bossHud.world === "wormhole" && bossHud.tier === "mega"
                ? "Mothership"
                : bossHud.tier === "mega"
                ? "Mega Boss"
                : bossHud.name || "Boss"}{" "}
              {bossHud.hp}/{bossHud.maxHp}
            </span>
          )}
          {statusFlags.frozen && (
            <span style={{ color: COLORS.cyan, border: `1px solid ${COLORS.cyanDim}`, padding: "2px 8px" }}>
              Nav Locked
            </span>
          )}
          {statusFlags.disarmed && (
            <span style={{ color: COLORS.red, border: `1px solid ${COLORS.redDim}`, padding: "2px 8px" }}>
              Weapons Offline
            </span>
          )}
          {statusFlags.slowed && (
            <span style={{ color: COLORS.amber, border: `1px solid ${COLORS.amberDim}`, padding: "2px 8px" }}>
              Thruster Failure
            </span>
          )}
        </div>
      )}

      {status === "playing" && bossMoveUI.transformed && (
        <div
          style={{
            display: "flex",
            gap: 6,
            width: WIDTH,
            maxWidth: "100%",
            justifyContent: "center",
            flexWrap: "wrap",
            opacity: paused ? 0.4 : 1,
            pointerEvents: paused ? "none" : "auto",
          }}
        >
          {[
            { id: "spread", label: "Spread" },
            { id: "aimed", label: "Aimed" },
            { id: "laser", label: "Laser" },
            { id: "burst", label: "Burst" },
          ].map((mv) => {
            const cd = bossMoveUI.cooldowns ? bossMoveUI.cooldowns[mv.id] : 0;
            const ready = !cd || cd <= 0;
            return (
              <button
                key={mv.id}
                onClick={() => {
                  if (stateRef.current && !pausedRef.current) firePlayerBossMove(stateRef.current, mv.id);
                }}
                disabled={!ready || paused}
                style={{
                  padding: "10px 16px",
                  minHeight: 40,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  cursor: ready ? "pointer" : "not-allowed",
                  opacity: ready ? 1 : 0.45,
                  background: ready ? "#ffd700" : "transparent",
                  color: ready ? "#0a0a0a" : "#ffd700",
                  border: "1px solid #ffd700",
                }}
              >
                {ready ? mv.label : Math.ceil(cd / 60) + "s"}
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: WIDTH,
          aspectRatio: `${WIDTH} / ${HEIGHT}`,
          boxShadow: `0 0 0 1px ${COLORS.amberDim}, 0 0 50px rgba(255,180,84,0.07)`,
        }}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
        />

        {status === "playing" && paused && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(5,6,10,0.88)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              zIndex: 40,
              textAlign: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: 4,
                color: COLORS.amber,
                textShadow: `0 0 16px ${COLORS.amber}`,
              }}
            >
              PAUSED
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={() => setPaused(false)}
                className="vr-btn"
                style={{
                  padding: "10px 26px",
                  background: "transparent",
                  border: `1px solid ${COLORS.amber}`,
                  color: COLORS.amber,
                  fontFamily: "inherit",
                  fontSize: 13,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Resume
              </button>
              <button
                onClick={quitToHome}
                className="vr-btn-alt"
                style={{
                  padding: "10px 26px",
                  background: "transparent",
                  border: `1px solid ${COLORS.cyan}`,
                  color: COLORS.cyan,
                  fontFamily: "inherit",
                  fontSize: 13,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Quit to Home
              </button>
            </div>
            <div style={{ fontSize: 10, letterSpacing: 1, color: COLORS.amberDim }}>
              Your progress is saved — resume anytime from the title screen
            </div>
          </div>
        )}

        {status === "blackhole" && blackholeFailed && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              zIndex: 60,
              textAlign: "center",
              padding: 24,
            }}
          >
            <div
              className="vr-title"
              style={{
                fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: 4,
                color: COLORS.red,
                textShadow: `0 0 20px ${COLORS.red}`,
              }}
            >
              MISSION FAILED
            </div>
            <div style={{ fontSize: 11, letterSpacing: 1, color: "#ff8080", maxWidth: 300 }}>
              Contact with the pilot was lost near the Outworld's black hole.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={tryAgainFromBlackhole}
                className="vr-btn"
                style={{
                  padding: "10px 26px",
                  background: "transparent",
                  border: `1px solid ${COLORS.amber}`,
                  color: COLORS.amber,
                  fontFamily: "inherit",
                  fontSize: 13,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>
              <button
                onClick={quitFromBlackhole}
                className="vr-btn-alt"
                style={{
                  padding: "10px 26px",
                  background: "transparent",
                  border: `1px solid ${COLORS.cyan}`,
                  color: COLORS.cyan,
                  fontFamily: "inherit",
                  fontSize: 13,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Quit
              </button>
            </div>
          </div>
        )}

        {/* CRT scanline overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)",
            mixBlendMode: "multiply",
          }}
        />

        {status === "cutscene" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "48px 20px",
              pointerEvents: "none",
            }}
          >
            <div style={{ width: "100%", display: "flex", justifyContent: "flex-end", pointerEvents: "auto" }}>
              <button
                onClick={() => setStatus("tutorial")}
                style={{
                  padding: "6px 14px",
                  background: "rgba(5,6,10,0.55)",
                  border: `1px solid ${COLORS.amberDim}`,
                  color: COLORS.amber,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Skip ▶
              </button>
            </div>
            <div
              style={{
                fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                fontSize: 15,
                letterSpacing: 2,
                color: COLORS.white,
                textShadow: "0 0 12px rgba(0,0,0,0.9)",
                fontStyle: "italic",
              }}
            >
              {cutsceneCaption}
            </div>
          </div>
        )}

        {status === "travel" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
              padding: "40px 20px",
              pointerEvents: "none",
            }}
          >
            <button
              onClick={() => setStatus("start")}
              style={{
                pointerEvents: "auto",
                padding: "6px 14px",
                background: "rgba(5,6,10,0.55)",
                border: "1px solid #2f7f99",
                color: "#4fd6ff",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: 2,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Skip ▶
            </button>
          </div>
        )}

        {status !== "playing" &&
          status !== "cutscene" &&
          status !== "travel" &&
          status !== "blackhole" &&
          status !== "homecoming" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 50% 38%, rgba(5,6,10,0.55) 0%, rgba(5,6,10,0.88) 65%, rgba(5,6,10,0.95) 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 16,
              color: COLORS.white,
              textAlign: "center",
              padding: 24,
              overflowY: "auto",
            }}
          >
            {status === "tutorial" ? (
              <>
                <div
                  style={{
                    fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                    fontSize: 13,
                    letterSpacing: 3,
                    color: COLORS.cyan,
                    textTransform: "uppercase",
                  }}
                >
                  Flight Briefing
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    padding: "18px 20px",
                    background: COLORS.panel,
                    border: `1px solid ${COLORS.amberFaint}`,
                    maxWidth: 340,
                    minHeight: 200,
                  }}
                >
                  <div style={{ fontSize: 30 }}>{TUTORIAL_PAGES[tutorialPage].icon}</div>
                  <div
                    style={{
                      fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                      fontSize: 16,
                      letterSpacing: 1,
                      color: COLORS.amber,
                    }}
                  >
                    {TUTORIAL_PAGES[tutorialPage].title}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.cyan, lineHeight: 1.7 }}>
                    {TUTORIAL_PAGES[tutorialPage].body}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  {TUTORIAL_PAGES.map((_, i) => (
                    <span
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: i === tutorialPage ? COLORS.amber : COLORS.amberFaint,
                      }}
                    />
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  {tutorialPage > 0 && (
                    <button
                      onClick={() => setTutorialPage((p) => Math.max(0, p - 1))}
                      className="vr-btn-alt"
                      style={{
                        padding: "8px 20px",
                        background: "transparent",
                        border: `1px solid ${COLORS.cyan}`,
                        color: COLORS.cyan,
                        fontFamily: "inherit",
                        fontSize: 12,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      Back
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (tutorialPage < TUTORIAL_PAGES.length - 1) setTutorialPage((p) => p + 1);
                      else setStatus("start");
                    }}
                    className="vr-btn"
                    style={{
                      padding: "8px 20px",
                      background: "transparent",
                      border: `1px solid ${COLORS.amber}`,
                      color: COLORS.amber,
                      fontFamily: "inherit",
                      fontSize: 12,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    {tutorialPage < TUTORIAL_PAGES.length - 1 ? "Next" : "Enter Bridge"}
                  </button>
                </div>

                {tutorialPage < TUTORIAL_PAGES.length - 1 && (
                  <button
                    onClick={() => setStatus("start")}
                    style={{
                      background: "none",
                      border: "none",
                      color: COLORS.amberDim,
                      fontFamily: "inherit",
                      fontSize: 10,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Skip Briefing
                  </button>
                )}
              </>
            ) : status === "won" ? (
              <>
                <div
                  className="vr-title"
                  style={{
                    fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                    fontSize: 30,
                    fontWeight: 800,
                    letterSpacing: 3,
                    color: finalVictory ? "#7dffb0" : COLORS.green,
                    textShadow: `0 0 18px ${finalVictory ? "#7dffb0" : COLORS.green}`,
                  }}
                >
                  {finalVictory ? "MISSION ACCOMPLISHED" : "LEVEL BEATEN"}
                </div>
                <div style={{ color: COLORS.cyan, fontSize: 13, letterSpacing: 2 }}>
                  {finalVictory ? "THE MOTHERSHIP HAS FALLEN" : "MEGA THREAT NEUTRALIZED"} — SCORE {score}
                </div>
                {finalVictory && (
                  <div style={{ color: "#7dffb0", fontSize: 11, letterSpacing: 1, maxWidth: 300 }}>
                    All worlds are now open — travel freely between them from the title screen.
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  <span
                    className="vr-trophy-pop"
                    style={{ fontSize: 46, filter: `drop-shadow(0 0 14px ${COLORS.amber})` }}
                  >
                    🏆
                  </span>
                  <span
                    style={{
                      fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                      fontSize: 14,
                      letterSpacing: 2,
                      color: COLORS.amber,
                    }}
                  >
                    +1 TROPHY
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      color: COLORS.amberDim,
                    }}
                  >
                    Total: {trophies}
                  </span>
                </div>
                {runSummary && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "10px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.amberFaint}`,
                      maxWidth: 280,
                      width: "100%",
                    }}
                  >
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: COLORS.amberDim }}>
                      Run Summary
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 4,
                        fontSize: 10,
                        color: COLORS.white,
                      }}
                    >
                      <div>Wave reached: {runSummary.wave}</div>
                      <div>Asteroids: {runSummary.asteroidsDestroyed}</div>
                      <div>Bosses beaten: {runSummary.bossesBeaten}</div>
                      <div>Score: {runSummary.score}</div>
                    </div>
                    {Object.keys(runSummary.damageBySource).length > 0 && (
                      <div style={{ fontSize: 9, color: COLORS.amberDim, textAlign: "left" }}>
                        Damage taken:{" "}
                        {Object.entries(runSummary.damageBySource)
                          .sort((a, b) => b[1] - a[1])
                          .map(([cause, n]) => `${cause} (${n})`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : showShop ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    borderRadius: 999,
                    background: COLORS.panel,
                    border: `1px solid ${COLORS.amberDim}`,
                    boxShadow: "0 0 12px rgba(255,180,84,0.18)",
                  }}
                >
                  <span style={{ fontSize: 16 }}>🏆</span>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: COLORS.amberDim,
                    }}
                  >
                    Trophies
                  </span>
                  <span
                    style={{
                      fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                      fontSize: 16,
                      fontWeight: 700,
                      color: COLORS.amber,
                    }}
                  >
                    {trophies}
                  </span>
                </div>

                <div
                  className="vr-title"
                  style={{
                    fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: 3,
                    color: COLORS.amber,
                    textShadow: `0 0 16px ${COLORS.amber}`,
                  }}
                >
                  SHIP DEPOT
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {[
                    { id: "shapes", label: "Hull Forms" },
                    { id: "colors", label: "Colors" },
                    { id: "trails", label: "Trails" },
                    { id: "bullets", label: "Bullets" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setShopTab(tab.id)}
                      style={{
                        padding: "6px 14px",
                        fontFamily: "inherit",
                        fontSize: 11,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: shopTab === tab.id ? COLORS.amber : "transparent",
                        color: shopTab === tab.id ? "#0a0a0a" : COLORS.amberDim,
                        border: `1px solid ${COLORS.amberDim}`,
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    width: "100%",
                    maxWidth: 320,
                    maxHeight: 320,
                    flexShrink: 0,
                    overflowY: "auto",
                    padding: "4px 2px",
                  }}
                >
                  {shopTab === "shapes" &&
                    SHOP_SHAPES.map((item) => {
                      const owned = ownedItems.shapes.includes(item.id);
                      const equipped = shipConfig.shape === item.id;
                      const affordable = trophies >= item.cost;
                      const locked = item.secret && !owned;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 12px",
                            background: COLORS.panel,
                            border: `1px solid ${
                              item.secret ? "#e0b3ff" : item.premium ? COLORS.violetDim : COLORS.amberFaint
                            }`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <svg width="34" height="34" viewBox="0 0 100 100">
                              {locked ? (
                                <text x="50" y="64" fontSize="34" textAnchor="middle" fill={COLORS.amberDim}>
                                  ?
                                </text>
                              ) : (
                                <polygon
                                  points={SHIP_SHAPES[item.id]
                                    .map(([x, y]) => `${50 + x * 2.6},${56 + y * 2.6}`)
                                    .join(" ")}
                                  fill={shipConfig.color === "rainbow" ? "#ffb454" : shipConfig.color}
                                  fillOpacity={0.55}
                                  stroke={shipConfig.color === "rainbow" ? "#ffb454" : shipConfig.color}
                                  strokeWidth={2}
                                />
                              )}
                            </svg>
                            <div style={{ textAlign: "left" }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  letterSpacing: 1,
                                  color: item.secret ? "#e0b3ff" : item.premium ? "#e0b3ff" : COLORS.white,
                                }}
                              >
                                {locked ? "???" : item.label}
                                {item.premium ? " ✦" : ""}
                              </div>
                              <div style={{ fontSize: 9, color: COLORS.amberDim, maxWidth: 160 }}>
                                {locked
                                  ? "🔒 Hidden achievement reward"
                                  : owned
                                  ? equipped
                                    ? "Equipped"
                                    : "Owned"
                                  : `${item.cost} 🏆`}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => !locked && purchaseItem("shapes", item)}
                            disabled={locked || (!owned && !affordable)}
                            style={{
                              padding: "5px 12px",
                              fontFamily: "inherit",
                              fontSize: 10,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              cursor: locked || (!owned && !affordable) ? "not-allowed" : "pointer",
                              opacity: locked || (!owned && !affordable) ? 0.4 : 1,
                              background: equipped ? COLORS.amber : "transparent",
                              color: equipped ? "#0a0a0a" : COLORS.amber,
                              border: `1px solid ${COLORS.amber}`,
                            }}
                          >
                            {locked ? "Locked" : equipped ? "Equipped" : owned ? "Equip" : "Buy"}
                          </button>
                        </div>
                      );
                    })}

                  {shopTab === "colors" &&
                    SHOP_COLORS.map((item) => {
                      const owned = ownedItems.colors.includes(item.id);
                      const equipped = shipConfig.color === item.hex;
                      const affordable = trophies >= item.cost;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 12px",
                            background: COLORS.panel,
                            border: `1px solid ${item.isRainbow ? "#e0b3ff" : COLORS.amberFaint}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: item.isRainbow
                                  ? "conic-gradient(red, orange, yellow, green, blue, indigo, violet, red)"
                                  : item.hex,
                                border: "1px solid rgba(255,255,255,0.3)",
                              }}
                            />
                            <div style={{ textAlign: "left" }}>
                              <div style={{ fontSize: 12, letterSpacing: 1, color: COLORS.white }}>{item.label}</div>
                              <div style={{ fontSize: 9, color: COLORS.amberDim }}>
                                {owned ? (equipped ? "Equipped" : "Owned") : `${item.cost} 🏆`}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => purchaseItem("colors", item)}
                            disabled={!owned && !affordable}
                            style={{
                              padding: "5px 12px",
                              fontFamily: "inherit",
                              fontSize: 10,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              cursor: !owned && !affordable ? "not-allowed" : "pointer",
                              opacity: !owned && !affordable ? 0.4 : 1,
                              background: equipped ? COLORS.amber : "transparent",
                              color: equipped ? "#0a0a0a" : COLORS.amber,
                              border: `1px solid ${COLORS.amber}`,
                            }}
                          >
                            {equipped ? "Equipped" : owned ? "Equip" : "Buy"}
                          </button>
                        </div>
                      );
                    })}

                  {shopTab === "trails" &&
                    SHOP_TRAILS.map((item) => {
                      const owned = ownedItems.trails.includes(item.id);
                      const equipped = shipConfig.trail === item.id;
                      const affordable = trophies >= item.cost;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 12px",
                            background: COLORS.panel,
                            border: `1px solid ${COLORS.amberFaint}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 22,
                                height: 8,
                                borderRadius: 4,
                                background: `linear-gradient(90deg, ${item.hex}, transparent)`,
                              }}
                            />
                            <div style={{ textAlign: "left" }}>
                              <div style={{ fontSize: 12, letterSpacing: 1, color: COLORS.white }}>{item.label}</div>
                              <div style={{ fontSize: 9, color: COLORS.amberDim }}>
                                {owned ? (equipped ? "Equipped" : "Owned") : `${item.cost} 🏆`}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => purchaseItem("trails", item)}
                            disabled={!owned && !affordable}
                            style={{
                              padding: "5px 12px",
                              fontFamily: "inherit",
                              fontSize: 10,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              cursor: !owned && !affordable ? "not-allowed" : "pointer",
                              opacity: !owned && !affordable ? 0.4 : 1,
                              background: equipped ? COLORS.amber : "transparent",
                              color: equipped ? "#0a0a0a" : COLORS.amber,
                              border: `1px solid ${COLORS.amber}`,
                            }}
                          >
                            {equipped ? "Equipped" : owned ? "Equip" : "Buy"}
                          </button>
                        </div>
                      );
                    })}
                  {shopTab === "trails" && (
                    <button
                      onClick={() => updateShipConfig({ trail: "none" })}
                      style={{
                        padding: "6px 12px",
                        fontFamily: "inherit",
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: shipConfig.trail === "none" || !shipConfig.trail ? COLORS.amber : "transparent",
                        color: shipConfig.trail === "none" || !shipConfig.trail ? "#0a0a0a" : COLORS.amberDim,
                        border: `1px solid ${COLORS.amberDim}`,
                      }}
                    >
                      No Trail
                    </button>
                  )}

                  {shopTab === "bullets" &&
                    SHOP_BULLETS.map((item) => {
                      const owned = ownedItems.bullets.includes(item.id);
                      const equipped = shipConfig.bullet === item.id;
                      const affordable = trophies >= item.cost;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 12px",
                            background: COLORS.panel,
                            border: `1px solid ${COLORS.amberFaint}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 6,
                                height: 22,
                                borderRadius: 3,
                                background: BULLET_TYPE_COLORS[item.id],
                                boxShadow: `0 0 8px ${BULLET_TYPE_COLORS[item.id]}`,
                              }}
                            />
                            <div style={{ textAlign: "left" }}>
                              <div style={{ fontSize: 12, letterSpacing: 1, color: COLORS.white }}>{item.label}</div>
                              <div style={{ fontSize: 9, color: COLORS.amberDim, maxWidth: 160 }}>
                                {equipped ? "Equipped" : owned ? item.detail || "\u00A0" : `${item.cost} 🏆${item.detail ? ` · ${item.detail}` : ""}`}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => purchaseItem("bullets", item)}
                            disabled={!owned && !affordable}
                            style={{
                              padding: "5px 12px",
                              fontFamily: "inherit",
                              fontSize: 10,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              cursor: !owned && !affordable ? "not-allowed" : "pointer",
                              opacity: !owned && !affordable ? 0.4 : 1,
                              background: equipped ? COLORS.amber : "transparent",
                              color: equipped ? "#0a0a0a" : COLORS.amber,
                              border: `1px solid ${COLORS.amber}`,
                            }}
                          >
                            {equipped ? "Equipped" : owned ? "Equip" : "Buy"}
                          </button>
                        </div>
                      );
                    })}
                  {shopTab === "bullets" && (
                    <button
                      onClick={() => updateShipConfig({ bullet: "standard" })}
                      style={{
                        padding: "6px 12px",
                        fontFamily: "inherit",
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: shipConfig.bullet === "standard" || !shipConfig.bullet ? COLORS.amber : "transparent",
                        color: shipConfig.bullet === "standard" || !shipConfig.bullet ? "#0a0a0a" : COLORS.amberDim,
                        border: `1px solid ${COLORS.amberDim}`,
                      }}
                    >
                      Standard Bullets
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setShowShop(false)}
                  className="vr-btn-alt"
                  style={{
                    padding: "8px 22px",
                    background: "transparent",
                    border: `1px solid ${COLORS.cyan}`,
                    color: COLORS.cyan,
                    fontFamily: "inherit",
                    fontSize: 12,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Back to Home
                </button>
              </>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    borderRadius: 999,
                    background: COLORS.panel,
                    border: `1px solid ${COLORS.amberDim}`,
                    boxShadow: "0 0 12px rgba(255,180,84,0.18)",
                  }}
                >
                  <span style={{ fontSize: 16 }}>🏆</span>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: COLORS.amberDim,
                    }}
                  >
                    Trophies
                  </span>
                  <span
                    style={{
                      fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                      fontSize: 16,
                      fontWeight: 700,
                      color: COLORS.amber,
                    }}
                  >
                    {trophies}
                  </span>
                </div>
                <div
                  className="vr-title"
                  style={{
                    fontFamily: "'Orbitron', 'JetBrains Mono', sans-serif",
                    fontSize: 34,
                    fontWeight: 800,
                    letterSpacing: 3,
                    lineHeight: 1.3,
                    maxWidth: 380,
                    color: COLORS.amber,
                    textShadow: `0 0 20px ${COLORS.amber}, 0 0 46px rgba(255,180,84,0.35)`,
                  }}
                >
                  ALONE AMONG THE STARS
                </div>
              </>
            )}

            {status === "gameover" && (
              <>
                <div style={{ color: COLORS.red, fontSize: 13, letterSpacing: 2 }}>
                  SIGNAL LOST — SCORE {score} {best > 0 && `· BEST ${best}`}
                </div>
                {deathCause && (
                  <div style={{ color: COLORS.amberDim, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>
                    Destroyed by: <span style={{ color: COLORS.amber }}>{deathCause}</span>
                  </div>
                )}
                {runSummary && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "10px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.amberFaint}`,
                      maxWidth: 280,
                      width: "100%",
                    }}
                  >
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: COLORS.amberDim }}>
                      Run Summary
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 4,
                        fontSize: 10,
                        color: COLORS.white,
                      }}
                    >
                      <div>Wave reached: {runSummary.wave}</div>
                      <div>Asteroids: {runSummary.asteroidsDestroyed}</div>
                      <div>Bosses beaten: {runSummary.bossesBeaten}</div>
                      <div>Score: {runSummary.score}</div>
                    </div>
                    {Object.keys(runSummary.damageBySource).length > 0 && (
                      <div style={{ fontSize: 9, color: COLORS.amberDim, textAlign: "left" }}>
                        Damage taken:{" "}
                        {Object.entries(runSummary.damageBySource)
                          .sort((a, b) => b[1] - a[1])
                          .map(([cause, n]) => `${cause} (${n})`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {status === "start" && (
              <>
                <div style={{ fontSize: 12, color: COLORS.cyan, lineHeight: 1.9, letterSpacing: 1 }}>
                  Move to dodge · auto-fires forward
                  <br />
                  Arrow keys / WASD, or drag on mobile
                  <br />
                  <span style={{ color: COLORS.amber }}>Clear waves to level up your ship</span>
                  <br />
                  <span style={{ color: COLORS.red }}>Wave 25 brings a mega boss — beat it to win</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: COLORS.amberDim,
                    }}
                  >
                    Destination
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    {WORLD_ORDER.map((w) => {
                      const idx = WORLD_ORDER.indexOf(w);
                      const currentIdx = WORLD_ORDER.indexOf(selectedWorld);
                      const cfg = WORLDS[w];
                      const accentHex =
                        w === "wormhole" ? "#1fa85a" : w === "outworld" ? "#c026ff" : w === "frontier" ? "#4fd6ff" : COLORS.amber;

                      if (completedGame) {
                        const isCurrent = w === selectedWorld;
                        return (
                          <button
                            key={w}
                            onClick={() => chooseWorld(w)}
                            title={isCurrent ? "Currently selected" : `Travel to ${cfg.name}`}
                            style={{
                              padding: "6px 14px",
                              fontFamily: "inherit",
                              fontSize: 11,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              cursor: isCurrent ? "default" : "pointer",
                              background: isCurrent ? accentHex : "transparent",
                              color: isCurrent ? "#0a0a0a" : accentHex,
                              border: `1px solid ${accentHex}`,
                            }}
                          >
                            {cfg.name}
                          </button>
                        );
                      }

                      const isCurrent = idx === currentIdx;
                      const isPast = idx < currentIdx;
                      const isNextHop = idx === currentIdx + 1;
                      const isReachable = isNextHop && trophies >= 5;
                      const isLockedFar = idx > currentIdx + 1;
                      const disabled = isCurrent || isPast || isLockedFar || (isNextHop && trophies < 5);
                      let label = cfg.name;
                      if (isPast || (isNextHop && !isReachable) || isLockedFar) label = `🔒 ${cfg.name}`;
                      let title;
                      if (isCurrent) title = "Currently stationed here";
                      else if (isPast) title = "The hyperdrive jump was one-way";
                      else if (isLockedFar) title = `Reach ${WORLDS[WORLD_ORDER[idx - 1]].name} first`;
                      else if (isNextHop && trophies < 5) title = "Unlocks at 5 trophies";
                      else if (isNextHop) title = `Spends all ${trophies} trophies — one-way trip`;
                      return (
                        <button
                          key={w}
                          onClick={() => isReachable && chooseWorld(w)}
                          disabled={disabled}
                          title={title}
                          style={{
                            padding: "6px 14px",
                            fontFamily: "inherit",
                            fontSize: 11,
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            cursor: disabled ? (isCurrent ? "default" : "not-allowed") : "pointer",
                            opacity: isPast || isLockedFar || (isNextHop && !isReachable) ? 0.45 : 1,
                            background: isCurrent ? accentHex : "transparent",
                            color: isCurrent ? "#0a0a0a" : accentHex,
                            border: `1px solid ${accentHex}`,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {completedGame ? (
                    <div style={{ fontSize: 9, letterSpacing: 1, color: "#7dffb0", maxWidth: 280, textAlign: "center" }}>
                      Mission complete — all worlds are open. Pick any destination, any time.
                    </div>
                  ) : (
                    (() => {
                      const currentIdx = WORLD_ORDER.indexOf(selectedWorld);
                      const nextWorld = WORLD_ORDER[currentIdx + 1];
                      if (!nextWorld) {
                        return (
                          <div style={{ fontSize: 9, letterSpacing: 1, color: "#1fa85a", maxWidth: 280, textAlign: "center" }}>
                            You've gone as far as the hyperdrive can take you — beat the mothership to unlock free travel.
                          </div>
                        );
                      }
                      if (trophies < 5) {
                        return (
                          <div style={{ fontSize: 9, letterSpacing: 1, color: COLORS.amberDim }}>
                            {5 - trophies} more {5 - trophies === 1 ? "trophy" : "trophies"} to unlock {WORLDS[nextWorld].name}
                          </div>
                        );
                      }
                      return (
                        <div style={{ fontSize: 9, letterSpacing: 1, color: COLORS.red, maxWidth: 280, textAlign: "center" }}>
                          Traveling to {WORLDS[nextWorld].name} spends all {trophies} trophies and can't be undone
                        </div>
                      );
                    })()
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  {confirmRestart ? (
                    <>
                      <div style={{ fontSize: 10, letterSpacing: 1, color: COLORS.red, maxWidth: 260, textAlign: "center" }}>
                        Erase all trophies, world progress, and mission completion? This can't be undone.
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={restartGame}
                          style={{
                            padding: "5px 14px",
                            fontFamily: "inherit",
                            fontSize: 10,
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            cursor: "pointer",
                            background: COLORS.red,
                            color: "#0a0a0a",
                            border: `1px solid ${COLORS.red}`,
                          }}
                        >
                          Yes, Restart
                        </button>
                        <button
                          onClick={() => setConfirmRestart(false)}
                          style={{
                            padding: "5px 14px",
                            fontFamily: "inherit",
                            fontSize: 10,
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            cursor: "pointer",
                            background: "transparent",
                            color: COLORS.amberDim,
                            border: `1px solid ${COLORS.amberDim}`,
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmRestart(true)}
                      style={{
                        background: "none",
                        border: "none",
                        color: COLORS.amberDim,
                        fontFamily: "inherit",
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        textDecoration: "underline",
                        opacity: 0.7,
                      }}
                    >
                      Restart Game
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <button
                    onClick={() => setShowShop(true)}
                    className="vr-btn"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: `1px solid ${COLORS.amber}`,
                      color: COLORS.amber,
                      fontFamily: "inherit",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    🛒 Shop
                  </button>
                  <button
                    onClick={() => setShowOptions(true)}
                    className="vr-btn-alt"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: `1px solid ${COLORS.cyanDim}`,
                      color: COLORS.cyan,
                      fontFamily: "inherit",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    ⚙ Options
                  </button>
                  <button
                    onClick={() => setShowBossRush((v) => !v)}
                    className="vr-btn-alt"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: `1px solid ${COLORS.redDim}`,
                      color: COLORS.red,
                      fontFamily: "inherit",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    ⚔ Boss Rush
                  </button>
                  <button
                    onClick={() => setShowAchievements((v) => !v)}
                    className="vr-btn-alt"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: `1px solid ${COLORS.violetDim}`,
                      color: COLORS.violet,
                      fontFamily: "inherit",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    🏅 Stats
                  </button>
                  <button
                    onClick={() => setShowCustomize((v) => !v)}
                    className="vr-btn-alt"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: `1px solid ${COLORS.cyanDim}`,
                      color: COLORS.cyan,
                      fontFamily: "inherit",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    {showCustomize ? "Hide Customization" : "Customize Ship"}
                  </button>
                  <button
                    onClick={() => setShowPowerups((v) => !v)}
                    className="vr-btn-alt"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: `1px solid ${COLORS.cyanDim}`,
                      color: COLORS.cyan,
                      fontFamily: "inherit",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    {showPowerups ? "Hide Power-Ups" : "Power-Ups"}
                  </button>
                </div>

                {showOptions && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.cyanDim}`,
                      maxWidth: 300,
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        color: COLORS.cyan,
                      }}
                    >
                      Options
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: COLORS.white, letterSpacing: 1 }}>Sound</span>
                      <button
                        onClick={() => updateSettings({ muted: !settings.muted })}
                        style={{
                          padding: "4px 12px",
                          fontFamily: "inherit",
                          fontSize: 10,
                          letterSpacing: 1,
                          textTransform: "uppercase",
                          cursor: "pointer",
                          background: !settings.muted ? COLORS.cyan : "transparent",
                          color: !settings.muted ? "#0a0a0a" : COLORS.cyanDim,
                          border: `1px solid ${COLORS.cyan}`,
                        }}
                      >
                        {settings.muted ? "🔇 Off" : "🔊 On"}
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: COLORS.white, letterSpacing: 1 }}>Vibration</span>
                      <button
                        onClick={() => updateSettings({ vibration: !settings.vibration })}
                        style={{
                          padding: "4px 12px",
                          fontFamily: "inherit",
                          fontSize: 10,
                          letterSpacing: 1,
                          textTransform: "uppercase",
                          cursor: "pointer",
                          background: settings.vibration ? COLORS.cyan : "transparent",
                          color: settings.vibration ? "#0a0a0a" : COLORS.cyanDim,
                          border: `1px solid ${COLORS.cyan}`,
                        }}
                      >
                        {settings.vibration ? "On" : "Off"}
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: COLORS.white, letterSpacing: 1 }}>Reduce Effects</span>
                      <button
                        onClick={() => updateSettings({ reduceEffects: !settings.reduceEffects })}
                        style={{
                          padding: "4px 12px",
                          fontFamily: "inherit",
                          fontSize: 10,
                          letterSpacing: 1,
                          textTransform: "uppercase",
                          cursor: "pointer",
                          background: settings.reduceEffects ? COLORS.cyan : "transparent",
                          color: settings.reduceEffects ? "#0a0a0a" : COLORS.cyanDim,
                          border: `1px solid ${COLORS.cyan}`,
                        }}
                      >
                        {settings.reduceEffects ? "On" : "Off"}
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                      <span style={{ fontSize: 11, color: COLORS.white, letterSpacing: 1, textAlign: "left" }}>
                        Difficulty
                      </span>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        {Object.keys(DIFFICULTIES).map((key) => (
                          <button
                            key={key}
                            onClick={() => updateSettings({ difficulty: key })}
                            style={{
                              padding: "5px 12px",
                              fontFamily: "inherit",
                              fontSize: 10,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              cursor: "pointer",
                              background: settings.difficulty === key ? COLORS.cyan : "transparent",
                              color: settings.difficulty === key ? "#0a0a0a" : COLORS.cyanDim,
                              border: `1px solid ${COLORS.cyan}`,
                            }}
                          >
                            {DIFFICULTIES[key].label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => setShowOptions(false)}
                      style={{
                        marginTop: 4,
                        padding: "10px 16px",
                        fontFamily: "inherit",
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: "transparent",
                        color: COLORS.amberDim,
                        border: `1px solid ${COLORS.amberDim}`,
                      }}
                    >
                      Close
                    </button>
                  </div>
                )}

                {showBossRush && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.redDim}`,
                      maxWidth: 320,
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        color: COLORS.red,
                      }}
                    >
                      Boss Rush
                    </div>
                    <div style={{ fontSize: 9, color: COLORS.amberDim, textAlign: "center" }}>
                      Practice any boss you've reached — no waves, no trophy on the line.
                    </div>
                    {bossRushResult === "win" && (
                      <div style={{ fontSize: 10, color: "#7dffb0", letterSpacing: 1 }}>Boss defeated — nice!</div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        width: "100%",
                        maxHeight: 260,
                        flexShrink: 0,
                        overflowY: "auto",
                        padding: "2px 2px",
                      }}
                    >
                      {(completedGame
                        ? WORLD_ORDER
                        : WORLD_ORDER.slice(0, WORLD_ORDER.indexOf(selectedWorld) + 1)
                      ).map((w) => {
                        const cfg = WORLDS[w];
                        const megaLabel = w === "wormhole" ? "Mothership" : "Mega Boss";
                        return (
                          <div key={w} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ fontSize: 10, letterSpacing: 1, color: COLORS.white, textAlign: "left" }}>
                              {cfg.name}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => startBossRush(w, "normal")}
                                style={{
                                  flex: 1,
                                  padding: "6px 8px",
                                  fontFamily: "inherit",
                                  fontSize: 9,
                                  letterSpacing: 1,
                                  textTransform: "uppercase",
                                  cursor: "pointer",
                                  background: "transparent",
                                  color: COLORS.amber,
                                  border: `1px solid ${COLORS.amberDim}`,
                                }}
                              >
                                Boss
                              </button>
                              <button
                                onClick={() => startBossRush(w, "mega")}
                                style={{
                                  flex: 1,
                                  padding: "6px 8px",
                                  fontFamily: "inherit",
                                  fontSize: 9,
                                  letterSpacing: 1,
                                  textTransform: "uppercase",
                                  cursor: "pointer",
                                  background: "transparent",
                                  color: COLORS.violet,
                                  border: `1px solid ${COLORS.violetDim}`,
                                }}
                              >
                                {megaLabel}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setShowBossRush(false)}
                      style={{
                        marginTop: 4,
                        padding: "10px 16px",
                        fontFamily: "inherit",
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: "transparent",
                        color: COLORS.amberDim,
                        border: `1px solid ${COLORS.amberDim}`,
                      }}
                    >
                      Close
                    </button>
                  </div>
                )}

                {showAchievements && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.violetDim}`,
                      maxWidth: 320,
                      width: "100%",
                    }}
                  >
                    <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: COLORS.violet }}>
                      Stats & Achievements
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 6,
                        width: "100%",
                        fontSize: 9,
                        color: COLORS.amberDim,
                      }}
                    >
                      <div>Asteroids destroyed: {lifetimeStats.totalAsteroidsDestroyed}</div>
                      <div>Bosses beaten: {lifetimeStats.totalBossesBeaten}</div>
                      <div>Best wave: {lifetimeStats.bestWave}</div>
                      <div>Deaths: {lifetimeStats.totalDeaths}</div>
                      <div>Flawless boss wins: {lifetimeStats.flawlessBossWins}</div>
                      <div>Best score: {best}</div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        width: "100%",
                        maxHeight: 260,
                        flexShrink: 0,
                        overflowY: "auto",
                        padding: "4px 2px",
                      }}
                    >
                      {ACHIEVEMENTS.map((a) => {
                        const unlocked = lifetimeStats.unlocked.includes(a.id);
                        return (
                          <div
                            key={a.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "7px 10px",
                              background: unlocked ? "rgba(198,91,255,0.1)" : "transparent",
                              border: `1px solid ${unlocked ? COLORS.violetDim : "rgba(255,255,255,0.08)"}`,
                            }}
                          >
                            <span style={{ fontSize: 16, opacity: unlocked ? 1 : 0.3 }}>{unlocked ? "🏅" : "🔒"}</span>
                            <div style={{ textAlign: "left" }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  letterSpacing: 1,
                                  color: unlocked ? COLORS.white : COLORS.amberDim,
                                }}
                              >
                                {a.label}
                              </div>
                              <div style={{ fontSize: 9, color: unlocked ? COLORS.violet : "rgba(255,255,255,0.3)" }}>
                                {a.desc}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setShowAchievements(false)}
                      style={{
                        marginTop: 4,
                        padding: "10px 16px",
                        fontFamily: "inherit",
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: "transparent",
                        color: COLORS.amberDim,
                        border: `1px solid ${COLORS.amberDim}`,
                      }}
                    >
                      Close
                    </button>
                  </div>
                )}

                {showPowerups && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      padding: "12px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${selectedWorld === "frontier" ? "#2f7f99" : COLORS.amberFaint}`,
                      maxWidth: 320,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        color: selectedWorld === "frontier" ? "#4fd6ff" : COLORS.amberDim,
                      }}
                    >
                      {(WORLDS[selectedWorld] || WORLDS.homeworld).name} Power-Ups
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                      {(WORLDS[selectedWorld] || WORLDS.homeworld).powerups.map((pu) => (
                        <div key={pu.id} style={{ textAlign: "left" }}>
                          <div
                            style={{
                              fontSize: 11,
                              letterSpacing: 1,
                              color: selectedWorld === "frontier" ? "#e8fbff" : COLORS.amber,
                            }}
                          >
                            {pu.label}
                          </div>
                          <div style={{ fontSize: 10, color: COLORS.cyanDim }}>{pu.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showCustomize && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 16px",
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.amberFaint}`,
                      maxWidth: 300,
                    }}
                  >
                    <svg width="64" height="64" viewBox="0 0 100 100">
                      {shipConfig.color === "rainbow" && (
                        <defs>
                          <linearGradient id="rainbowPreview" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#ff3b30" />
                            <stop offset="20%" stopColor="#ff8c1a" />
                            <stop offset="40%" stopColor="#ffe135" />
                            <stop offset="60%" stopColor="#2ecc40" />
                            <stop offset="80%" stopColor="#3b82f6" />
                            <stop offset="100%" stopColor="#a020f0" />
                          </linearGradient>
                        </defs>
                      )}
                      <polygon
                        points={SHIP_SHAPES[shipConfig.shape]
                          .map(([x, y]) => `${50 + x * 3.1},${58 + y * 3.1}`)
                          .join(" ")}
                        fill={shipConfig.color === "rainbow" ? "url(#rainbowPreview)" : shipConfig.color}
                        fillOpacity={0.6}
                        stroke={shipConfig.color === "rainbow" ? "url(#rainbowPreview)" : shipConfig.color}
                        strokeWidth={2.2}
                      />
                    </svg>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                      {SHIP_SHAPE_LIST.map((sh) => (
                        <button
                          key={sh.id}
                          onClick={() => updateShipConfig({ shape: sh.id })}
                          style={{
                            padding: "5px 10px",
                            fontFamily: "inherit",
                            fontSize: 10,
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            cursor: "pointer",
                            background: shipConfig.shape === sh.id ? COLORS.amber : "transparent",
                            color: shipConfig.shape === sh.id ? "#0a0a0a" : COLORS.amberDim,
                            border: `1px solid ${COLORS.amberDim}`,
                          }}
                        >
                          {sh.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                      {SHIP_COLORS.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => updateShipConfig({ color: c.hex })}
                          title={c.label}
                          aria-label={c.label}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: c.hex,
                            cursor: "pointer",
                            border:
                              shipConfig.color === c.hex
                                ? `2px solid ${COLORS.white}`
                                : "1px solid rgba(255,255,255,0.25)",
                            boxShadow: shipConfig.color === c.hex ? `0 0 8px ${c.hex}` : "none",
                          }}
                        />
                      ))}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        width: "100%",
                        borderTop: `1px solid ${COLORS.amberFaint}`,
                        paddingTop: 10,
                        marginTop: 4,
                      }}
                    >
                      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: COLORS.amberDim }}>
                        Loadout Presets
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        {[0, 1, 2].map((i) => {
                          const slot = loadoutPresets[i];
                          return (
                            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                              <span style={{ fontSize: 9, color: COLORS.amberDim }}>Slot {i + 1}</span>
                              <button
                                onClick={() => (slot ? loadLoadoutSlot(i) : saveLoadoutSlot(i))}
                                title={slot ? "Equip this saved loadout" : "Save your current loadout here"}
                                style={{
                                  padding: "5px 10px",
                                  fontFamily: "inherit",
                                  fontSize: 9,
                                  letterSpacing: 1,
                                  textTransform: "uppercase",
                                  cursor: "pointer",
                                  background: slot ? "transparent" : COLORS.amberDim,
                                  color: slot ? COLORS.cyan : "#0a0a0a",
                                  border: `1px solid ${slot ? COLORS.cyan : COLORS.amberDim}`,
                                }}
                              >
                                {slot ? "Equip" : "Save"}
                              </button>
                              {slot && (
                                <button
                                  onClick={() => saveLoadoutSlot(i)}
                                  title="Overwrite this slot with your current loadout"
                                  style={{
                                    padding: "3px 8px",
                                    fontFamily: "inherit",
                                    fontSize: 8,
                                    letterSpacing: 1,
                                    textTransform: "uppercase",
                                    cursor: "pointer",
                                    background: "transparent",
                                    color: COLORS.amberDim,
                                    border: "none",
                                    textDecoration: "underline",
                                  }}
                                >
                                  Overwrite
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {status !== "tutorial" && !showShop && (
              <>
                {status === "start" && savedCheckpoint && (
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: 1,
                      color: COLORS.cyan,
                      textTransform: "uppercase",
                    }}
                  >
                    Saved run found — Wave {savedCheckpoint.wave} · Score {savedCheckpoint.score}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  {status === "start" && savedCheckpoint ? (
                <>
                  <button
                    onClick={resumeGame}
                    className="vr-btn"
                    style={{
                      padding: "10px 28px",
                      background: "transparent",
                      border: `1px solid ${COLORS.amber}`,
                      color: COLORS.amber,
                      fontFamily: "inherit",
                      fontSize: 13,
                      letterSpacing: 3,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    Resume
                  </button>
                  <button
                    onClick={startGame}
                    className="vr-btn-alt"
                    style={{
                      padding: "10px 28px",
                      background: "transparent",
                      border: `1px solid ${COLORS.cyan}`,
                      color: COLORS.cyan,
                      fontFamily: "inherit",
                      fontSize: 13,
                      letterSpacing: 3,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    New Game
                  </button>
                </>
              ) : status === "gameover" && bossRushSelection ? (
                <button
                  onClick={retryBossRush}
                  className="vr-btn"
                  style={{
                    padding: "10px 28px",
                    background: "transparent",
                    border: `1px solid ${COLORS.amber}`,
                    color: COLORS.amber,
                    fontFamily: "inherit",
                    fontSize: 13,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Retry Boss
                </button>
              ) : (
                <button
                  onClick={startGame}
                  className="vr-btn"
                  style={{
                    padding: "10px 28px",
                    background: "transparent",
                    border: `1px solid ${COLORS.amber}`,
                    color: COLORS.amber,
                    fontFamily: "inherit",
                    fontSize: 13,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {status === "start" ? "Start" : "Play Again"}
                </button>
              )}
              {status !== "start" && (
                <button
                  onClick={goHome}
                  className="vr-btn-alt"
                  style={{
                    padding: "10px 28px",
                    background: "transparent",
                    border: `1px solid ${COLORS.cyan}`,
                    color: COLORS.cyan,
                    fontFamily: "inherit",
                    fontSize: 13,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Home
                </button>
              )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ color: COLORS.amberDim, fontSize: 11, letterSpacing: 1, textAlign: "center", maxWidth: WIDTH }}>
        3 hits and the signal dies — clear a wave for a random power-up. Every 5th wave a boss
        arrives with 25% more HP than the last; at wave 25 a mega boss appears with faster fire
        and a radial burst attack. Beat it to win and earn a trophy. A system fault hits roughly
        every 15 seconds: nav lock, weapons offline, or (rarely) a hull breach.
      </div>
    </div>
  );
}
