import { digest } from './contracts.mjs';

export async function emergencyPause(client,broker,{actor,id,at}) {
  await client.verifyHuman(actor);
  await broker.pause(digest({actor,id,at}));
  await client.recordEmergencyPause({actor,id,at});
}
