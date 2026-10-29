import type { ReactNode } from "react";
import { AnimatedNumber } from "@/motion/AnimatedNumber";

export type SportsIconName = "home" | "roster" | "calendar" | "trade" | "coins" | "star" | "shield" | "settings" | "file" | "up" | "down" | "trash";
const paths: Record<SportsIconName, ReactNode> = {
  home: <><path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z" /></>,
  roster: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-5a6 6 0 0 1 12 0v5M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v3"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h1m6 0h1m-8 3h1m6 0h1"/></>,
  trade: <><path d="M3 7h17l-4-4m4 14H3l4 4M20 7l-4 4M3 17l4-4"/></>,
  coins: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v5c0 4 16 4 16 0V5M4 10v5c0 4 16 4 16 0v-5M4 15v4c0 4 16 4 16 0v-4"/></>,
  star: <path d="m12 2 3 6.5 7 1-5 5 1.2 7-6.2-3.4L5.8 22 7 15 2 9.5l7-1Z"/>,
  shield: <><path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z"/><path d="m7 12 3 3 7-7"/></>,
  settings: <><path d="m9 3 1-2h4l1 2 3 2 3 1v4l-2 2 2 2v4l-3 1-3 2-1 2h-4l-1-2-3-2-3-1v-4l2-2-2-2V6l3-1Z"/><circle cx="12" cy="12" r="3"/></>,
  file: <><path d="M5 2h10l5 5v15H5ZM15 2v6h5M8 12h9m-9 4h9"/></>,
  up: <path d="m4 14 8-8 8 8M4 21l8-8 8 8"/>,
  down: <path d="m4 3 8 8 8-8M4 10l8 8 8-8"/>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 16h12l1-16M10 10v8m4-8v8"/></>,
};
export function SportsIcon({ name, className = "" }: { name: SportsIconName; className?: string }) {
  return <svg className={"sports-icon " + className} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
export function Crown() {
  return <svg viewBox="0 0 48 30" className="sports-crown" aria-hidden="true"><path d="m4 6 10 8L24 2l10 12L44 6l-6 20H10Z" fill="currentColor"/><path d="M11 29h26" stroke="currentColor" strokeWidth="2"/></svg>;
}
export function TeamCrest({ code }: { code: string }) {
  return <div className="sports-crest" aria-label={code + " team"}><Crown/><span>{code}</span></div>;
}
export function SportsStat({ icon, label, value, note, tone }: { icon: SportsIconName; label: string; value: ReactNode; note: string; tone: string }) {
  return <div className={"sports-stat sports-tone-" + tone}><span className="sports-stat-icon"><SportsIcon name={icon}/></span><div><p>{label}</p><strong>{typeof value === "number" ? <AnimatedNumber value={value}/> : value}</strong><small>{note}</small></div></div>;
}
