/**
 * Rank rules as seen by the multiplayer server.
 *
 * In the repo this is a thin re-export of the shared client module. The
 * deployment stages the server as a flat directory, where `../src/` does not
 * exist, so `scripts/deploy-server.sh` copies `src/ranked.js` over this file.
 * Server code therefore always imports `./ranked-rules.mjs` and never reaches
 * outside the release directory.
 */
export * from '../src/ranked.js';
