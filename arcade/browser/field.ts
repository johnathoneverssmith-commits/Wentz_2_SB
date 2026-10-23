import { FIELD } from "../core/simulation";
import type { DownState } from "../core/down";
const TEAMS = { home: { color: "#60b9ff", dark: "#174a81", name: "Bluebirds" }, away: { color: "#ffa763", dark: "#8c3c22", name: "Foxes" } };
/** Rendering only; this module never advances gameplay or owns mutable match state. */
export function drawField(canvas: HTMLCanvasElement, state: DownState, paused: boolean): void {
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return;
    const scale = 9, left = 60, top = 40;
    const x = (yard: number) => left + yard * scale, y = (yard: number) => top + yard * scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#172a2d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Alternating mowing stripes and painted end zones.
    for (let yard = 0; yard < 120; yard += 5) {
        ctx.fillStyle = yard % 10 === 0 ? "#31644d" : "#2a5945";
        ctx.fillRect(x(yard), top, 5 * scale, FIELD.width * scale);
    }
    ctx.fillStyle = TEAMS.home.dark;
    ctx.fillRect(x(0), top, 10 * scale, FIELD.width * scale);
    ctx.fillStyle = TEAMS.away.dark;
    ctx.fillRect(x(110), top, 10 * scale, FIELD.width * scale);
    ctx.strokeStyle = "#e8efda";
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, 120 * scale, FIELD.width * scale);
    for (let yard = 10; yard <= 110; yard += 5) {
        ctx.globalAlpha = yard % 10 === 0 ? 0.8 : 0.38;
        ctx.beginPath();
        ctx.moveTo(x(yard), top);
        ctx.lineTo(x(yard), y(FIELD.width));
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e8efda";
    ctx.textAlign = "center";
    ctx.font = "bold 24px Georgia";
    for (let yard = 20; yard <= 100; yard += 10) {
        const number = String(50 - Math.abs(yard - 60));
        ctx.fillText(number, x(yard), y(6));
        ctx.save();
        ctx.translate(x(yard), y(FIELD.width - 6));
        ctx.rotate(Math.PI);
        ctx.fillText(number, 0, 0);
        ctx.restore();
    }
    for (let yard = 11; yard < 110; yard++)
        for (const hash of [FIELD.width / 3, FIELD.width * 2 / 3]) {
            ctx.fillRect(x(yard) - 0.7, y(hash), 1.4, 4);
        }
    for (const [yard, team] of [[5, "home"], [115, "away"]] as const) {
        ctx.save();
        ctx.translate(x(yard), y(FIELD.width / 2));
        ctx.rotate(-Math.PI / 2);
        ctx.font = "bold 34px Georgia";
        ctx.fillStyle = "#f3f2df";
        ctx.fillText(TEAMS[team].name, 0, 10);
        ctx.restore();
    }
    ctx.strokeStyle = "#72d8ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(x(state.line), top);
    ctx.lineTo(x(state.line), y(FIELD.width));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x(state.firstDownLine), top);
    ctx.lineTo(x(state.firstDownLine), y(FIELD.width));
    ctx.stroke();
    if (state.phase === "pre-snap") {
        ctx.fillStyle = "#fff9da";
        ctx.font = "bold 20px Arial";
        ctx.fillText("CHOOSE A PLAY · SNAP TO START", canvas.width / 2, 25);
        if (state.play !== "rush")
            for (const p of state.players.filter(p => p.team === state.offense && (p.number === 3 || p.number === 4))) {
                ctx.fillStyle = "#ffe2a2";
                ctx.fillText(p.number === 3 ? "Q" : "E", x(p.x), y(p.y) - 22);
            }
    }
    for (const p of state.players) {
        const px = x(p.x), py = y(p.y), radius = FIELD.radius * scale;
        if (p.human) {
            ctx.strokeStyle = "#fff9da";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, radius + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.beginPath();
        ctx.ellipse(px + 2, py + 4, radius + 2, radius, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = TEAMS[p.team].color;
        ctx.strokeStyle = TEAMS[p.team].dark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#102733";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.fillText(String(p.number), px, py + 4);
        if (p.id === state.possession.carrier && state.ball.kind === "held") {
            ctx.strokeStyle = "#ffe2a2";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, radius + 9, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#9f552d";
            ctx.beginPath();
            ctx.ellipse(px + radius + 5, py, 5, 3, -0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff2d5";
            ctx.fillRect(px + radius + 3, py - 1, 4, 1);
        }
    }
    if (state.ball.kind === "flight") {
        ctx.strokeStyle = '#ffe2a2';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x(state.ball.to.x), y(state.ball.to.y), 2.2 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const b = state.ball, t = Math.min(1, b.elapsed / b.duration);
        const px = x(b.from.x + (b.to.x - b.from.x) * t), py = y(b.from.y + (b.to.y - b.from.y) * t) - Math.sin(t * Math.PI) * 18;
        ctx.fillStyle = "#ffe2a2";
        ctx.beginPath();
        ctx.ellipse(px, py, 8, 5, -0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#6d351f";
        ctx.fillRect(px - 3, py - 1, 6, 2);
    }
    if (state.phase === 'live' && state.contestUntil >= state.tick && state.contestUntil > 0) {
        const defender = state.players.find(p => p.id === state.defender)!;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x(defender.x), y(defender.y), 2.2 * scale, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (paused) {
        ctx.fillStyle = "rgba(14,28,32,.65)";
        ctx.fillRect(left, top, 120 * scale, FIELD.width * scale);
        ctx.fillStyle = "#fff9e5";
        ctx.font = "bold 44px Georgia";
        ctx.fillText("Timeout", canvas.width / 2, canvas.height / 2);
    }
}
