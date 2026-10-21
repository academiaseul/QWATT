# Third-party notices

*Avisos de terceros: el código y los datos ajenos que este repositorio distribuye, con su versión, licencia y origen. El código propio de QWATT es MIT ([LICENSE](LICENSE)).*

Every licence below was read from the component's own package metadata (the `license` field of its
`package.json`) or from the licence file inside the package. Nothing is inferred; where a package
declares nothing, the table says so. Versions are the ones pinned in `package-lock.json`. Checked on
20 Oct 2026.

## 1. Shipped with the site: `assets/vendor/`

Both files are built by `npm run vendor:wallet` (esbuild 0.24.2, entry points in `vendor-src/`).
Rebuilt from the lockfile on 20 Oct 2026, both came out byte-identical to the committed files. The
package lists below are the inputs esbuild reported for that rebuild.

### `assets/vendor/stellar-sdk.js`

| Component | Version | Licence | Source |
|---|---|---|---|
| `@stellar/stellar-sdk` | 13.1.0 | Apache-2.0 | https://github.com/stellar/js-stellar-sdk |

This file wraps the SDK's own prebuilt browser build (`dist/stellar-sdk.min.js`), which already embeds
the SDK's dependencies and browser polyfills at versions fixed by the SDK's build. The licence notice
the SDK publishes for that build (`dist/stellar-sdk.min.js.LICENSE.txt`) names: `buffer` (MIT, Feross
Aboukhadijeh), URI.js 1.19.11 (MIT, Rodney Rehm), punycode 1.4.0 and 1.4.1 (`https://mths.be/punycode`,
by @mathias; the notice names no licence), `ieee754` (BSD-3-Clause, Feross Aboukhadijeh), `regenerator-runtime` (MIT,
Facebook, Inc.) and `safe-buffer` (MIT, Feross Aboukhadijeh).

Runtime dependencies declared by `@stellar/stellar-sdk` 13.1.0 and `@stellar/stellar-base` 13.1.0,
with the licence each declares in its installed package: `@stellar/stellar-base`, `@stellar/js-xdr`
(Apache-2.0); `axios`, `base32.js`, `bignumber.js`, `buffer`, `eventsource`, `feaxios`, `randombytes`,
`toml`, `urijs` (MIT); `sha.js` (MIT AND BSD-3-Clause); `tweetnacl` (Unlicense).

### `assets/vendor/stellar-wallets-kit.js`

