// Builds the pet out of layered SVG parts. Every part here is original artwork. Only listed option
// values and checked colours reach the markup, so a saved avatar can never inject anything.
const pick = (...pairs) => pairs;

export const OPTIONS = {
  base: pick(['cat', 'Cat'], ['dog', 'Dog'], ['bunny', 'Bunny'], ['bear', 'Bear'], ['panda', 'Panda'], ['monkey', 'Monkey'], ['elephant', 'Elephant'], ['fox', 'Fox'], ['penguin', 'Penguin'], ['hamster', 'Hamster'], ['chick', 'Chick'], ['robot', 'Robot'], ['person', 'Person']),
  eyes: pick(['sparkle', 'Sparkly'], ['big', 'Big'], ['round', 'Round'], ['happy', 'Smiling'], ['gentle', 'Gentle']),
  mouth: pick(['w', 'Tiny w'], ['smile', 'Smile'], ['small', 'Small'], ['open', 'Open'], ['cat', 'Cat']),
  hair: pick(['none', 'None'], ['short', 'Short'], ['spiky', 'Spiky'], ['long', 'Long'], ['bun', 'Bun'], ['jata', 'Tied up high']),
  head: pick(['none', 'None'], ['crown', 'Crown'], ['mukut', 'Mukut'], ['feather', 'Mukut with feather'], ['tiara', 'Tiara'], ['cap', 'Cap'], ['headphones', 'Headphones'], ['hood', 'Hood'], ['halo', 'Halo'], ['horns', 'Horns'], ['ribbon', 'Ribbon'], ['flower', 'Flower']),
  face: pick(['none', 'None'], ['glasses', 'Glasses'], ['shades', 'Sunglasses'], ['mask', 'Eye mask'], ['visor', 'Visor'], ['tilak', 'Tilak'], ['bindi', 'Bindi'], ['thirdEye', 'Third eye']),
  neck: pick(['none', 'None'], ['scarf', 'Scarf'], ['necklace', 'Gold necklace'], ['mala', 'Mala'], ['garland', 'Flower garland'], ['bow', 'Bow tie'], ['bell', 'Bell collar']),
  outfit: pick(['none', 'None'], ['tshirt', 'T-shirt'], ['hoodie', 'Hoodie'], ['hero', 'Hero suit'], ['kurta', 'Kurta'], ['dhoti', 'Dhoti'], ['saree', 'Saree']),
  emblem: pick(['none', 'None'], ['star', 'Star'], ['bolt', 'Bolt'], ['moon', 'Moon'], ['wave', 'Wave'], ['flame', 'Flame'], ['heart', 'Heart'], ['om', 'Om']),
  cape: pick(['none', 'None'], ['short', 'Short'], ['long', 'Long']),
  item: pick(['none', 'None'], ['flute', 'Flute'], ['mace', 'Mace'], ['trident', 'Trident'], ['lotus', 'Lotus'], ['modak', 'Modak'], ['book', 'Book'], ['sword', 'Sword'], ['staff', 'Glowing staff']),
  aura: pick(['none', 'None'], ['gold', 'Gold'], ['blue', 'Blue'], ['rose', 'Rose']),
};

export const COLOR_FIELDS = pick(
  ['skin', 'Skin or fur'], ['accent', 'Ears and tail'], ['belly', 'Belly and muzzle'], ['eyeColor', 'Eyes'],
  ['hairColor', 'Hair'], ['outfitColor', 'Outfit'], ['capeColor', 'Cape'],
);

export const DEFAULT_AVATAR = {
  base: 'cat', skin: '#e8964a', accent: '#c9742c', belly: '#f8dcb6', eyes: 'sparkle', eyeColor: '#2a1c14', mouth: 'w',
  hair: 'none', hairColor: '#2a2230', head: 'none', face: 'none', neck: 'none',
  outfit: 'none', outfitColor: '#2563eb', emblem: 'none', cape: 'none', capeColor: '#dc2626', item: 'none', aura: 'none', calm: false,
};

const HEX = /^#[0-9a-f]{6}$/i;

export function normalize(raw = {}) {
  const avatar = { ...DEFAULT_AVATAR };
  for (const [key, choices] of Object.entries(OPTIONS)) {
    if (choices.some(([value]) => value === raw[key])) avatar[key] = raw[key];
  }
  for (const [key] of COLOR_FIELDS) if (HEX.test(raw[key])) avatar[key] = raw[key];
  avatar.calm = raw.calm === true;
  return avatar;
}

