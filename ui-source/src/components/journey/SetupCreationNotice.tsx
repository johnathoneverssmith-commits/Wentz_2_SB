import {useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {useDialog} from '@/components/useDialog';
import {isSetupCreating,subscribeSetupCreation} from '@/state/setupCreationStatus';
export function useSetupCreating():boolean {
 return useSyncExternalStore(subscribeSetupCreation,isSetupCreating,()=>false);
}
export function SetupCreationNotice(){
 const busy=useSetupCreating();
 return busy?createPortal(<CreationInProgress/>,document.body):null;
}
/** Reload is the escape hatch: merely unlocking would allow a late overwrite. */
function CreationInProgress(){
 const ref=useDialog(()=>undefined);const [slow,setSlow]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setSlow(true),12_000);return()=>clearTimeout(timer);},[]);
 return <div className="modal-scrim setup-creating"><div ref={ref} className="modal-card" role="dialog" aria-modal="true" aria-label="Creating solo league" aria-busy="true"><h2>Creating solo league</h2><p tabIndex={0} role="status">Please wait for player and staff generation before choosing teams or starting. Your setup controls will return when this finishes.</p>{slow&&<><p>Generation is taking longer than usual. You can keep waiting, or reload to reopen the last saved setup. Unsaved changes may be lost.</p><button type="button" onClick={()=>window.location.reload()}>Reload saved setup</button></>}</div></div>;
}
