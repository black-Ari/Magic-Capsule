// Everything the pet can do. "mood" is its main pose, "act" adds a special move on top, "prop" is the
// little thing it shows, and "say" is its bubble. All the art here is original.
const svg = (body) => `<svg viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
const screen = (body) => svg(`<rect x="31" y="72" width="38" height="17" rx="2" fill="#141a2b"/>${body}`);
const INK = '#2a2433';

export const PROPS = {
  code: screen('<path d="M40 77 L36 80.500 L40 84 M60 77 L64 80.500 L60 84 M53 76 L47 85" fill="none" stroke="#7dd3fc" stroke-width="1.800" stroke-linecap="round"/>'),
  terminal: screen('<path d="M36 76 L40 79.500 L36 83" fill="none" stroke="#4ade80" stroke-width="1.800" stroke-linecap="round"/><path d="M43 84 H52" stroke="#4ade80" stroke-width="1.800"/>'),
  sheet: screen('<path d="M35 75 H65 V86 H35 Z M35 78.700 H65 M35 82.300 H65 M45 75 V86 M55 75 V86" fill="none" stroke="#4ade80" stroke-width=".9"/>'),
  write: screen('<path d="M37 76 H63 M37 80 H63 M37 84 H54" stroke="#e2e8f0" stroke-width="1.400" stroke-linecap="round"/>'),
  slides: screen('<rect x="37" y="75" width="26" height="11" rx="1" fill="#fb923c"/><path d="M41 79 H58 M41 82.500 H52" stroke="#fff" stroke-width="1.200"/>'),
  draw: svg('<path d="M74 66 C88 62 96 72 92 80 C90 84 86 82 84 84 C82 88 76 90 72 86 C66 80 66 68 74 66 Z" fill="#f4d9b0" stroke="#a97f4c"/><circle cx="76" cy="72" r="2" fill="#ef4444"/><circle cx="83" cy="71" r="2" fill="#3b82f6"/><circle cx="88" cy="77" r="2" fill="#22c55e"/><circle cx="74" cy="80" r="2" fill="#eab308"/>'),
  phone: svg('<rect x="72" y="60" width="16" height="29" rx="3" fill="#1f2937" stroke="#9ca3af"/><rect x="74" y="64" width="12" height="20" rx="1" fill="#7dd3fc"/><path d="M76 69 H84 M76 73 H82 M76 77 H84" stroke="#fff" stroke-width="1.200"/>'),
  call: svg('<rect x="70" y="66" width="18" height="13" rx="3" fill="#2563eb"/><path d="M88 71 L95 67 V78 L88 74 Z" fill="#2563eb"/><circle cx="79" cy="72.500" r="3" fill="#bfdbfe"/>'),
  watch: svg('<path d="M72 68 H92 L88 92 H76 Z" fill="#fff" stroke="#dc2626"/><path d="M77 68 L79 92 M82 68 V92 M87 68 L85 92" stroke="#dc2626" stroke-width="2"/><circle cx="76" cy="66" r="4" fill="#fde68a"/><circle cx="83" cy="63" r="4.500" fill="#fef3c7"/><circle cx="89" cy="66" r="4" fill="#fde68a"/>'),
  game: svg('<path d="M30 76 C24 76 21 84 24 90 C27 94 31 92 34 88 H66 C69 92 73 94 76 90 C79 84 76 76 70 76 Z" fill="#374151" stroke="#111827"/><path d="M34 80 V86 M31 83 H37" stroke="#fff" stroke-width="1.800"/><circle cx="64" cy="81" r="1.800" fill="#f87171"/><circle cx="69" cy="85" r="1.800" fill="#60a5fa"/>'),
  notes: svg('<path d="M76 30 V14 L90 10 V26" fill="none" stroke="#a78bfa" stroke-width="2.400"/><ellipse cx="73" cy="31" rx="4" ry="3" fill="#a78bfa"/><ellipse cx="87" cy="27" rx="4" ry="3" fill="#a78bfa"/>'),
  browse: svg('<circle cx="80" cy="66" r="10" fill="#bae6fd" fill-opacity=".6" stroke="#475569" stroke-width="3"/><path d="M73 74 L64 86" stroke="#92400e" stroke-width="4.500" stroke-linecap="round"/>'),
  files: svg('<path d="M68 68 H78 L82 72 H96 V92 H68 Z" fill="#fbbf24" stroke="#b45309"/><path d="M68 76 H96" stroke="#b45309"/>'),
  tools: svg('<path d="M90 60 A9 9 0 0 0 78 71 L68 84 L74 90 L86 79 A9 9 0 0 0 94 66 L88 71 L84 67 Z" fill="#9ca3af" stroke="#4b5563"/>'),
  ai: svg('<path d="M82 12 Q83 26 96 28 Q83 30 82 44 Q81 30 68 28 Q81 26 82 12 Z" fill="#a78bfa"/><path d="M70 8 Q70.500 13 76 14 Q70.500 15 70 20 Q69.500 15 64 14 Q69.500 13 70 8 Z" fill="#c4b5fd"/>'),
  bulb: svg('<path d="M82 8 C93 8 97 22 88 29 V34 H76 V29 C67 22 71 8 82 8 Z" fill="#fde047" stroke="#ca8a04"/><path d="M77 37 H87 M79 40 H85" stroke="#6b7280" stroke-width="2"/>'),
  gear: svg('<g transform="translate(82 24)"><circle r="9" fill="#9ca3af" stroke="#4b5563"/><circle r="3.600" fill="#fff"/><path d="M0 -13 V-8 M0 13 V8 M-13 0 H-8 M13 0 H8 M-9 -9 L-6 -6 M9 9 L6 6 M-9 9 L-6 6 M9 -9 L6 -6" stroke="#4b5563" stroke-width="3.400"/></g>'),
  star: svg('<path d="M82 8 L86 19 L98 19 L88 26 L92 38 L82 31 L72 38 L76 26 L66 19 L78 19 Z" fill="#fde047" stroke="#ca8a04"/>'),
  confetti: svg('<g><rect x="12" y="10" width="5" height="5" fill="#f472b6" transform="rotate(20 14 12)"/><rect x="82" y="8" width="5" height="5" fill="#60a5fa" transform="rotate(40 84 10)"/><circle cx="24" cy="26" r="2.600" fill="#fde047"/><circle cx="90" cy="30" r="2.600" fill="#4ade80"/><path d="M6 36 L12 40" stroke="#a78bfa" stroke-width="3"/><path d="M92 46 L97 40" stroke="#fb923c" stroke-width="3"/><path d="M70 6 L75 3" stroke="#22d3ee" stroke-width="3"/></g>'),
  hearts: svg('<path id="h" d="M82 22 C72 14 78 6 82 11 C86 6 92 14 82 22 Z" fill="#fb7185"/><path d="M16 30 C9 24 13 19 16 22 C19 19 23 24 16 30 Z" fill="#fda4af"/><path d="M92 40 C87 36 90 32 92 34 C94 32 97 36 92 40 Z" fill="#fda4af"/>'),
  sweat: svg('<path d="M18 24 C14 30 13 33 16 35 C19 37 22 33 21 30 Z" fill="#7dd3fc"/><path d="M84 28 C81 33 80 35 83 37 C85 38 88 35 87 33 Z" fill="#7dd3fc"/>'),
  coffee: svg('<path d="M70 72 H88 V84 C88 90 84 92 79 92 C74 92 70 90 70 84 Z" fill="#fff" stroke="#6b7280"/><path d="M88 75 C96 74 96 85 88 84" fill="none" stroke="#6b7280" stroke-width="2"/><rect x="72" y="74" width="14" height="3" fill="#7c4a24"/><path d="M75 68 Q73 64 75 60 M82 68 Q80 64 82 60" fill="none" stroke="#cbd5e1" stroke-width="1.600"/>'),
  water: svg('<path d="M71 62 H90 L87 92 H74 Z" fill="#e0f2fe" fill-opacity=".7" stroke="#60a5fa"/><path d="M72.500 72 H88.500 L87 92 H74 Z" fill="#60a5fa" fill-opacity=".7"/>'),
  food: svg('<path d="M68 76 H96 C96 88 88 92 82 92 C76 92 68 88 68 76 Z" fill="#fff" stroke="#9ca3af"/><path d="M71 76 C72 68 92 68 93 76 Z" fill="#fbbf24"/><path d="M92 68 L78 52 M96 66 L82 50" stroke="#92400e" stroke-width="1.800"/>'),
  umbrella: svg('<path d="M14 26 C20 0 80 0 86 26 Q78 18 68 26 Q59 18 50 26 Q41 18 32 26 Q22 18 14 26 Z" fill="#60a5fa" stroke="#1d4ed8"/><path d="M50 3 V-4" stroke="#1d4ed8" stroke-width="2"/><path d="M6 44 L3 52 M93 42 L90 50 M98 62 L95 70 M2 66 L-1 74" stroke="#7dd3fc" stroke-width="2.400" stroke-linecap="round"/>'),
  snow: svg('<g fill="#e0f2fe" stroke="#93c5fd" stroke-width=".6"><circle cx="10" cy="20" r="3"/><circle cx="90" cy="14" r="3.600"/><circle cx="96" cy="46" r="2.600"/><circle cx="4" cy="52" r="3"/></g>'),
  shades: svg('<path d="M27 35 H48 L47 47 Q38 51 30 47 Z M52 35 H73 L70 47 Q62 51 53 47 Z" fill="#111827"/><path d="M48 38 H52" stroke="#111827" stroke-width="2.400"/><path d="M32 38 L38 38 M57 38 L63 38" stroke="#6b7280" stroke-width="1.800"/>'),
  sun: svg('<circle cx="84" cy="20" r="9" fill="#fde047" stroke="#ca8a04"/><path d="M84 3 V7 M84 33 V37 M67 20 H71 M97 20 H101 M72 8 L75 11 M93 29 L96 32 M72 32 L75 29 M93 11 L96 8" stroke="#ca8a04" stroke-width="2.400" stroke-linecap="round"/>'),
  moon: svg('<path d="M86 6 A16 16 0 1 0 98 30 A12.500 12.500 0 1 1 86 6 Z" fill="#fde68a" stroke="#ca8a04"/><circle cx="70" cy="12" r="1.600" fill="#fde68a"/>'),
  nightcap: svg('<path d="M24 22 C30 2 62 -6 88 14 L92 24 C82 14 72 13 76 22 Z" fill="#4f46e5" stroke="#312e81"/><path d="M22 24 Q50 12 78 24" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="93" cy="26" r="4.500" fill="#fff"/>'),
  shield: svg('<path d="M82 10 L96 15 V28 C96 38 90 43 82 47 C74 43 68 38 68 28 V15 Z" fill="#22c55e" stroke="#15803d"/><path d="M75 28 L80 34 L90 21" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'),
  rocket: svg('<path d="M82 4 C92 14 92 28 88 38 H76 C72 28 72 14 82 4 Z" fill="#f1f5f9" stroke="#64748b"/><circle cx="82" cy="20" r="4" fill="#38bdf8" stroke="#64748b"/><path d="M76 30 L68 40 L76 38 M88 30 L96 40 L88 38" fill="#ef4444"/><path d="M78 39 Q82 52 86 39 Z" fill="#fb923c"/>'),
  leaf: svg('<path d="M70 42 C66 22 80 10 96 8 C98 26 88 42 70 42 Z" fill="#4ade80" stroke="#15803d"/><path d="M70 42 C76 32 84 22 92 14" fill="none" stroke="#15803d"/>'),
  plane: svg('<path d="M60 22 L96 8 L88 16 L90 34 L82 36 L78 22 L68 26 L66 32 L60 32 Z" fill="#e2e8f0" stroke="#475569"/>'),
  wifi: svg('<path d="M66 22 C76 12 90 12 100 22 M71 28 C78 21 88 21 95 28 M76 34 C80 30 86 30 90 34" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round"/><circle cx="83" cy="39" r="2.600" fill="#22c55e"/>'),
  noWifi: svg('<path d="M66 22 C76 12 90 12 100 22 M71 28 C78 21 88 21 95 28 M76 34 C80 30 86 30 90 34" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/><path d="M68 10 L98 40" stroke="#ef4444" stroke-width="3.400" stroke-linecap="round"/>'),
  bluetooth: svg('<circle cx="82" cy="24" r="16" fill="#2563eb"/><path d="M75 17 L89 31 L82 38 V10 L89 17 L75 31" fill="none" stroke="#fff" stroke-width="2.400"/>'),
  hotspot: svg('<circle cx="82" cy="26" r="3.400" fill="#a78bfa"/><path d="M73 35 A12 12 0 0 1 73 17 M91 17 A12 12 0 0 1 91 35 M67 41 A21 21 0 0 1 67 11 M97 11 A21 21 0 0 1 97 41" fill="none" stroke="#a78bfa" stroke-width="2.600" stroke-linecap="round"/>'),
  camera: svg('<rect x="66" y="14" width="22" height="18" rx="4" fill="#475569"/><path d="M88 20 L98 14 V32 L88 26 Z" fill="#475569"/><circle cx="77" cy="23" r="5" fill="#bae6fd"/>'),
  bell: svg('<path d="M82 8 C92 8 94 18 94 26 L98 34 H66 L70 26 C70 18 72 8 82 8 Z" fill="#fbbf24" stroke="#b45309"/><circle cx="82" cy="38" r="3.400" fill="#b45309"/>'),
  lowBattery: svg('<rect x="66" y="14" width="28" height="16" rx="3" fill="none" stroke="#ef4444" stroke-width="2.400"/><rect x="95" y="19" width="3" height="6" fill="#ef4444"/><rect x="69" y="17" width="6" height="10" fill="#ef4444"/>'),
  plug: svg('<path d="M86 8 L72 28 H82 L76 44 L94 20 H84 Z" fill="#fde047" stroke="#ca8a04"/>'),
  gift: svg('<rect x="68" y="68" width="26" height="24" rx="3" fill="#f472b6" stroke="#be185d"/><path d="M81 68 V92 M68 79 H94" stroke="#fde047" stroke-width="3.400"/><path d="M81 68 C72 60 70 68 81 68 C92 68 90 60 81 68 Z" fill="#fde047" stroke="#ca8a04"/>'),
  box: svg('<path d="M68 72 L82 66 L96 72 V88 L82 94 L68 88 Z" fill="#d6a56b" stroke="#8a5a2b"/><path d="M68 72 L82 78 L96 72 M82 78 V94" fill="none" stroke="#8a5a2b"/>'),
  copy: svg('<rect x="70" y="10" width="17" height="21" rx="2" fill="#e2e8f0" stroke="#64748b"/><rect x="77" y="17" width="17" height="21" rx="2" fill="#fff" stroke="#64748b"/><path d="M81 24 H90 M81 29 H90" stroke="#94a3b8" stroke-width="1.600"/>'),
  ball: svg('<g class="prop-bounce"><circle cx="84" cy="84" r="9" fill="#ef4444" stroke="#991b1b"/><path d="M75 84 Q84 76 93 84 M84 75 V93" fill="none" stroke="#fff" stroke-width="1.800"/></g>'),
  dizzy: svg('<path d="M30 12 L32 17 L37 17 L33 20 L35 25 L30 22 L25 25 L27 20 L23 17 L28 17 Z" fill="#fde047" stroke="#ca8a04"/><path d="M70 8 L72 13 L77 13 L73 16 L75 21 L70 18 L65 21 L67 16 L63 13 L68 13 Z" fill="#fde047" stroke="#ca8a04"/>'),
  headband: svg('<path d="M23 27 Q50 15 77 27 L78 34 Q50 22 22 34 Z" fill="#ef4444" stroke="#991b1b"/><path d="M78 32 L92 26 M78 34 L91 37" stroke="#ef4444" stroke-width="3.400" stroke-linecap="round"/>'),
  loud: svg('<path d="M68 22 H74 L82 15 V37 L74 30 H68 Z" fill="#475569"/><path d="M86 19 Q91 26 86 33 M91 14 Q99 26 91 38" fill="none" stroke="#475569" stroke-width="2.600" stroke-linecap="round"/>'),
  quiet: svg('<path d="M72 22 H78 L86 15 V37 L78 30 H72 Z" fill="#94a3b8"/><path d="M90 20 Q94 26 90 32" fill="none" stroke="#94a3b8" stroke-width="2.400" stroke-linecap="round"/>'),
  muted: svg('<path d="M68 22 H74 L82 15 V37 L74 30 H68 Z" fill="#94a3b8"/><path d="M87 20 L97 32 M97 20 L87 32" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>'),
  zzz: svg(`<text x="74" y="22" font-size="14" font-weight="800" fill="#a5b4fc" font-family="Segoe UI, sans-serif">z</text><text x="84" y="12" font-size="10" font-weight="800" fill="#c7d2fe" font-family="Segoe UI, sans-serif">z</text><circle cx="1" cy="1" r="0" fill="${INK}"/>`),
};

// Matched against the app name that Screen Time already reads. Window titles are never used.
export const APPS = [
  [/visual studio|vscode|\bcode\b|cursor|android studio|intellij|pycharm|sublime|notepad\+\+/i, 'typing', { prop: 'code' }],
  [/terminal|powershell|command prompt|\bcmd\b|git bash/i, 'typing', { prop: 'terminal' }],
  [/excel|sheets/i, 'typing', { prop: 'sheet' }],
  [/powerpoint|impress/i, 'typing', { prop: 'slides' }],
  [/word|wps|writer|notepad|onenote/i, 'typing', { prop: 'write' }],
  [/zoom|teams|skype|google meet/i, 'chat', { prop: 'call', act: 'wave' }],
  [/whatsapp|telegram|discord|signal|slack|messenger|instagram/i, 'chat', { prop: 'phone' }],
  [/photoshop|figma|canva|paint|illustrator|gimp|blender|inkscape|davinci|premiere|capcut/i, 'typing', { prop: 'draw' }],
  [/vlc|media player|netflix|prime video|hotstar|youtube|potplayer|mpv/i, 'looking', { prop: 'watch' }],
  [/spotify|apple music|wynk|gaana|jiosaavn/i, 'dance', { prop: 'notes' }],
  [/steam|epic games|valorant|minecraft|roblox|fortnite|pubg|bgmi|gta|xbox|riot client|counter-strike/i, 'typing', { prop: 'game', act: 'game' }],
  [/calculator/i, 'idle', {}],
  [/chrome|edge|firefox|brave|opera|vivaldi|\barc\b/i, 'looking', { prop: 'browse' }],
  [/explorer/i, 'looking', { prop: 'files' }],
  [/settings|control panel|task manager/i, 'looking', { prop: 'tools' }],
  [/claude|chatgpt|gemini|copilot/i, 'chat', { prop: 'ai' }],
];

export const appAct = (app) => {
  const match = APPS.find(([pattern]) => pattern.test(app));
  return match ? { mood: match[1], ...match[2] } : null;
};

// Short reactions. "soft" ones step aside as soon as you do something.
export const EVENTS = {
  copied: { mood: 'nod', prop: 'copy', say: 'Copied!', ms: 1300 },
  lockKey: { mood: 'nod', say: 'Aa', ms: 900 },
  louder: { mood: 'nod', prop: 'loud', ms: 900 },
  softer: { mood: 'nod', prop: 'quiet', ms: 900 },
  tooLoud: { mood: 'nod', prop: 'loud', act: 'cover', say: 'Loud!', ms: 1300 },
  muted: { mood: 'nod', prop: 'muted', act: 'shush', say: 'Shh', ms: 1300 },
  shelf: { mood: 'nod', prop: 'box', say: 'Got it', ms: 1300 },
  taskDone: { mood: 'happy', prop: 'confetti', say: 'Done!', ms: 3000 },
  timerDone: { mood: 'happy', prop: 'bell', say: 'Time up!', ms: 3000 },
  fileArrived: { mood: 'happy', prop: 'gift', say: 'New file!', ms: 3000 },
  drink: { mood: 'happy', act: 'drink', prop: 'water', say: 'Gulp!', ms: 3000 },
  charging: { mood: 'happy', prop: 'plug', say: 'Yum, power!', ms: 3000 },
  lowBattery: { mood: 'worried', act: 'sad', prop: 'lowBattery', say: 'So tired', ms: 5000 },
  memoryFull: { mood: 'worried', prop: 'sweat', say: 'Too full!', ms: 5000 },
  reminder: { mood: 'alert', prop: 'bell', say: 'Look!', ms: 4000 },
  aiDone: { mood: 'happy', prop: 'star', say: 'Done!', ms: 3000 },
  aiFailed: { mood: 'worried', act: 'dizzy', prop: 'dizzy', say: 'Oops', ms: 4000 },
  aiAsks: { mood: 'alert', prop: 'bulb', say: 'Allow?', ms: 4000 },
  petted: { mood: 'idle', act: 'love', prop: 'hearts', say: 'Purr', ms: 1500, soft: true },
  welcomeBack: { mood: 'idle', act: 'wave', say: 'You are back!', ms: 1800, soft: true },
  happy: { mood: 'happy', ms: 3000 },
  alert: { mood: 'alert', ms: 4000 },
  nod: { mood: 'nod', ms: 900 },
  worried: { mood: 'worried', ms: 5000 },
};

const CONTROL = {
  wifi: [{ mood: 'happy', prop: 'wifi', say: 'Online!', ms: 2200 }, { mood: 'worried', act: 'sad', prop: 'noWifi', say: 'Offline', ms: 2500 }],
  bluetooth: [{ mood: 'nod', prop: 'bluetooth', ms: 1500 }, { mood: 'nod', act: 'sad', ms: 1200 }],
  flight: [{ mood: 'happy', prop: 'plane', say: 'Whoosh!', ms: 2200 }, { mood: 'nod', prop: 'wifi', ms: 1300 }],
  hotspot: [{ mood: 'happy', prop: 'hotspot', say: 'Sharing!', ms: 2200 }, { mood: 'nod', ms: 900 }],
  vpn: [{ mood: 'nod', act: 'cool', prop: 'shield', say: 'Hidden', ms: 2200 }, { mood: 'nod', ms: 900 }],
  dark: [{ mood: 'nod', prop: 'nightcap', say: 'Dark mode', ms: 2200 }, { mood: 'nod', act: 'stretch', prop: 'sun', say: 'Bright!', ms: 2200 }],
  nightLight: [{ mood: 'nod', prop: 'moon', say: 'Cozy', ms: 2200 }, { mood: 'nod', prop: 'sun', ms: 1300 }],
  quiet: [{ mood: 'nod', act: 'shush', say: 'Shh', ms: 2200 }, { mood: 'nod', prop: 'bell', ms: 1300 }],
  camera: [{ mood: 'nod', prop: 'camera', ms: 1500 }, { mood: 'nod', act: 'cover', say: 'No peeking', ms: 2200 }],
  keepAwake: [{ mood: 'nod', prop: 'coffee', say: 'Wide awake', ms: 2200 }, { mood: 'nod', act: 'yawn', ms: 1600 }],
  power: [{ mood: 'happy', prop: 'rocket', say: 'Zoom!', ms: 2200 }, { mood: 'nod', prop: 'leaf', ms: 1500 }],
};

export const controlAct = ({ id, on }) => CONTROL[id]?.[on ? 0 : 1] || EVENTS.nod;

export function greeting(hour, name = '') {
  const from = name ? `, I'm ${name}` : '';
  if (hour < 5) return { mood: 'idle', act: 'yawn', prop: 'nightcap', say: 'Still up?', ms: 1800, soft: true };
  if (hour < 12) return { mood: 'idle', act: 'wave', say: name ? `Morning${from}!` : 'Good morning!', ms: 1800, soft: true };
  if (hour < 17) return { mood: 'idle', act: 'wave', say: `Hello${from}!`, ms: 1800, soft: true };
  if (hour < 21) return { mood: 'idle', act: 'wave', say: name ? `Evening${from}!` : 'Good evening!', ms: 1800, soft: true };
  return { mood: 'idle', act: 'wave', prop: 'nightcap', say: 'Good night!', ms: 1800, soft: true };
}

