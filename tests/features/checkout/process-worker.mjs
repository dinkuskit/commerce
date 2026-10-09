import { withSyntheticCheckoutContact } from './fixture.mjs';
import { startCheckout, reconcileCheckout } from '../../../dist/features/checkout/index.js';
import { durableFixture, cart } from './fixture.mjs';
const [path,mode,attemptId] = process.argv.slice(2);
const f=durableFixture(path);
process.send?.({type:'ready'});
process.on('message',async message => {
  if(message !== 'go') return;
  try {
    const result=mode === 'start' ? await startCheckout(f.execution,'guest-cart',withSyntheticCheckoutContact(cart)) : await reconcileCheckout(f.execution,'guest-cart',attemptId);
    process.send?.({type:'result',result});
  } catch(error) { process.send?.({type:'result',error:error.message}); }
  finally { f.db.close();process.disconnect?.(); }
});
