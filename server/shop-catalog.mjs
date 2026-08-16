/**
 * Shop catalog and wallet rules as seen by the multiplayer server.
 *
 * In the repo this is a thin re-export of the shared client module. The
 * deployment stages the server as a flat directory, where `../src/` does not
 * exist, so `scripts/deploy-server.sh` copies `src/shop.js` over this file.
 * Server code therefore always imports `./shop-catalog.mjs` and never reaches
 * outside the release directory (same arrangement as `./ranked-rules.mjs`).
 */
export * from '../src/shop.js';
