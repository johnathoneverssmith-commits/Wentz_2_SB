import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { advance, createClock } from "../core/clock";
import type { Inputs } from "../core/simulation";
import { drawField } from "./field";
import "./style.css";

function Sandbox() {
  const canvas=useRef<HTMLCanvasElement>(null);
  const clock=useRef(createClock());
  const keys=useRef(new Set<string>());
  const previous=useRef<number | null>(null);
  const [view,setView]=useState(clock.current);
  const publish=()=>{setView(clock.current);if(canvas.current)drawField(canvas.current,clock.current.match,clock.current.paused);};
  const pause=()=>{
    keys.current.clear();previous.current=null;
    clock.current={...clock.current,paused:true,accumulator:0};publish();
  };
  const togglePause=()=>{
    keys.current.clear();previous.current=null;
    clock.current={...clock.current,paused:!clock.current.paused,accumulator:0};
    publish();canvas.current?.focus();
  };
  const restart=()=>{
    keys.current.clear();previous.current=null;clock.current=createClock();publish();canvas.current?.focus();
  };
  useEffect(()=>{
    let frame=0,lastPublished=0;
    const movementKeys=new Set(["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowLeft","ArrowDown","ArrowRight"]);
    const keydown=(e:KeyboardEvent)=>{
      if(!movementKeys.has(e.code) || e.altKey || e.ctrlKey || e.metaKey) return;
      if(e.target instanceof HTMLElement && e.target.closest("button,input,select,textarea,a,summary,[contenteditable]")) return;
      e.preventDefault();
      if(!e.repeat && !clock.current.paused) keys.current.add(e.code);
    };
    const keyup=(e:KeyboardEvent)=>{keys.current.delete(e.code);};
    const hidden=()=>{if(document.hidden)pause();};
    const animate=(now:number)=>{
      const elapsed=previous.current===null?0:(now-previous.current)/1000;
      previous.current=now;
      const held=(code:string)=>Number(keys.current.has(code));
      const inputs:Inputs={home:{x:held("KeyD")-held("KeyA"),y:held("KeyS")-held("KeyW")},away:{x:held("ArrowRight")-held("ArrowLeft"),y:held("ArrowDown")-held("ArrowUp")}};
      clock.current=advance(clock.current,elapsed,inputs);
      if(canvas.current)drawField(canvas.current,clock.current.match,clock.current.paused);
      if(now-lastPublished>=100){setView(clock.current);lastPublished=now;}
      frame=requestAnimationFrame(animate);
    };
    window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);
    window.addEventListener("blur",pause);document.addEventListener("visibilitychange",hidden);
    frame=requestAnimationFrame(animate);
    return ()=>{
      cancelAnimationFrame(frame);keys.current.clear();previous.current=null;
      window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);
      window.removeEventListener("blur",pause);document.removeEventListener("visibilitychange",hidden);
    };
  },[]);
  return <main>
    <header><div><p className="series">Wentz 2 SB / Arcade lab</p><h1>Backyard football</h1><p className="intro">Two players. One keyboard. Find your space.</p></div>
      <div className="actions"><button onClick={togglePause}>{view.paused?"Resume":"Pause"}</button><button className="secondary" onClick={restart}>Restart</button></div>
    </header>
    <section className="stadium" aria-label="Movement sandbox">
      <div className="scoreboard"><div className="team blue"><span className="swatch"/>Bluebirds <small>Player 1 · WASD</small></div><div className="drill"><strong>Movement drill</strong><span>{view.paused?"Paused":"Live practice"}</span></div><div className="team orange">Foxes <span className="swatch"/><small>Player 2 · Arrow keys</small></div></div>
      <canvas ref={canvas} width={1200} height={560} tabIndex={0} role="img" aria-label="Football field with ten numbered players; white rings mark human players and a gold ring marks the ball carrier" onClick={()=>canvas.current?.focus()}/>
      <div className="field-footer"><span><span className="ball"/>Bluebirds possession</span><span>White ring = you <span className="divider">/</span> Gold ring = ball carrier</span></div>
    </section>
    <section className="instructions" aria-label="How to play"><h2>Make room. Chase it down.</h2><p>Move the blue #1 with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> and orange #1 with the arrow keys. Both players can move at once. Blue teammates hold support lanes; orange teammates pursue the ball carrier.</p><p>This is a movement sandbox: no tackles, passes or scoring yet. Click the field to return keyboard focus. Switching windows pauses the drill; resume when you’re ready.</p></section>
    <details><summary>Player positions <span>yards from the left end and upper sideline</span></summary><table><thead><tr><th>Player</th><th>Control</th><th>X</th><th>Y</th></tr></thead><tbody>{view.match.players.map(p=><tr key={p.id}><th>{p.team==="home"?"Bluebirds":"Foxes"} #{p.number}</th><td>{p.human?"Human":"AI"}</td><td data-testid={`${p.id}-x`}>{p.x.toFixed(2)}</td><td data-testid={`${p.id}-y`}>{p.y.toFixed(2)}</td></tr>)}</tbody></table></details>
    <footer>Local exhibition sandbox <span>No accounts. No saved leagues. No server connection.</span></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Sandbox/></StrictMode>);
