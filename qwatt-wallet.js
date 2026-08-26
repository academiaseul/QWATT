/**
 * QWATT — non-custodial wallet module
 * ----------------------------------------------------------------------------
 * The page never sees a secret key. Signing happens inside the user's wallet
 * (Freighter, xBull, Lobstr, Albedo, Rabet, Hana…) via stellar-wallets-kit;
 * this module only builds transactions, hands them out for signature, and
 * submits the signed XDR to Horizon.
 *
 * Replaces the `Keypair.fromSecret(input.value)` pattern still present in
 * console.html / grid.html / pay.html — see README-wallet-integration.md §4.
 *
 * Usage:
 *   import * as Wallet from './assets/qwatt-wallet.js';
 *   const address = await Wallet.connect();
 *   const info    = await Wallet.loadAccount();
 *   await Wallet.ensureQwattTrustline();
 *   await Wallet.payQwatt('GB…', '10.5', 'FACTURA-0001');
 *
 * Deps are pulled from esm.sh at runtime — acceptable on testnet, NOT for
 * mainnet. Before mainnet: npm i + esbuild bundle, self-host, strict CSP.
 * (README-wallet-integration.md, mainnet checklist item 3.)
 */

/* ─────────────────────────── configuration ─────────────────────────── */

export const CONFIG = {
  NETWORK: 'TESTNET',                       // TESTNET | PUBLIC
  QWATT_CODE: 'QWATT',
  QWATT_ISSUER: 'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46',
  HORIZON: 'https://horizon-testnet.stellar.org',
  FRIENDBOT: 'https://friendbot.stellar.org',
  EXPLORER: 'https://stellar.expert/explorer/testnet',
  BASE_FEE_STROOPS: '10000',                // 0.001 XLM — comfortably above minimum
  TIMEOUT_SECONDS: 180,
};

const CDN = {
  sdk: 'https://esm.sh/@stellar/stellar-sdk@13.1.0',
  kit: 'https://esm.sh/@creit.tech/stellar-wallets-kit@1.7.0',
};

/* ───────────────────────── module-local state ──────────────────────── */

let _sdk = null;      // @stellar/stellar-sdk namespace
let _kit = null;      // StellarWalletsKit instance
let _server = null;   // Horizon server
let _address = null;  // connected G… address
let _passphrase = null;

const STORAGE_KEY = 'qwatt.wallet.v1';

/* ───────────────────────────── internals ───────────────────────────── */

async function loadSdk() {
  if (_sdk) return _sdk;
  let mod;
  try {
    mod = await import(/* @vite-ignore */ CDN.sdk);
  } catch (e) {
    throw new Error('Could not load the Stellar SDK. Check your connection and try again.');
  }
  // esm.sh serves the CJS build behind a default export (its top level is just
  // `default`); a native ESM build exposes the namespace directly. Accept both.
  _sdk = (mod.Keypair || mod.TransactionBuilder) ? mod : (mod.default || mod);

  // v11+ exposes Horizon.Server; older builds expose Server at the top level.
  const ServerCtor = _sdk.Horizon?.Server || _sdk.Server;
  if (!ServerCtor) throw new Error('Unsupported Stellar SDK build: no Horizon server class.');
  _server = new ServerCtor(CONFIG.HORIZON);
  _passphrase = CONFIG.NETWORK === 'PUBLIC'
    ? _sdk.Networks.PUBLIC
    : _sdk.Networks.TESTNET;
  return _sdk;
}

async function loadKit() {
  if (_kit) return _kit;
  let mod;
  try {
    mod = await import(/* @vite-ignore */ CDN.kit);
  } catch (e) {
    throw new Error('Could not load the wallet kit. Check your connection and try again.');
  }
  const k = mod.StellarWalletsKit ? mod : (mod.default || mod);
  const { StellarWalletsKit, WalletNetwork, allowAllModules, FREIGHTER_ID } = k;
  if (!StellarWalletsKit) {
    throw new Error('Unsupported wallet-kit build: StellarWalletsKit not found.');
  }
  _kit = new StellarWalletsKit({
    network: CONFIG.NETWORK === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
    selectedWalletId: FREIGHTER_ID,
    modules: allowAllModules(),
  });
  return _kit;
}