function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255]
    .map((channel) => Math.round(amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

const GOLD = '#e8b923';
const GOLD_DARK = '#a87c12';
const INK = '#2a1c14';

function ears(a, fill, line) {
  const p = `fill="${shade(a.accent, 0.08)}" stroke="${line}" stroke-width="1.200"`;
  const inner = '#f7b6c2';
  switch (a.base) {
    case 'cat': case 'fox': return `<path class="ear" d="M30 36 L26 8 L50 23 Z" ${p}/><path class="ear" d="M70 36 L74 8 L50 23 Z" ${p}/><path d="M33 30 L30 15 L43 24 Z" fill="${inner}"/><path d="M67 30 L70 15 L57 24 Z" fill="${inner}"/>`;
    case 'dog': return `<path class="ear" d="M32 25 C16 23 12 45 20 56 C29 58 33 42 36 31 Z" ${p}/><path class="ear" d="M68 25 C84 23 88 45 80 56 C71 58 67 42 64 31 Z" ${p}/>`;
    case 'bunny': return `<ellipse class="ear" cx="38" cy="13" rx="7" ry="19" ${p}/><ellipse class="ear" cx="62" cy="13" rx="7" ry="19" ${p}/><ellipse cx="38" cy="14" rx="3.500" ry="13" fill="${inner}"/><ellipse cx="62" cy="14" rx="3.500" ry="13" fill="${inner}"/>`;
    case 'bear': case 'panda': case 'hamster': return `<circle class="ear" cx="30" cy="25" r="9.500" ${p}/><circle class="ear" cx="70" cy="25" r="9.500" ${p}/><circle cx="30" cy="26" r="5" fill="${inner}"/><circle cx="70" cy="26" r="5" fill="${inner}"/>`;
    case 'penguin': case 'chick': return '';
    case 'elephant': return `<ellipse class="ear" cx="19" cy="44" rx="15" ry="20" ${p}/><ellipse class="ear" cx="81" cy="44" rx="15" ry="20" ${p}/><ellipse cx="19" cy="44" rx="9" ry="14" fill="${inner}"/><ellipse cx="81" cy="44" rx="9" ry="14" fill="${inner}"/>`;
    case 'monkey': return `<circle class="ear" cx="25" cy="44" r="9.500" ${p}/><circle class="ear" cx="75" cy="44" r="9.500" ${p}/><circle cx="25" cy="44" r="5.500" fill="${inner}"/><circle cx="75" cy="44" r="5.500" fill="${inner}"/>`;
    case 'robot': return `<path d="M50 21 V10" stroke="${line}" stroke-width="2.500"/><circle class="ear" cx="50" cy="8" r="4" fill="${a.eyeColor}"/><rect x="20" y="38" width="7" height="14" rx="3" ${p}/><rect x="73" y="38" width="7" height="14" rx="3" ${p}/>`;
    default: return `<circle cx="27" cy="46" r="4.500" fill="${fill}" stroke="${line}"/><circle cx="73" cy="46" r="4.500" fill="${fill}" stroke="${line}"/>`;
  }
}

function tail(a, line) {
  const color = a.accent;
  switch (a.base) {
    case 'cat': return `<path class="tail" d="M71 80 C93 80 95 57 82 48" stroke="${color}"/>`;
    case 'dog': return `<path class="tail" d="M71 76 C82 74 86 66 85 58" stroke="${color}"/>`;
    case 'monkey': return `<path class="tail" d="M71 84 C96 86 96 60 84 60 C78 60 78 68 84 68" stroke="${color}"/>`;
    case 'elephant': return `<path class="tail thin" d="M73 80 C80 82 82 88 80 94" stroke="${color}"/>`;
    case 'bunny': return `<circle cx="74" cy="84" r="6" fill="${a.belly}" stroke="${line}"/>`;
    case 'fox': return `<g class="tail" style="fill:${color};stroke:${line};stroke-width:1"><path d="M68 86 C90 92 100 70 88 52 C84 66 76 72 68 74 Z"/><path d="M88 52 C90 58 92 62 92 67 C89 66 86 63 84 60 Z" style="fill:#fff;stroke:none"/></g>`;
    default: return '';
  }
}

function hairBack(a, line) {
  if (a.hair === 'long') return `<path d="M25 44 C22 16 78 16 75 44 C78 60 76 72 70 76 L30 76 C24 72 22 60 25 44 Z" fill="${a.hairColor}" stroke="${line}" stroke-width=".800"/>`;
  return '';
}

function hairFront(a) {
  const color = a.hairColor;
  const hi = shade(color, 0.22);
  switch (a.hair) {
    case 'short': return `<path d="M27 42 C25 15 75 15 73 42 C66 30 56 27 46 28 C38 29 31 33 27 42 Z" fill="${color}"/><path d="M36 25 Q45 20 55 22" fill="none" stroke="${hi}" stroke-width="1.500" stroke-linecap="round"/>`;
    case 'spiky': return `<path d="M27 42 L24 26 L33 29 L33 15 L42 24 L50 11 L58 24 L67 15 L67 29 L76 26 L73 42 C64 31 36 31 27 42 Z" fill="${color}"/>`;
    case 'long': return `<path d="M27 44 C26 18 74 18 73 44 C70 33 60 27 50 29 C40 27 30 33 27 44 Z" fill="${color}"/>`;
    case 'bun': return `<circle cx="50" cy="14" r="8.500" fill="${color}"/><path d="M27 42 C25 17 75 17 73 42 C66 30 34 30 27 42 Z" fill="${color}"/>`;
    case 'jata': return `<path d="M42 24 C38 10 44 2 50 2 C56 2 62 10 58 24 Z" fill="${color}"/><path d="M27 42 C25 17 75 17 73 42 C66 31 34 31 27 42 Z" fill="${color}"/><path d="M45 9 Q50 14 56 9" fill="none" stroke="${hi}" stroke-width="1.300"/><path d="M58 6 A6 6 0 1 0 63 15 A4.500 4.500 0 1 1 58 6 Z" fill="#eef3f8" stroke="#9fb0c0" stroke-width=".500"/>`;
    default: return '';
  }
}

function headwearBack(a) {
  return a.head === 'hood' ? `<path d="M19 50 C15 12 85 12 81 50 C82 62 74 70 50 70 C26 70 18 62 19 50 Z" fill="${a.outfitColor}" stroke="${shade(a.outfitColor, -0.35)}"/>` : '';
}

function headwear(a) {
  const gold = `fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width=".900"`;
  const mukut = `<path d="M31 29 Q50 20 69 29 L64 13 Q57 -3 50 -6 Q43 -3 36 13 Z" ${gold}/><path d="M33 28 Q50 20 67 28" fill="none" stroke="#b81d2a" stroke-width="2.400"/><circle cx="50" cy="13" r="3.600" fill="#d92b3a" stroke="#fbe7a1" stroke-width=".800"/><circle cx="41" cy="20" r="1.700" fill="#2f9e6e"/><circle cx="59" cy="20" r="1.700" fill="#2f9e6e"/>`;
  switch (a.head) {
    case 'crown': return `<path d="M31 27 L35 11 L43 21 L50 7 L57 21 L65 11 L69 27 Q50 21 31 27 Z" ${gold}/><circle cx="50" cy="20" r="2.300" fill="#d92b3a"/><circle cx="39" cy="23" r="1.500" fill="#2f9e6e"/><circle cx="61" cy="23" r="1.500" fill="#2f9e6e"/>`;
    case 'mukut': return mukut;
    case 'feather': return `<g transform="rotate(18 62 6)"><ellipse cx="62" cy="1" rx="6" ry="14" fill="#1f8a70"/><ellipse cx="62" cy="-5" rx="4" ry="6" fill="#1d4ed8"/><ellipse cx="62" cy="-5" rx="1.800" ry="2.800" fill="#fbbf24"/></g>${mukut}`;
    case 'tiara': return `<path d="M31 31 Q50 18 69 31 Q50 25 31 31 Z" fill="#dfe6ee" stroke="#9fb0c0" stroke-width=".700"/><path d="M50 15 L53 23 L50 26 L47 23 Z" fill="#7dd3fc" stroke="#9fb0c0" stroke-width=".500"/>`;
    case 'cap': return `<path d="M28 33 Q30 15 50 15 Q70 15 72 33 Z" fill="${a.outfitColor}"/><path d="M26 33 Q50 26 84 36 Q60 37 26 36 Z" fill="${shade(a.outfitColor, -0.25)}"/>`;
    case 'headphones': return `<path d="M26 44 C24 12 76 12 74 44" fill="none" stroke="#2d3340" stroke-width="4"/><rect x="20" y="38" width="9" height="17" rx="4" fill="#3b4454"/><rect x="71" y="38" width="9" height="17" rx="4" fill="#3b4454"/>`;
    case 'hood': return `<path d="M26 44 C28 22 72 22 74 44 C66 32 34 32 26 44 Z" fill="${shade(a.outfitColor, 0.1)}"/>`;
    case 'halo': return `<ellipse cx="50" cy="13" rx="17" ry="4.500" fill="none" stroke="${GOLD}" stroke-width="3"/>`;
    case 'ribbon': return `<g transform="translate(66 24) rotate(18)"><path d="M0 0 L-10 -6 V6 Z M0 0 L10 -6 V6 Z" fill="#f472b6" stroke="#be3d84" stroke-width=".700"/><circle r="2.600" fill="#fbcfe8" stroke="#be3d84" stroke-width=".700"/></g>`;
    case 'flower': return `<g transform="translate(67 25)"><g fill="#fde68a">${[0, 72, 144, 216, 288].map((turn) => `<ellipse cy="-5" rx="3" ry="4.500" transform="rotate(${turn})"/>`).join('')}</g><circle r="2.600" fill="#f59e0b"/></g>`;
    case 'horns': return `<path d="M34 25 C28 18 28 11 32 7 C33 14 37 18 41 21 Z" fill="#dfe6ee" stroke="#9fb0c0"/><path d="M66 25 C72 18 72 11 68 7 C67 14 63 18 59 21 Z" fill="#dfe6ee" stroke="#9fb0c0"/>`;
    default: return '';
  }
}

function mask(a) {
  return a.face === 'mask' ? `<path d="M26 38 Q38 32 50 38 Q62 32 74 38 L72 48 Q60 53 52 46 L48 46 Q40 53 28 48 Z" fill="${a.outfitColor}" stroke="${shade(a.outfitColor, -0.35)}" stroke-width=".800"/>` : '';
}

function eyes(a) {
  const pair = [[41, 43], [59, 43]];
  const color = a.eyeColor;
  if (a.eyes === 'happy') return pair.map(([x, y]) => `<path class="eye" d="M${x - 5} ${y + 1} Q${x} ${y - 6} ${x + 5} ${y + 1}" fill="none" stroke="${color}" stroke-width="2.400" stroke-linecap="round"/>`).join('');
  if (a.eyes === 'gentle') return pair.map(([x, y]) => `<path class="eye" d="M${x - 5} ${y - 1} Q${x} ${y + 5} ${x + 5} ${y - 1}" fill="none" stroke="${color}" stroke-width="2.200" stroke-linecap="round"/>`).join('');
  const rx = { sparkle: 6.200, big: 5.400, round: 4.200 }[a.eyes];
  const ry = rx * 1.14;
  const value = parseInt(color.slice(1), 16);
  const bright = ((value >> 16) + ((value >> 8) & 255) + (value & 255)) / 3 > 170;
  const shine = bright ? INK : '#fff'; // a pale eye needs a dark sparkle to look alive
  const glow = bright ? INK : shade(color, 0.42);
  const star = (x, y, r) => `<path class="eye-shine" d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${shine}"/>`;
  return pair.map(([x, y]) => `<g class="eye"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}"/><ellipse cx="${x}" cy="${y + ry * 0.46}" rx="${rx * 0.66}" ry="${ry * 0.4}" fill="${glow}" opacity=".5"/><circle class="eye-shine" cx="${x + rx * 0.3}" cy="${y - ry * 0.36}" r="${rx * 0.38}" fill="${shine}"/><circle class="eye-shine" cx="${x - rx * 0.36}" cy="${y + ry * 0.32}" r="${rx * 0.17}" fill="${shine}" opacity=".85"/>${a.eyes === 'sparkle' ? star(x + rx * 0.52, y + ry * 0.38, rx * 0.2) : ''}</g>`).join('');
}

function faceFront(a) {
  switch (a.face) {
    case 'glasses': return `<g fill="none" stroke="#2d3340" stroke-width="1.700"><circle cx="41" cy="43" r="7.500"/><circle cx="59" cy="43" r="7.500"/><path d="M48.500 43 H51.500"/></g>`;
    case 'shades': return `<path d="M32 38 H48 L47 48 Q41 51 35 48 Z M52 38 H68 L65 48 Q59 51 53 48 Z" fill="#14161c"/><path d="M48 40 H52" stroke="#14161c" stroke-width="2"/>`;
    case 'visor': return `<rect x="29" y="37" width="42" height="11" rx="5.500" fill="#67e8f9" fill-opacity=".82" stroke="#0e7490"/>`;
    case 'tilak': return `<path d="M46 34 Q50 39 54 34 L52 26 H48 Z" fill="#f4e7c8"/><path d="M50 26 V37" stroke="#d92b3a" stroke-width="2.200" stroke-linecap="round"/>`;
    case 'bindi': return '<circle cx="50" cy="34" r="2.300" fill="#d92b3a"/>';
    case 'thirdEye': return `<g stroke="#f4f7fb" stroke-width="1.300" stroke-linecap="round"><path d="M38 30 H62"/><path d="M39 33 H61"/></g><path d="M47.500 36 Q50 30 52.500 36 Q50 42 47.500 36 Z" fill="#fff" stroke="#b81d2a" stroke-width=".900"/><circle cx="50" cy="36" r="1.100" fill="#b81d2a"/>`;
    default: return '';
  }
}

function snout(a, line) {
  const belly = a.belly;
  const nose = shade(a.skin, -0.62);
  switch (a.base) {
    case 'cat': return `<path d="M47 50 Q50 48.800 53 50 Q51.500 52.500 50 53 Q48.500 52.500 47 50 Z" fill="#ec8a9b"/><path d="M27 48 L15 45 M27 52 L15 54 M73 48 L85 45 M73 52 L85 54" stroke="${INK}" stroke-width="1" opacity=".5"/>`;
    case 'bunny': return `<path d="M47.500 50 H52.500 L50 52.500 Z" fill="#e8798a"/>`;
    case 'dog': case 'bear': case 'panda': return `<ellipse cx="50" cy="54" rx="12" ry="9" fill="${belly}"/><path d="M45.500 49 H54.500 L50 54 Z" fill="${nose}"/>`;
    case 'monkey': return `<path d="M50 40 C57 34 69 40 66 52 C64 62 36 62 34 52 C31 40 43 34 50 40 Z" fill="${belly}"/><circle cx="48" cy="52" r="1" fill="${nose}"/><circle cx="52" cy="52" r="1" fill="${nose}"/>`;
    case 'elephant': return `<path d="M42 49 C42 62 40 71 48 75 C55 78 62 73 57 69 C53 71 50 69 52 63 C54 57 58 54 58 49 Z" fill="${a.skin}" stroke="${line}" stroke-width="1.200"/><path d="M45 56 H53 M44 61 H52" stroke="${line}" stroke-width=".800" opacity=".6"/><path d="M36 56 Q34 63 37 67 Q40 62 41 57 Z" fill="#fbf4e4" stroke="#c9b892" stroke-width=".700"/>`;
    case 'fox': return `<path d="M27 49 Q40 46 50 60 Q60 46 73 49 Q68 66 50 67 Q32 66 27 49 Z" fill="${belly}"/><ellipse cx="50" cy="52.500" rx="3.200" ry="2.300" fill="${INK}"/>`;
    case 'hamster': return `<ellipse cx="35" cy="53" rx="8.500" ry="7" fill="${belly}"/><ellipse cx="65" cy="53" rx="8.500" ry="7" fill="${belly}"/><path d="M47.500 50 Q50 49 52.500 50 Q51 52.500 50 52.800 Q49 52.500 47.500 50 Z" fill="#ec8a9b"/><rect x="48.300" y="57.500" width="3.400" height="3.600" rx=".8" fill="#fff" stroke="#d8cfc4" stroke-width=".4"/>`;
    case 'penguin': return `<path d="M50 30 C43 24 28 28 28 46 C28 60 39 66 50 66 C61 66 72 60 72 46 C72 28 57 24 50 30 Z" fill="${belly}"/><path d="M44.500 50 Q50 47 55.500 50 Q50 57 44.500 50 Z" fill="#f59e0b" stroke="#c77a0a" stroke-width=".5"/>`;
    case 'chick': return '<path d="M44.500 50 Q50 47 55.500 50 Q50 57 44.500 50 Z" fill="#f59e0b" stroke="#c77a0a" stroke-width=".5"/>';
    default: return '';
  }
}

// A little fluff and stripes, only where nothing is worn on the head.
function fluff(a) {
  if (a.hair !== 'none' || a.head !== 'none') return '';
  const stripes = a.base === 'cat' ? `<path d="M50 26 V31 M44 27 L45 31 M56 27 L55 31" stroke="${a.accent}" stroke-width="1.800" stroke-linecap="round" opacity=".75"/>` : '';
  const tuft = ['cat', 'fox', 'hamster', 'chick', 'dog'].includes(a.base)
    ? `<path d="M44 24 C45 18 48 17 49 22 C50 15 54 15 54 22 C56 19 58 20 57 25 Z" fill="${a.base === 'chick' ? shade(a.skin, -0.12) : a.accent}"/>`
    : '';
  return tuft + stripes;
}

function wings(a, line) {
  if (!['penguin', 'chick'].includes(a.base)) return '';
  const fill = a.base === 'penguin' ? a.skin : shade(a.skin, -0.08);
  return `<ellipse cx="25" cy="76" rx="5" ry="12" transform="rotate(14 25 76)" fill="${fill}" stroke="${line}"/><ellipse cx="75" cy="76" rx="5" ry="12" transform="rotate(-14 75 76)" fill="${fill}" stroke="${line}"/>`;
}

function pandaPatches(a) {
  return a.base === 'panda' ? `<ellipse cx="40" cy="43" rx="8" ry="9.500" fill="${a.accent}" transform="rotate(14 40 43)"/><ellipse cx="60" cy="43" rx="8" ry="9.500" fill="${a.accent}" transform="rotate(-14 60 43)"/>` : '';
}

function mouth(a) {
  if (a.base === 'elephant') return '<path class="mouth" d="M58 59 Q63 62 66 58" fill="none" stroke="#3a2a2a" stroke-width="1.300" stroke-linecap="round"/>';
  if (a.base === 'penguin' || a.base === 'chick') return '<path class="mouth" d="M46.500 51 H53.500" fill="none" stroke="#c77a0a" stroke-width="1"/>';
  const y = { dog: 2, bear: 2, panda: 2, fox: 3, hamster: 1 }[a.base] || 0;
  const paths = {
    smile: `<path class="mouth" d="M43 ${56 + y} Q50 ${62 + y} 57 ${56 + y}" fill="none" stroke="#3a2a2a" stroke-width="1.400" stroke-linecap="round"/>`,
    w: `<path class="mouth" d="M44.500 ${55.500 + y} Q47.500 ${60 + y} 50 ${56 + y} Q52.500 ${60 + y} 55.500 ${55.500 + y}" fill="none" stroke="#3a2a2a" stroke-width="1.400" stroke-linecap="round"/>`,
    small: `<path class="mouth" d="M47 ${57 + y} Q50 ${59.500 + y} 53 ${57 + y}" fill="none" stroke="#3a2a2a" stroke-width="1.400" stroke-linecap="round"/>`,
    open: `<path class="mouth" d="M43 ${55 + y} Q50 ${67 + y} 57 ${55 + y} Z" fill="#6b2b33"/>`,
    cat: `<path class="mouth" d="M50 ${53 + y} Q46 ${59 + y} 42 ${56 + y} M50 ${53 + y} Q54 ${59 + y} 58 ${56 + y}" fill="none" stroke="#3a2a2a" stroke-width="1.300" stroke-linecap="round"/>`,
  };
  return paths[a.mouth];
}

function emblem(a) {
  const light = shade(a.outfitColor, 0.75);
  const at = (body) => `<g class="emblem" transform="translate(50 74)">${body}</g>`;
  switch (a.emblem) {
    case 'star': return at(`<path d="M0 -8 L2.400 -2.500 L8 -2.500 L3.600 1 L5 7 L0 3.800 L-5 7 L-3.600 1 L-8 -2.500 L-2.400 -2.500 Z" fill="${light}"/>`);
    case 'bolt': return at(`<path d="M2 -8 L-5 1 H-1 L-3 8 L5 -2 H1 Z" fill="#fde047"/>`);
    case 'moon': return at(`<path d="M2 -7 A7 7 0 1 0 7 2 A5.500 5.500 0 1 1 2 -7 Z" fill="${light}"/>`);
    case 'wave': return at(`<path d="M-8 2 Q-4 -5 0 1 Q4 -5 8 2" fill="none" stroke="${light}" stroke-width="2.400" stroke-linecap="round"/>`);
    case 'flame': return at(`<path d="M0 -8 C5 -3 7 1 5 5 C3 8 -3 8 -5 5 C-7 1 -3 -1 0 -8 Z" fill="#fb923c"/><path d="M0 -2 C2 1 3 3 2 5 C0 6 -2 5 -2 3 C-2 1 -1 0 0 -2 Z" fill="#fde047"/>`);
    case 'heart': return at(`<path d="M0 6 C-9 0 -6 -6 -2.500 -6 C-1 -6 0 -5 0 -4 C0 -5 1 -6 2.500 -6 C6 -6 9 0 0 6 Z" fill="#fb7185"/>`);
    case 'om': return at(`<text x="0" y="5" text-anchor="middle" font-size="15" font-family="Nirmala UI, sans-serif" fill="${GOLD}">ॐ</text>`);
    default: return '';
  }
}

function body(a, id, line) {
  const color = a.outfitColor;
  const dark = shade(color, -0.3);
  const skin = `fill="url(#${id})" stroke="${line}" stroke-width="1.200"`;
  const dressed = `fill="${color}" stroke="${dark}" stroke-width="1.200"`;
  const torso = (paint) => `<ellipse class="body" cx="50" cy="77" rx="24" ry="18" ${paint}/>`;
  switch (a.outfit) {
    case 'tshirt': return torso(dressed);
    case 'hoodie': return `${torso(dressed)}<path d="M38 60 Q50 68 62 60" fill="none" stroke="${dark}" stroke-width="2"/><path d="M47 64 V71 M53 64 V71" stroke="#f4f4f5" stroke-width="1"/><path d="M38 80 H62 L59 89 H41 Z" fill="${dark}" opacity=".6"/>`;
    case 'hero': return `${torso(dressed)}<rect x="27" y="84" width="46" height="3.600" rx="1.800" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width=".500"/>`;
    case 'kurta': return `${torso(dressed)}<path d="M50 60 V88" stroke="${GOLD}" stroke-width="1.800"/><circle cx="50" cy="66" r="1" fill="#fff"/><circle cx="50" cy="72" r="1" fill="#fff"/>`;
    case 'dhoti': return `${torso(skin)}<path d="M26.500 80 Q50 87 73.500 80 Q71 95 50 95 Q29 95 26.500 80 Z" ${dressed}/><path d="M26.500 80 Q50 87 73.500 80" fill="none" stroke="${GOLD}" stroke-width="2"/>`;
    case 'saree': return `${torso(dressed)}<path d="M36 61 L68 90" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/><path d="M38 60 L70 89" stroke="${shade(color, 0.3)}" stroke-width="1"/>`;
    default: return `${torso(skin)}<ellipse cx="50" cy="80" rx="13" ry="11" fill="${a.belly}"/>`;
  }
}

function neck(a) {
  switch (a.neck) {
    case 'scarf': return `<path d="M33 61 Q50 70 67 61 L66 67 Q50 75 34 67 Z" fill="${a.capeColor}"/><path d="M60 67 L66 82 L58 80 Z" fill="${a.capeColor}"/>`;
    case 'necklace': return `<path d="M36 62 Q50 75 64 62" fill="none" stroke="${GOLD}" stroke-width="2.400"/><circle cx="50" cy="70" r="2.600" fill="#d92b3a" stroke="${GOLD}"/>`;
    case 'bow': return `<g transform="translate(50 66)"><path d="M0 0 L-11 -6 V6 Z M0 0 L11 -6 V6 Z" fill="${a.capeColor}" stroke="${shade(a.capeColor, -0.3)}" stroke-width=".800"/><circle r="2.400" fill="${shade(a.capeColor, 0.3)}"/></g>`;
    case 'bell': return `<path d="M34 62 Q50 72 66 62" fill="none" stroke="#dc2626" stroke-width="3.400" stroke-linecap="round"/><circle cx="50" cy="70" r="4" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width=".800"/><path d="M47 70 H53" stroke="${GOLD_DARK}" stroke-width=".800"/>`;
    case 'mala': return `<g fill="#7a4a24">${Array.from({ length: 9 }, (_, i) => { const t = i / 8; const x = 35 + t * 30; const y = 62 + Math.sin(t * Math.PI) * 14; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.900"/>`; }).join('')}</g>`;
    case 'garland': return `<g>${Array.from({ length: 9 }, (_, i) => { const t = i / 8; const x = 34 + t * 32; const y = 62 + Math.sin(t * Math.PI) * 15; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.800" fill="${i % 2 ? '#f59e0b' : '#f97316'}"/>`; }).join('')}</g>`;
    default: return '';
  }
}

function item(a) {
  switch (a.item) {
    case 'flute': return `<path d="M26 74 L76 63" stroke="#8a5a2b" stroke-width="3.400" stroke-linecap="round"/><path d="M36 71.800 L37 71.600 M46 69.600 L47 69.400 M56 67.400 L57 67.200" stroke="#2a1c14" stroke-width="1.600"/><path d="M26 74 L30 73 M72 64 L76 63" stroke="${GOLD}" stroke-width="3.600"/>`;
    case 'mace': return `<path d="M80 94 V58" stroke="#7a4a24" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="50" r="10" fill="${GOLD}" stroke="${GOLD_DARK}"/><path d="M71 50 H89 M80 41 V59" stroke="${GOLD_DARK}" stroke-width="1"/><path d="M80 40 V35" stroke="${GOLD_DARK}" stroke-width="2.400" stroke-linecap="round"/>`;
    case 'trident': return `<path d="M82 97 V26" stroke="#8d97a5" stroke-width="2.800"/><path d="M71 16 Q72 34 82 34 Q92 34 93 16 Q89 24 86 25 L82 11 L78 25 Q75 24 71 16 Z" fill="#cdd5df" stroke="#7b8592" stroke-width=".800"/><path d="M78 40 H86" stroke="#d92b3a" stroke-width="2.400"/>`;
    case 'lotus': return `<g transform="translate(77 76)"><path d="M0 8 C-12 8 -13 0 -12 -4 C-8 -3 -5 0 -3 4 C-5 -3 -3 -8 0 -11 C3 -8 5 -3 3 4 C5 0 8 -3 12 -4 C13 0 12 8 0 8 Z" fill="#f9a8c9" stroke="#d6518a" stroke-width=".800"/></g>`;
    case 'modak': return `<path d="M77 66 C80 72 88 75 88 83 C88 89 66 89 66 83 C66 75 74 72 77 66 Z" fill="#fbf1dc" stroke="#d6b98a"/><path d="M72 78 L74 86 M77 76 V87 M82 78 L80 86" stroke="#d6b98a" stroke-width=".800"/>`;
    case 'book': return `<path d="M66 72 L78 75 L90 72 V89 L78 92 L66 89 Z" fill="#fff8ea" stroke="#9c7b3f"/><path d="M78 75 V92" stroke="#9c7b3f"/>`;
    case 'sword': return `<path d="M80 40 L83 46 V78 H77 V46 Z" fill="#dfe6ee" stroke="#8d97a5" stroke-width=".800"/><path d="M72 78 H88" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/><path d="M80 80 V92" stroke="#5b3a1e" stroke-width="3.400"/>`;
    case 'staff': return `<path d="M82 97 V36" stroke="#7a4a24" stroke-width="3.400" stroke-linecap="round"/><circle cx="82" cy="30" r="7" fill="#67e8f9" stroke="#0e7490"/><circle cx="80" cy="28" r="2" fill="#fff"/>`;
    default: return '';
  }
}

function cape(a) {
  if (a.cape === 'none') return '';
  const bottom = a.cape === 'long' ? 99 : 84;
  return `<path class="cape" d="M32 58 C18 ${bottom - 14} 16 ${bottom - 4} 20 ${bottom} Q50 ${bottom + 4} 80 ${bottom} C84 ${bottom - 4} 82 ${bottom - 14} 68 58 Z" fill="${a.capeColor}" stroke="${shade(a.capeColor, -0.35)}" stroke-width="1"/>`;
}

function aura(a, id) {
  if (a.aura === 'none') return '';
  const color = { gold: '#fbbf24', blue: '#7dd3fc', rose: '#fda4c8' }[a.aura];
  return `<radialGradient id="${id}a"><stop offset=".45" stop-color="${color}" stop-opacity=".62"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient><circle class="aura" cx="50" cy="44" r="42" fill="url(#${id}a)"/><circle class="aura" cx="50" cy="44" r="29" fill="none" stroke="${color}" stroke-width="1.400" opacity=".75"/>`;
}

let drawn = 0;

export function avatarSvg(raw) {
  const a = normalize(raw);
  drawn += 1;
  const id = `avatar${drawn}`;
  const line = shade(a.skin, -0.38);
  const light = shade(a.skin, 0.28);
  const face = `fill="url(#${id})" stroke="${line}" stroke-width="1.200"`;
  const pawColor = a.outfit === 'hero' ? shade(a.outfitColor, -0.3) : a.skin;
  const cheeks = a.base === 'robot' ? '' : `<ellipse class="cheek" cx="32" cy="52" rx="6" ry="3.800" fill="url(#${id}b)"/><ellipse class="cheek" cx="68" cy="52" rx="6" ry="3.800" fill="url(#${id}b)"/>`;
  const beans = ['person', 'robot', 'penguin', 'chick'].includes(a.base) ? '' : (x) => `<ellipse cx="${x}" cy="92" rx="2.600" ry="1.800" fill="#f7b6c2"/><circle cx="${x - 3}" cy="88.500" r="1" fill="#f7b6c2"/><circle cx="${x}" cy="87.800" r="1" fill="#f7b6c2"/><circle cx="${x + 3}" cy="88.500" r="1" fill="#f7b6c2"/>`;
  const pawArt = (side, x) => `<g class="paw ${side}"><rect x="${x}" y="85" width="13" height="10" rx="5" fill="${pawColor}" stroke="${line}"/>${beans ? beans(x + 6.500) : ''}</g>`;
  const shine = a.base === 'robot' ? '' : '<ellipse cx="41" cy="29" rx="10" ry="5" fill="#fff" opacity=".2" transform="rotate(-18 41 29)"/>';
  const skull = a.base === 'robot'
    ? `<rect class="face" x="27" y="21" width="46" height="46" rx="13" ${face}/>`
    : `<circle class="face" cx="50" cy="44" r="23" ${face}/>`;

  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="${id}" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${a.skin}"/></radialGradient><radialGradient id="${id}b"><stop offset="0" stop-color="#ff7f9c" stop-opacity=".6"/><stop offset="1" stop-color="#ff7f9c" stop-opacity="0"/></radialGradient></defs>
    ${aura(a, id)}${cape(a)}${tail(a, line)}
    <g transform="translate(50 96) scale(.84 .8) translate(-50 -96)">
      ${wings(a, line)}${body(a, id, line)}${emblem(a)}
      ${neck(a)}
    </g>
    <g transform="translate(50 64) scale(1.12) translate(-50 -64)">
      <g class="head">
        ${headwearBack(a)}${hairBack(a, line)}${ears(a, a.skin, line)}${skull}${shine}${cheeks}
        ${hairFront(a)}${fluff(a)}${snout(a, line)}${pandaPatches(a)}${mask(a)}${eyes(a)}${mouth(a)}
        <ellipse class="tongue" cx="50" cy="61" rx="4" ry="5"/>
        ${faceFront(a)}${headwear(a)}
      </g>
    </g>
    <g transform="translate(50 96) scale(.84 .8) translate(-50 -96)">${pawArt('left-paw', 34)}${pawArt('right-paw', 53)}</g>
    ${item(a)}
    <g class="laptop"><rect x="28" y="70" width="44" height="22" rx="3"/><rect class="laptop-base" x="23" y="91" width="54" height="5" rx="2.500"/></g>
  </svg>`;
}

const person = { base: 'person', eyes: 'big', mouth: 'smile', belly: '#f7e3cf' };
const divine = { ...person, eyes: 'gentle', mouth: 'small', calm: true, aura: 'gold' };

export const PRESETS = {
  Pets: [
    ['Ginger cat', {}],
    ['Snow kitten', { skin: '#f7f3ee', accent: '#e4d6c8', belly: '#fff', eyeColor: '#2b5f8a', neck: 'bell' }],
    ['Golden dog', { base: 'dog', skin: '#e9c48a', accent: '#b98d52', belly: '#fbeedb', mouth: 'smile' }],
    ['Little fox', { base: 'fox', skin: '#ee8a3c', accent: '#d9702a', belly: '#fff5e8', mouth: 'small', neck: 'bow', capeColor: '#2f9e6e' }],
    ['Bunny', { base: 'bunny', skin: '#f6eff0', accent: '#e6ccd4', belly: '#fff', mouth: 'small', eyeColor: '#3a2230', head: 'ribbon' }],
    ['Panda', { base: 'panda', skin: '#f4f4f2', accent: '#2a2a30', belly: '#fff', mouth: 'smile', eyeColor: '#fff' }],
    ['Teddy', { base: 'bear', skin: '#b5835a', accent: '#8e6240', belly: '#ecd2b4', mouth: 'smile', neck: 'scarf' }],
    ['Penguin', { base: 'penguin', skin: '#2f3a52', accent: '#232c40', belly: '#fff', neck: 'bow', capeColor: '#e0485f' }],
    ['Hamster', { base: 'hamster', skin: '#e6b98a', accent: '#c99664', belly: '#fff3e2', mouth: 'small' }],
    ['Chick', { base: 'chick', skin: '#fbd94c', accent: '#f2c21f', belly: '#fff4b8', head: 'flower' }],
    ['Robot', { base: 'robot', skin: '#a9bccf', accent: '#67788c', eyeColor: '#0891b2', mouth: 'small' }],
  ],
  Heroes: [
    ['Volt Runner', { ...person, skin: '#e8b48c', hair: 'spiky', hairColor: '#17181f', face: 'visor', outfit: 'hero', outfitColor: '#0f766e', cape: 'short', capeColor: '#fbbf24', emblem: 'bolt' }],
    ['Nova Spark', { ...person, skin: '#c98a5e', hair: 'long', hairColor: '#3b1a5c', head: 'tiara', outfit: 'hero', outfitColor: '#be185d', cape: 'long', capeColor: '#7c3aed', emblem: 'star' }],
    ['Shadow Kite', { ...person, skin: '#e0b090', head: 'hood', face: 'mask', outfit: 'hero', outfitColor: '#334155', cape: 'long', capeColor: '#f97316', emblem: 'moon' }],
    ['Tide Guardian', { ...person, skin: '#8d5a3c', hair: 'short', hairColor: '#101018', outfit: 'hero', outfitColor: '#0369a1', cape: 'short', capeColor: '#14b8a6', emblem: 'wave', item: 'staff' }],
    ['Ember Bear', { base: 'bear', skin: '#a8703f', accent: '#7f4f2a', belly: '#eccfa9', mouth: 'smile', outfit: 'hero', outfitColor: '#b45309', cape: 'short', capeColor: '#facc15', emblem: 'flame' }],
  ],
  Gods: [
    ['Bal Ganesh', { base: 'elephant', skin: '#f0a36b', accent: '#dd8a55', belly: '#f9d2b4', eyeColor: '#2a1c14', eyes: 'gentle', head: 'mukut', face: 'tilak', neck: 'garland', outfit: 'dhoti', outfitColor: '#facc15', item: 'modak', aura: 'gold', calm: true }],
    ['Bal Hanuman', { base: 'monkey', skin: '#d97a3a', accent: '#b85d22', belly: '#f7c99b', eyes: 'gentle', mouth: 'small', head: 'mukut', face: 'tilak', neck: 'necklace', outfit: 'dhoti', outfitColor: '#dc2626', item: 'mace', aura: 'gold', calm: true }],
    ['Bal Krishna', { ...divine, skin: '#5b8def', hair: 'short', hairColor: '#16162a', head: 'feather', face: 'tilak', neck: 'garland', outfit: 'dhoti', outfitColor: '#facc15', item: 'flute' }],
    ['Shiva', { ...divine, skin: '#a9cbe0', hair: 'jata', hairColor: '#2b2230', face: 'thirdEye', neck: 'mala', outfit: 'dhoti', outfitColor: '#9a6b3a', item: 'trident', aura: 'blue' }],
    ['Durga', { ...divine, skin: '#e9b38a', hair: 'long', hairColor: '#1b1320', head: 'crown', face: 'bindi', neck: 'necklace', outfit: 'saree', outfitColor: '#dc2626', item: 'trident' }],
    ['Lakshmi', { ...divine, skin: '#efc097', hair: 'long', hairColor: '#20141c', head: 'mukut', face: 'bindi', neck: 'necklace', outfit: 'saree', outfitColor: '#db2777', item: 'lotus', aura: 'rose' }],
    ['Saraswati', { ...divine, skin: '#f0cbaa', hair: 'long', hairColor: '#1f1820', head: 'crown', face: 'bindi', neck: 'mala', outfit: 'saree', outfitColor: '#f5f1e6', item: 'book', aura: 'blue' }],
  ],
};

export function randomAvatar() {
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  const color = () => `#${[0, 0, 0].map(() => Math.floor(70 + Math.random() * 180).toString(16).padStart(2, '0')).join('')}`;
  const avatar = { ...DEFAULT_AVATAR };
  for (const [key, choices] of Object.entries(OPTIONS)) avatar[key] = any(choices)[0];
  for (const [key] of COLOR_FIELDS) if (key !== 'eyeColor') avatar[key] = color();
  return avatar;
}
