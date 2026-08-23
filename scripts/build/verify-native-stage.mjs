import { resolve } from 'node:path';
import { verifyNativeStage } from './native-build.mjs';

const platformIndex = process.argv.indexOf('--platform');
const requested = platformIndex >= 0 ? process.argv[platformIndex + 1] : process.platform;
const platform = requested === 'windows' ? 'win32' : requested === 'macos' ? 'darwin' : requested;
if (!platform) throw new Error('--platform requires windows, macos, or a Node.js platform name.');
const repositoryRoot = resolve(import.meta.dirname, '../..');
const stage = await verifyNativeStage(repositoryRoot, platform);
process.stdout.write(
    `Verified canonical native stage: ${stage.executablePath} (${stage.bytes} bytes).\n`,
);
