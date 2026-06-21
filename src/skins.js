// Selectable character skins. Each is a small descriptor of a blocky avatar's
// colours + features (hair, eyes, hat, build); net.js turns one into a mesh.
// "Sydney" and "Francisco" are the two marquee characters; the rest round out a
// varied cast that bots also draw from.

export const SKINS = [
  { id: 'sydney',  name: 'Sydney',  skin: 0xf2c9a8, hair: 0xe8c45a, hairStyle: 'long',  eye: 0x3fa34d, shirt: 0x2bb6a8, pants: 0x355a8c, special: true },
  { id: 'francisco', name: 'Francisco', skin: 0x8a5a36, hair: 0x1a120b, hairStyle: 'short', eye: 0x3a2415, shirt: 0x2e7d4f, pants: 0x6b4a2a, hat: 'sombrero', mustache: true, special: true },
  { id: 'classic', name: 'Classic', skin: 0xe8b89a, hair: 0x4a3526, hairStyle: 'short', eye: 0x303030, shirt: 0x3a86ff, pants: 0x2c3e8c },
  { id: 'diego',   name: 'Diego',   skin: 0x7a4d2e, hair: 0x140d08, hairStyle: 'short', eye: 0x2a1c10, shirt: 0xd23a3a, pants: 0x32343a, scale: 0.82 },
  { id: 'ranger',  name: 'Ranger',  skin: 0xd2a87e, hair: 0x5a3a1e, hairStyle: 'short', eye: 0x355a35, shirt: 0x6b7a3a, pants: 0x4a4030, hat: 'cap', hatColor: 0x3a5a2a },
  { id: 'nova',    name: 'Nova',    skin: 0x4a3322, hair: 0x101418, hairStyle: 'short', eye: 0x3aa0c0, shirt: 0x18b6d0, pants: 0x223040, hat: 'cap', hatColor: 0x18b6d0 },
  { id: 'luna',    name: 'Luna',    skin: 0x9c6b44, hair: 0x180f0a, hairStyle: 'long',  eye: 0x5a3a1a, shirt: 0x8a4bd0, pants: 0x33284a },
  { id: 'rex',     name: 'Rex',     skin: 0xf0d0b8, hair: 0xe07a2a, hairStyle: 'short', eye: 0x404550, shirt: 0x9aa0a8, pants: 0x40444c, hat: 'beanie', hatColor: 0x884444 },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));
export const DEFAULT_SKIN = 'classic';
export function getSkin(id) { return BY_ID.get(id) || BY_ID.get(DEFAULT_SKIN); }

// Skins bots are allowed to wear (the two marquee characters are player-only).
export const BOT_SKIN_IDS = SKINS.filter((s) => !s.special).map((s) => s.id);
export const randomBotSkin = () => BOT_SKIN_IDS[(Math.random() * BOT_SKIN_IDS.length) | 0];
