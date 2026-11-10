import { pathToFileURL } from 'node:url';

// Load secrets only from the existing owner configuration on the server.
// Do not print environment values or copy them into source/release payloads.
for(const key of Object.keys(process.env))if(/^(ANTHROPIC_|CLAUDE_CODE_(OAUTH|USE_))/i.test(key))delete process.env[key];
for(const key of Object.keys(process.env)) if(/^(HTTP|HTTPS|ALL|NO)_PROXY$/i.test(key)) delete process.env[key];
process.env.HOST = '127.0.0.1';
process.env.SERVER_PORT = '3107';
process.env.NODE_ENV = 'production';
process.env.DATABASE_PATH = '/home/appuser/cloudcli-runtime/data/auth.db';
process.env.CLAUDE_CLI_PATH = '/home/appuser/.local/bin/claude';
const root = '/home/appuser/cloudcli-runtime/current';
await import(pathToFileURL(`${root}/server.mjs`).href);
