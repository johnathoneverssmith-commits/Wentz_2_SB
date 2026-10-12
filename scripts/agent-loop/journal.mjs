import { digest, validate } from './contracts.mjs';
import { initialState, reduce } from './reducer.mjs';

export function append(journal,event) {
  validate('event',event);
  if(journal.some(entry=>entry.event.id===event.id))return journal;
  const record={sequence:journal.length+1,previousHash:journal.at(-1)?.hash??'0'.repeat(64),event};
  return [...journal,{...record,hash:digest(record)}];
}
export function replay(journal,manifestDigest,policy) {
  let state=initialState(manifestDigest), previousHash='0'.repeat(64);
  for(const [i,entry] of journal.entries()) {
    const {hash,...record}=entry;
    if(record.sequence!==i+1||record.previousHash!==previousHash||digest(record)!==hash||state.seen.includes(record.event.id))throw new Error('Corrupt journal');
    state=reduce(state,record.event,policy).state;previousHash=hash;
  }
  return state;
}
