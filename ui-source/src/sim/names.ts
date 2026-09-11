import type { Rng } from "./rng.ts";

const FIRST = [
  "James", "Michael", "David", "Chris", "Marcus", "Andre", "Tyrese", "Jalen",
  "Deshawn", "Cameron", "Brandon", "Trevor", "Isaiah", "Xavier", "Malik",
  "Darius", "Cole", "Jaylen", "Keenan", "Rashad", "Terrence", "Elijah",
  "Nolan", "Gavin", "Preston", "Bryce", "Kade", "Dominic", "Emmanuel", "Kai",
];
const LAST = [
  "Carter", "Whitfield", "Alonso", "Beckwith", "Ferris", "Brannigan", "Okafor",
  "Delgado", "Renfro", "Marshall", "Grantham", "Fentress", "Okonjo", "Ashcombe",
  "Castellanos", "Simmons", "Vance", "Poe", "Braddock", "Ridley", "Chavis",
  "Voss", "Boykins", "Marsh", "Sanderson", "Holloway", "Pruitt", "Vandermeer",
  "Kowalski", "Osei", "Ojo", "Sanders", "Ferro", "Bianchi", "Rutherford",
  "Aguilar", "Northcutt", "Devereaux", "Salois", "Yates",
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

export function school(rng: Rng): string {
  return rng.pick(SCHOOLS);
}