| Component | Version | Licence | Source |
|---|---|---|---|
| `@albedo-link/intent` | 0.12.0 | MIT | https://github.com/stellar-expert/albedo |
| `base64-js` | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| `bn.js` | 4.12.5 | MIT | https://github.com/indutny/bn.js |
| `borsh` | 2.0.0 | Apache-2.0 (`package.json`; the package also ships `LICENSE-MIT.txt`) | https://github.com/near/borsh-js |
| `brorand` | 1.1.0 | MIT (`package.json`; no licence file in the package) | https://github.com/indutny/brorand |
| `buffer` | 6.0.3 | MIT | https://github.com/feross/buffer |
| `charenc` | 0.0.2 | BSD-3-Clause | https://github.com/pvorb/node-charenc |
| `@creit.tech/stellar-wallets-kit` | 1.7.0 | MIT (its `LICENSE` file; no `license` field) | https://github.com/Creit-Tech/Stellar-Wallets-Kit |
| `@creit.tech/xbull-wallet-connect` | 0.3.0 | **None declared** (no `license` field, no licence file) | https://github.com/Creit-Tech/xbull-wallet-connect |
| `crypt` | 0.0.2 | BSD-3-Clause | https://github.com/pvorb/node-crypt |
| `depd` | 2.0.0 | MIT | https://github.com/dougwilson/nodejs-depd |
| `elliptic` | 6.6.1 | MIT (`package.json`; no licence file in the package) | https://github.com/indutny/elliptic |
| `hash.js` | 1.1.7 | MIT (`package.json`; no licence file in the package) | https://github.com/indutny/hash.js |
| `hmac-drbg` | 1.0.1 | MIT (`package.json`; no licence file in the package) | https://github.com/indutny/hmac-drbg |
| `@hot-wallet/sdk` | 1.0.11 | **None declared** (no `license` field, no licence file) | https://www.npmjs.com/package/@hot-wallet/sdk |
| `ieee754` | 1.2.1 | BSD-3-Clause | https://github.com/feross/ieee754 |
| `inherits` | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| `js-sha256` | 0.11.1 | MIT | https://github.com/emn178/js-sha256 |
| `lit` | 3.2.0 | BSD-3-Clause | https://github.com/lit/lit |
| `lit-element` | 4.2.2 | BSD-3-Clause | https://github.com/lit/lit |
| `lit-html` | 3.3.3 | BSD-3-Clause | https://github.com/lit/lit |
| `@lit/reactive-element` | 2.1.2 | BSD-3-Clause | https://github.com/lit/lit |
| `@lobstrco/signer-extension-api` | 1.0.0-beta.0 | **GPL-3.0** (`package.json`; no licence file in the package) | https://github.com/Lobstrco/lobstr-browser-extension |
| `minimalistic-assert` | 1.0.1 | ISC | https://github.com/calvinmetcalf/minimalistic-assert |
| `minimalistic-crypto-utils` | 1.0.1 | MIT (`package.json`; no licence file in the package) | https://github.com/indutny/minimalistic-crypto-utils |
| `mustache` | 4.0.0 | MIT | https://github.com/janl/mustache.js |
| `@near-js/crypto` | 1.4.2 | ISC | https://www.npmjs.com/package/@near-js/crypto |
| `@near-js/types` | 0.3.1 | ISC | https://www.npmjs.com/package/@near-js/types |
| `@near-js/utils` | 1.1.0 | ISC | https://www.npmjs.com/package/@near-js/utils |
| `@ngneat/elf` | 2.5.1 | MIT (`package.json`; no licence file in the package) | https://github.com/ngneat/elf |
| `@noble/curves` | 1.8.1 | MIT | https://github.com/paulmillr/noble-curves |
| `@noble/hashes` | 1.7.1 | MIT | https://github.com/paulmillr/noble-hashes |
| `randombytes` | 2.1.0 | MIT | https://github.com/crypto-browserify/randombytes |
| `rxjs` | 7.8.1 | Apache-2.0 | https://github.com/reactivex/rxjs |
| `safe-buffer` | 5.2.1 | MIT | https://github.com/feross/safe-buffer |
| `@scure/base` | 1.2.6 | MIT | https://github.com/paulmillr/scure-base |
| `secp256k1` | 5.0.1 | MIT | https://github.com/cryptocoinjs/secp256k1-node |
| `sha1` | 1.1.1 | BSD-3-Clause | https://github.com/pvorb/node-sha1 |
| `@stellar/freighter-api` | 4.0.0 | Apache-2.0 (`package.json`; no licence file in the package) | https://github.com/stellar/freighter |
| `tslib` | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |
| `tweetnacl` | 1.0.3 | Unlicense | https://github.com/dchest/tweetnacl-js |
| `tweetnacl-util` | 0.15.1 | Unlicense | https://github.com/dchest/tweetnacl-util-js |
| `uuid4` | 2.0.3 | ISC | https://github.com/tracker1/node-uuid4 |

### Inlined in `console.html`, `grid.html` and `pay.html` (August 2026 hackathon pages)

| Component | Version | Licence | Source |
|---|---|---|---|
| `@stellar/stellar-sdk` (one identical minified copy in each page) | 16.2.0, per the client-version string in the code | Not confirmed: the inlined copy carries no licence notice, and the 16.2.0 package is not on disk to read. Every version of the package on disk (12.3.0, 13.1.0, 14.2.0) declares Apache-2.0. | https://github.com/stellar/js-stellar-sdk |

## 2. Installed from npm, not stored in the repository

| Declared in | Component | Version | Licence | Used for |
|---|---|---|---|---|
| `anchor/package.json` | `@stellar/stellar-sdk` | 13.1.0 | Apache-2.0 | anchoring services and their tests |
| `mining-rig/package.json` | `@stellar/stellar-sdk` | 12.3.0 | Apache-2.0 | the August prototype |
| root `devDependencies` | `@stellar/stellar-sdk` | 13.1.0 | Apache-2.0 | input to `assets/vendor/stellar-sdk.js` |
| root `devDependencies` | `@creit.tech/stellar-wallets-kit` | 1.7.0 | MIT (its `LICENSE` file) | input to `assets/vendor/stellar-wallets-kit.js` |
| root `devDependencies` | `esbuild` | 0.24.2 | MIT | build tool only; none of it ships |

Their transitive dependencies, with the licence each declares, are recorded in `package-lock.json`,
`anchor/package-lock.json` and `mining-rig/package-lock.json`.

## 3. Data

| Component | Licence | Source | In this repository |
|---|---|---|---|
| NREL Photovoltaic Data Acquisition (PVDAQ) Public Datasets: system 4902 (`NIST_Ground_1`), September 2017 | CC BY 4.0 | OEDI Data Lake, DOI [10.25984/1846021](https://dx.doi.org/10.25984/1846021) | `datasets/pvdaq-4902-2017-09/` (converted); `evidence/scale/` (results computed from it) |

Attribution: *Data: National Renewable Energy Laboratory (NREL), PVDAQ, CC BY 4.0. Converted by QWATT.*
The terms and the changes made in the conversion are in [`datasets/LICENSE`](datasets/LICENSE).

## Licence texts

The full text of each licence is in the package at the version listed, or in its source repository.
