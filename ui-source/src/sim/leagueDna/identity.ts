import type { Rng } from "../rng.ts";

/**
 * Original fictional names, composed from syllables rather than picked from a
 * list of people. A first name is a common given name about a third of the
 * time and a composed one otherwise; a surname is composed or drawn from a
 * short list of ordinary surnames. That is millions of combinations; the
 * league keeps them unique (`UniqueNames`) and keeps them clear of the real
 * names it is told about.
 */
const COMMON_FIRST = [
  "James", "Marcus", "David", "Chris", "Andre", "Tyrese", "Jalen", "Cameron", "Brandon", "Trevor",
  "Isaiah", "Xavier", "Malik", "Darius", "Cole", "Keenan", "Terrence", "Elijah", "Nolan", "Gavin",
  "Preston", "Bryce", "Dominic", "Tyler", "Jordan", "Austin", "Caleb", "Devin", "Travis", "Omar",
  "Luke", "Mason", "Ethan", "Corey", "Derek", "Hunter", "Sean", "Victor", "Wesley", "Evan", "Felix",
  "Grant", "Landon", "Micah", "Otis", "Reggie", "Trent", "Wade", "Amari", "Cedric", "Dante",
];
const F_PRE = [
  "Ak", "Al", "Am", "An", "Ar", "As", "Bar", "Bas", "Bel", "Ben", "Bran", "Bry", "Cal", "Cas", "Cor",
  "Dan", "Dar", "Dev", "Dom", "Dun", "Ed", "El", "Em", "Er", "Fin", "Gar", "Gav", "Gil", "Ham", "Har",
  "Hol", "Is", "Jab", "Jar", "Jas", "Jon", "Kar", "Kel", "Ken", "Kir", "Lan", "Leo", "Lin", "Lor",
  "Mar", "Mat", "Mel", "Mil", "Nat", "Nel", "Nic", "Ol", "Or", "Pat", "Per", "Quin", "Raf", "Ran",
  "Rey", "Rob", "Ron", "Sal", "Sam", "Sev", "Sol", "Tal", "Tay", "Tor", "Tre", "Ty", "Ul", "Val",
  "Ver", "Vic", "Wal", "Wes", "Zan", "Zeb",
];
const F_SUF = [
  "an", "en", "in", "on", "un", "as", "es", "is", "os", "us", "ek", "ik", "ak", "ar", "er", "or",
  "el", "il", "ol", "ric", "rick", "ron", "ton", "don", "den", "dan", "lan", "len", "lin", "mon",
  "man", "min", "ney", "ley", "vin", "von", "sey", "tin", "tan", "lo", "no", "ro", "to", "mar",
  "dre", "drick", "jah", "vius", "cus", "ell", "ett", "ard", "aldo",
];
const COMMON_LAST = [
  "Carter", "Marshall", "Simmons", "Vance", "Ridley", "Holloway", "Sanders", "Ingram", "Jefferson",
  "Mayfield", "Rhodes", "Whitaker", "Ellison", "Jennings", "Keaton", "Hatcher", "Greer", "Faulk",
  "Okafor", "Nwosu", "Adeyemi", "Mbeki", "Delgado", "Aguilar", "Castellanos", "Bianchi", "Kowalski",
];
const L_PRE = [
  "Ash", "Bark", "Black", "Brad", "Brook", "Carr", "Chase", "Clay", "Cross", "Dal", "Drake", "Eld", "Fair",
  "Flint", "Gar", "Gray", "Hale", "Hart", "Hay", "Hol", "Jen", "Kell", "King", "Lang", "Lock", "Mar",
  "Mill", "Nor", "Oak", "Park", "Pen", "Rand", "Ross", "Shaw", "Stan", "Stone", "Tar", "Thorn", "Vail",
  "Ward", "West", "Whit", "Wolf", "York", "Bren", "Cal", "Dun", "Fen", "Gil", "Har", "Kin", "Lin",
  "Mor", "Nash", "Pol", "Quin", "Rad", "Sut", "Tre", "Wex", "Bram", "Cor", "Den", "Ev", "Fos", "Gor",
];
const L_SUF = [
  "ton", "ford", "well", "worth", "ley", "by", "man", "son", "ham", "field", "wood", "ridge", "more",
  "land", "berry", "dale", "gate", "stead", "wick", "croft", "ing", "er", "ell", "ett", "ard", "ow",
  "ens", "ins", "ner", "sey", "kins", "low", "mont", "ner", "shaw", "ville", "ware", "wright",
];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function composeName(rng: Rng): string {
  const first = rng.bool(0.35) ? rng.pick(COMMON_FIRST) : cap(rng.pick(F_PRE).toLowerCase() + rng.pick(F_SUF));
  const last = rng.bool(0.2) ? rng.pick(COMMON_LAST) : cap(rng.pick(L_PRE).toLowerCase() + rng.pick(L_SUF));
  return `${first} ${last}`;
}

/** Hands out names no two people share and none on the `reserved` list (real people). Deterministic for a fixed call order. */
export class UniqueNames {
  private readonly seen: Set<string>;
  constructor(reserved: Iterable<string> = []) {
    this.seen = new Set([...reserved].map((n) => n.toLowerCase()));
  }
  take(draw: (attempt: number) => string): string {
    for (let attempt = 0; attempt < 60; attempt++) {
      const n = draw(attempt);
      const k = n.toLowerCase();
      if (!this.seen.has(k)) {
        this.seen.add(k);
        return n;
      }
    }
    // astronomically unlikely: fall back to a numbered name rather than loop
    const n = `${draw(0)} ${this.seen.size}`;
    this.seen.add(n.toLowerCase());
    return n;
  }
}
