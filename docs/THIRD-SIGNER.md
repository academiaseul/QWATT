# Third signer — what we ask of you

A one-page brief for the signer from outside the QWATT team. Thank you for holding the third key.
Everything below happens on Stellar **testnet** only: no real funds, nothing on mainnet. The QWATT
testnet asset is used only as the anchoring vehicle; it is not electricity, not an investment, not
a security, not a renewable energy certificate and not a carbon credit.

## What your key does

The anchoring account has three signers of weight 1: the proposer service, the independent
verifier service, and you. Its master key has weight 0 and its thresholds are 2/2/3 (low 2,
medium 2, high 3):

- no single key, yours included, can send any transaction for the account;
- any two keys can anchor a batch. In normal operation the proposer and the verifier do it and
  you are never asked to sign;
- adding, removing or replacing a signer, or changing a threshold, needs all three keys. Your key
  is therefore part of every change to who can sign;
- if the verifier is down, a stand-in anchor is always **proposer + third**: you run the same
  verifier code against the public feed and co-sign. The public reconciliation marks it STAND-IN;
  any other pair counts as BROKEN.

## Steps

The stellar-cli command forms below are to confirm with stellar-cli 28.1.0 (founder step 0); the
founders send this brief once they have checked them on that release.

1. **Install stellar-cli 28.1.0** from the official `stellar/stellar-cli` release on GitHub, and
   check the SHA-256 published with the release. `stellar version --only-version` must print
   `28.1.0`.
2. **Generate your key on your own computer:** `stellar keys generate qwatt-third`. No `--fund` is
   needed: your key is a signer, not an account.
3. **Send only the public key:** `stellar keys address qwatt-third` prints one line that starts with
   `G`. Email only that line to both founders, then confirm its first and last four characters with
   them by voice. Nothing else ever leaves your computer.
4. **Paper backup, once:** `stellar keys secret qwatt-third --phrase` prints 24 recovery words.
   Write them on paper and keep the paper offline. Never photograph them, type them into a website
   or a wallet, paste them into a chat or send them to anyone, the founders included. Run `clear`
   (or close the terminal) afterwards.
5. **Backup drill, once, before the anchoring account is created.** The founders email you
   `drill.xdr`, an unsigned throwaway transaction for a throwaway testnet account.
   - Restore your key from the paper into a separate identity: run `stellar keys add
     qwatt-third-restored` and type the 24 words at its interactive prompt, never on the command
     line.
   - `stellar keys address qwatt-third-restored` must print the same `G…` line you sent. If it does
     not, stop and tell both founders: the backup does not restore your key, and a new key is needed
     before the real account exists.
   - `stellar tx sign drill.xdr --sign-with-key qwatt-third-restored --network testnet` prints one
     line, the signed envelope. Email that line back to both founders; it is public data.
   - `stellar keys rm qwatt-third-restored`.
6. **Be reachable through Day 30 (Tue 17 Nov).** In week 3 the founders run one stand-in drill
   (proposer + third) and will ask you to co-sign it.
7. **A lost key, or recovery words that someone else may have seen:** tell both founders at once.
8. **Sign nothing else** unless both founders confirm it to you by voice.

> **Resumen.** Eres el firmante externo al equipo: una de las tres claves de la cuenta de anclaje
> en Stellar testnet. Ninguna clave sola puede enviar transacciones; dos claves anclan; cambiar
> firmantes o umbrales requiere las tres. Instala stellar-cli 28.1.0 desde la publicación oficial,
> genera tu clave en tu propio computador (`stellar keys generate qwatt-third`) y envía solo la
> clave pública (`stellar keys address qwatt-third`, la línea que empieza con `G`) a los dos
> fundadores; confírmala por voz. Escribe las 24 palabras de respaldo en papel, sin fotos ni chats.
> Una vez, antes de crear la cuenta, restaura la clave desde el papel y firma la transacción de
> prueba `drill.xdr`. No firmes nada más sin la confirmación por voz de ambos fundadores, y avisa de
> inmediato si pierdes la clave.
