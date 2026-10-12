import { createService } from './service.mjs';

const port = Number(process.env.PORT || 3010);
const host = process.env.HOST || '127.0.0.1';
const demoMode = process.env.PORTAL_DEMO_MODE !== '0';
let tokens;
try { tokens = process.env.PORTAL_TOKENS_JSON ? JSON.parse(process.env.PORTAL_TOKENS_JSON) : undefined; }
catch { console.error('PORTAL_TOKENS_JSON must be a JSON object'); process.exit(1); }
if (!demoMode && (!tokens || Object.keys(tokens).length === 0)) {
  console.error('Set PORTAL_TOKENS_JSON when PORTAL_DEMO_MODE=0'); process.exit(1);
}
createService({ demoMode, tokens }).listen(port, host, () => {
  console.log(`Customer admin portal listening on http://${host}:${port}`);
});
