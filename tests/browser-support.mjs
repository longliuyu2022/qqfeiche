import { existsSync } from 'node:fs';

export const chromiumPath = process.env.CHROMIUM_PATH
  || (existsSync('/usr/local/bin/chromium-browser') ? '/usr/local/bin/chromium-browser' : undefined);