/** Horizon errors are nested and unreadable by default. Surface the useful part. */
function explainHorizonError(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (!codes) {
    if (err?.message) return err.message;
    return 'The network rejected the transaction.';
  }
  const op = Array.isArray(codes.operations) ? codes.operations.join(', ') : '';
  const map = {
    op_underfunded: 'Insufficient balance for this amount.',
    op_no_trust: 'The destination has no QWATT trustline — it must add QWATT first.',
    op_no_destination: 'The destination account does not exist on this network.',
    op_line_full: 'The destination trustline limit would be exceeded.',
    op_low_reserve: 'The destination needs a minimum XLM balance first.',
    tx_insufficient_fee: 'Network fee too low — try again.',
    tx_bad_auth: 'Signature rejected by the network.',
    tx_bad_seq: 'Sequence number out of date — refresh and retry.',
  };
  for (const key of [op, codes.transaction]) {
    if (key && map[key]) return map[key];
  }
  return `Transaction rejected: ${op || codes.transaction || 'unknown reason'}`;
}

function txLink(hash) {
  return `${CONFIG.EXPLORER}/tx/${hash}`;
}

function qwattAsset() {
  return new _sdk.Asset(CONFIG.QWATT_CODE, CONFIG.QWATT_ISSUER);
}

/* ──────────────────────────── public API ───────────────────────────── */

/** Horizon server instance (loaded lazily). Prefer the helpers below. */
export async function getServer() {
  await loadSdk();
  return _server;
}

/** The connected address, or null. */
export function getAddress() {
  if (_address) return _address;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.address) {
      _address = saved.address;
      return _address;
    }
  } catch { /* storage unavailable or corrupt — treat as not connected */ }
  return null;
}

/**
 * Open the wallet picker and connect. Returns the G… address.
 * Re-connecting with a wallet already chosen skips the modal.
 */
export async function connect() {
  await loadSdk();
  const kit = await loadKit();

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}

  if (saved?.walletId) {
    try {
      kit.setWallet(saved.walletId);
      const { address } = await kit.getAddress();
      _address = address;
      persist(saved.walletId, address);
      return address;
    } catch {
      // Saved wallet unavailable (uninstalled, locked) — fall through to the picker.
    }
  }

  return new Promise((resolve, reject) => {
    kit.openModal({
      onWalletSelected: async (option) => {
        try {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();
          _address = address;
          persist(option.id, address);
          resolve(address);
        } catch (e) {
          reject(new Error(e?.message || 'Could not read the address from the wallet.'));
        }
      },
      onClosed: () => reject(new Error('Wallet selection cancelled.')),
    });
  });
}

function persist(walletId, address) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ walletId, address }));
  } catch { /* private mode — session-only connection is fine */ }
}

