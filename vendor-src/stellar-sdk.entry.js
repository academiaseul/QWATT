// The SDK ships CJS-first; `export *` yields nothing through esbuild's interop.
// Import the namespace and re-export it as default — qwatt-wallet.js's loadSdk()
// already accepts either shape (`mod.default || mod`).
import * as SDK from '@stellar/stellar-sdk';
const NS = (SDK && SDK.default) ? SDK.default : SDK;
export default NS;
