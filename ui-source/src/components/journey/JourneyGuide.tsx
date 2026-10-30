import {useSyncExternalStore} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {MotionSurface} from '@/motion/MotionSurface';
import {useStore} from '@/state/store';
import {isOnline,lastLeagueId,leagueConnected,onOnlineChange} from '@/state/online';
import {journeyGuidance,type Connection} from './guidance';
import './journey.css';
function connection():Connection{return isOnline()?(leagueConnected()?'online':'reconnecting'):lastLeagueId()?'detached':'solo';}
/** One orientation point, no duplicate advancement action or tutorial save flags. */
export function JourneyGuide(){
 const s=useStore();const {pathname,search}=useLocation();
 const connected=useSyncExternalStore(onOnlineChange,connection,()=> 'solo' as const);
 if(pathname==='/online'||pathname==='/gallery'||pathname.startsWith('/watch'))return null;
 const g=journeyGuidance(s,connected);
 const here=pathname===g.route&&!(pathname==='/roster'&&new URLSearchParams(search).get('tab')==='cap');
 return <section className="journey-region" role="region" aria-label="Franchise guidance"><MotionSurface className="journey-guide">
  <div className="journey-phase"><span>{g.context}</span><strong>{g.title}</strong>{!here&&<Link to={g.route}>Return to {g.title}</Link>}</div>
  <div className="journey-next"><p className="journey-status" role="status">{g.status}</p><p>{g.next}</p>
   <details key={`${s.stage}:${g.route}:${pathname}`}><summary>Why this step matters</summary><p>{g.why}</p><p>Use the screen’s existing controls to act. Opening this guide never advances the league.</p></details>
  </div>
 </MotionSurface></section>;
}