/** Forget the connection locally. Does not revoke anything in the wallet itself. */
export function disconnect() {
  _address = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Account snapshot for the connected (or given) address.
 * @returns {{exists:boolean, xlm:string, qwatt:string, hasTrustline:boolean, address:string}}
 */
export async function loadAccount(address = getAddress()) {
  if (!address) throw new Error('No wallet connected.');
  await loadSdk();
  try {
    const acct = await _server.loadAccount(address);
    const native = acct.balances.find(b => b.asset_type === 'native');
    const qwatt = acct.balances.find(
      b => b.asset_code === CONFIG.QWATT_CODE && b.asset_issuer === CONFIG.QWATT_ISSUER
    );
    return {
      address,
      exists: true,
      xlm: native ? native.balance : '0',
      qwatt: qwatt ? qwatt.balance : '0',
      hasTrustline: Boolean(qwatt),
    };
  } catch (e) {
    if (e?.response?.status === 404 || e?.name === 'NotFoundError') {
      return { address, exists: false, xlm: '0', qwatt: '0', hasTrustline: false };
    }
    throw new Error(`Could not read the account from Horizon: ${e?.message || 'network error'}`);
  }
}

/** Fund a brand-new testnet account via Friendbot. Testnet only. */
export async function fundWithFriendbot(address = getAddress()) {
  if (CONFIG.NETWORK !== 'TESTNET') throw new Error('Friendbot only exists on testnet.');
  if (!address) throw new Error('No wallet connected.');
  const res = await fetch(`${CONFIG.FRIENDBOT}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (body.includes('createAccountAlreadyExist')) return { alreadyFunded: true };
    throw new Error('Friendbot could not fund this account. It may already exist.');
  }
  return { alreadyFunded: false };
}

/**
 * Sign a transaction with the connected wallet and submit it to Horizon.
 * Accepts a Transaction object or a base64 XDR string, so existing
 * transaction-building code migrates unchanged.
 * @returns {{hash:string, link:string}}
 */
export async function signAndSubmit(txOrXdr) {
  await loadSdk();
  const kit = await loadKit();
  const address = getAddress();
  if (!address) throw new Error('No wallet connected.');

  const xdr = typeof txOrXdr === 'string' ? txOrXdr : txOrXdr.toXDR();

  let signedTxXdr;
  try {
    ({ signedTxXdr } = await kit.signTransaction(xdr, {
      address,
      networkPassphrase: _passphrase,
    }));
  } catch (e) {
    const msg = String(e?.message || e);
    if (/reject|denied|cancel|user declined/i.test(msg)) {
      throw new Error('Signature cancelled in the wallet.');
    }
    throw new Error(`The wallet could not sign: ${msg}`);
  }

  const signed = _sdk.TransactionBuilder.fromXDR(signedTxXdr, _passphrase);
  try {
    const res = await _server.submitTransaction(signed);
    return { hash: res.hash, link: txLink(res.hash) };
  } catch (e) {
    throw new Error(explainHorizonError(e));
  }
}

/** Build a transaction with the connected account as source. */
async function buildTx(buildFn) {
  await loadSdk();
  const address = getAddress();
  if (!address) throw new Error('No wallet connected.');
  let source;
  try {
    source = await _server.loadAccount(address);
  } catch {
    throw new Error('This account does not exist on the network yet — fund it first.');
  }
  const builder = new _sdk.TransactionBuilder(source, {
    fee: CONFIG.BASE_FEE_STROOPS,
    networkPassphrase: _passphrase,
  });
  buildFn(builder, _sdk);
  return builder.setTimeout(CONFIG.TIMEOUT_SECONDS).build();
}

/**
 * Open the QWATT trustline if it isn't open already.
 * @returns {null | {hash:string, link:string}} null when already present.
 */
export async function ensureQwattTrustline() {
  const info = await loadAccount();
  if (!info.exists) throw new Error('Fund the account before opening a trustline.');
  if (info.hasTrustline) return null;

  const tx = await buildTx((b, sdk) => {
    b.addOperation(sdk.Operation.changeTrust({ asset: qwattAsset() }));
  });
  return signAndSubmit(tx);
}

/**
 * Send QWATT to another account.
 * @param {string} destination G… address
 * @param {string} amount decimal string, e.g. '10.5'
 * @param {string} [memo] optional, ≤28 bytes (Stellar text-memo limit)
 */
export async function payQwatt(destination, amount, memo = '') {
  await loadSdk();
  if (!destination || !_sdk.StrKey.isValidEd25519PublicKey(destination)) {
    throw new Error('Destination is not a valid Stellar address (G…).');
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be a positive number.');
  }
  if (memo && new TextEncoder().encode(memo).length > 28) {
    throw new Error('Memo is longer than the 28-byte Stellar limit.');
  }

  const balance = await loadAccount();
  if (!balance.hasTrustline) throw new Error('Open the QWATT trustline before sending.');
  if (Number(balance.qwatt) < value) {
    throw new Error(`Insufficient QWATT: balance is ${Number(balance.qwatt).toFixed(2)}.`);
  }

  const tx = await buildTx((b, sdk) => {
    b.addOperation(sdk.Operation.payment({
      destination,
      asset: qwattAsset(),
      amount: String(amount),
    }));
    if (memo) b.addMemo(sdk.Memo.text(memo));
  });
  return signAndSubmit(tx);
}

/** Explorer URL for an account. */
export function accountLink(address = getAddress()) {
  return `${CONFIG.EXPLORER}/account/${address}`;
}

/** Explorer URL for the QWATT asset. */
export function assetLink() {
  return `${CONFIG.EXPLORER}/asset/${CONFIG.QWATT_CODE}-${CONFIG.QWATT_ISSUER}`;
}
