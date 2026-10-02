import type { Rng } from "./rng.ts";

const FIRST = [
  "James", "Michael", "David", "Chris", "Marcus", "Andre", "Tyrese", "Jalen",
  "Deshawn", "Cameron", "Brandon", "Trevor", "Isaiah", "Xavier", "Malik",
  "Darius", "Cole", "Jaylen", "Keenan", "Rashad", "Terrence", "Elijah",
  "Nolan", "Gavin", "Preston", "Bryce", "Kade", "Dominic", "Emmanuel", "Kai",
  "Tyler", "Jordan", "Austin", "Caleb", "Devin", "Travis", "Quentin", "Ricky",
  "Omar", "Luke", "Mason", "Ethan", "Zion", "Tariq", "Jamal", "Corey", "Derek",
  "Hunter", "Garrett", "Sean", "Victor", "Wesley", "Brock", "Carson", "Drew",
  "Evan", "Felix", "Grant", "Harrison", "Ivan", "Jace", "Kellen", "Landon",
  "Micah", "Nate", "Otis", "Pierce", "Reggie", "Solomon", "Trent", "Ulysses",
  "Vince", "Wade", "Xander", "Yusuf", "Zach", "Amari", "Bo", "Cedric", "Dante",
];
const LAST = [
  "Carter", "Whitfield", "Alonso", "Beckwith", "Ferris", "Brannigan", "Okafor",
  "Delgado", "Renfro", "Marshall", "Grantham", "Fentress", "Okonjo", "Ashcombe",
  "Castellanos", "Simmons", "Vance", "Poe", "Braddock", "Ridley", "Chavis",
  "Voss", "Boykins", "Marsh", "Sanderson", "Holloway", "Pruitt", "Vandermeer",
  "Kowalski", "Osei", "Ojo", "Sanders", "Ferro", "Bianchi", "Rutherford",
  "Aguilar", "Northcutt", "Devereaux", "Salois", "Yates",
  "Abernathy", "Blackwell", "Calloway", "Dunmore", "Easley", "Fairchild",
  "Gaines", "Hargrove", "Ingram", "Jefferson", "Kincaid", "Langford", "Mayfield",
  "Nwosu", "Oduya", "Pennington", "Quarles", "Rhodes", "Stallworth", "Tolliver",
  "Underwood", "Valentine", "Whitaker", "Adeyemi", "Burrell", "Crenshaw",
  "Dorsett", "Ellison", "Fontenot", "Gideon", "Hollins", "Ivory", "Jarrett",
  "Kilgore", "Lockett", "Montague", "Norwood", "Oyelaran", "Prescott", "Radcliffe",
  "Sutherland", "Thibodeaux", "Umeh", "Vickers", "Wainwright", "Youngblood",
  "Zeller", "Ashby", "Bristow", "Coleridge", "Dempsey", "Everett", "Faulk",
  "Greer", "Hatcher", "Iwuchukwu", "Jennings", "Keaton", "Larkin", "Mbeki",
];

const SCHOOLS = [
  "Alabama", "Georgia", "Ohio State", "Michigan", "Clemson", "LSU", "Texas",
  "Oregon", "USC", "Notre Dame", "Penn State", "Florida", "Oklahoma", "Iowa",
  "Wisconsin", "Tennessee", "Miami", "Washington", "Utah", "Ole Miss",
  "Kansas State", "TCU", "North Carolina", "Pittsburgh", "Louisville",
];

export function personName(rng: Rng): string {
  return `${rng.pick(FIRST)[0]}. ${rng.pick(LAST)}`;
}

export function fullPersonName(rng: Rng): string {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

/**
 * Redraw any repeated name, keeping the first holder's. Around four hundred
 * coaches drawn from these lists share names often enough that a coaching
 * draft offered two "Tyler Lockett"s — a quarterbacks coach and a line coach.
 */
export function distinctNames<T extends { name: string }>(
  people: T[],
  rng: Rng,
  /** Real people, never renamed — one may hold two jobs (a head coach calling his own defence). */
  real: (p: T, i: number) => boolean = () => false,
): T[] {
  const seen = new Set(people.filter(real).map((p) => p.name));
  people.forEach((p, i) => {
    if (real(p, i)) return;
    let guard = 0;
    while (seen.has(p.name) && guard++ < 50) p.name = fullPersonName(rng);
    seen.add(p.name);
  });
  return people;
}

export function school(rng: Rng): string {
  return rng.pick(SCHOOLS);
}