// What it weather-watches for, from the forecast the Weather tool already has.
export function weatherAct(code) {
  if (code >= 51 && code <= 67) return { act: 'peek', prop: 'umbrella' };
  if (code >= 80 && code <= 82) return { act: 'peek', prop: 'umbrella' };
  if (code >= 95) return { act: 'sad', prop: 'umbrella' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { act: 'stretch', prop: 'snow' };
  if (code === 0) return { act: 'cool', prop: 'shades' };
  return null;
}

const GAMES = [
  { act: 'yawn' }, { act: 'stretch' }, { act: 'peek' }, { act: 'wag' }, { act: 'scratch' }, { act: 'spin' }, { act: 'ball', prop: 'ball' }, { act: 'wave' },
  { act: 'read', prop: 'browse' }, { act: 'ball', prop: 'gift' }, { act: 'drink', prop: 'water' }, { act: 'peek', prop: 'star' }, { act: 'stretch', prop: 'notes' },
];

// A little something to do when nothing is happening, which changes with the time of day.
export function fidgetAct(hour, weather) {
  const choices = [...GAMES];
  if (hour >= 7 && hour < 11) choices.push({ act: 'drink', prop: 'coffee' });
  if (hour >= 12 && hour < 15) choices.push({ act: 'eat', prop: 'food' });
  if (hour >= 16 && hour < 18) choices.push({ act: 'drink', prop: 'coffee' });
  if (hour >= 22 || hour < 5) choices.push({ act: 'yawn', prop: 'nightcap' }, { act: 'yawn', prop: 'zzz' });
  if (weather) choices.push(weather, weather);
  return choices[Math.floor(Math.random() * choices.length)];
}

// For "Try a reaction" in Settings.
export const TRY_EVENTS = [
  ['Finished a task', EVENTS.taskDone], ['Copied something', EVENTS.copied], ['Reminder', EVENTS.reminder], ['Low battery', EVENTS.lowBattery],
  ['Charger plugged in', EVENTS.charging], ['Memory full', EVENTS.memoryFull], ['AI finished', EVENTS.aiDone], ['AI failed', EVENTS.aiFailed],
  ['Wi-Fi on', CONTROL.wifi[0]], ['Wi-Fi off', CONTROL.wifi[1]], ['Dark mode on', CONTROL.dark[0]], ['VPN on', CONTROL.vpn[0]], ['Do not disturb', CONTROL.quiet[0]],
  ['Camera off', CONTROL.camera[1]], ['Best performance', CONTROL.power[0]], ['Drinks water', EVENTS.drink], ['Writing code', { mood: 'typing', prop: 'code' }],
  ['Watching a video', { mood: 'looking', prop: 'watch' }], ['Playing a game', { mood: 'typing', act: 'game', prop: 'game' }], ['Message app', { mood: 'chat', prop: 'phone' }],
  ['Rain outside', { mood: 'idle', act: 'peek', prop: 'umbrella' }], ['Sunny outside', { mood: 'idle', act: 'cool', prop: 'shades' }], ['Lunch time', { mood: 'idle', act: 'eat', prop: 'food' }],
  ['Plays with a ball', { mood: 'idle', act: 'ball', prop: 'ball' }], ['Gets petted', EVENTS.petted], ['Sleepy', { mood: 'idle', act: 'yawn', prop: 'nightcap' }],
];
