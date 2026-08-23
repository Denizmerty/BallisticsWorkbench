import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { PRODUCT_LIMITS } from './src/Ballistics.Desktop/shared/productIdentity.ts';

async function requestBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > PRODUCT_LIMITS.calculationRequestBytes)
            throw new Error('Calculation request exceeds 1 MiB.');
        chunks.push(bytes);
    }
    return Buffer.concat(chunks);
}

function runNative(binary: string, input: Buffer, request: IncomingMessage) {
    return new Promise<string>((resolve, reject) => {
        const child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const output: Buffer[] = [];
        let outputSize = 0;
        const timeout = setTimeout(() => child.kill(), 30_000);
        const cancel = () => child.kill();
        request.once('aborted', cancel);
        child.stdout.on('data', (chunk: Buffer) => {
            outputSize += chunk.length;
            if (outputSize > PRODUCT_LIMITS.engineResponseBytes) {
                child.kill();
                reject(new Error('Ballistics engine response exceeded 16 MiB.'));
                return;
            }
            output.push(chunk);
        });
        child.stderr.resume();
        child.on('error', () =>
            reject(new Error('The native ballistics engine could not be started.')),
        );
        child.on('close', () => {
            clearTimeout(timeout);
            request.off('aborted', cancel);
            resolve(Buffer.concat(output).toString('utf8'));
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(input);
    });
}

function cppDevelopmentApi() {
    return {
        name: 'cpp-development-api',
        configureServer(server: {
            middlewares: {
                use: (
                    route: string,
                    handler: (request: IncomingMessage, response: ServerResponse) => void,
                ) => void;
            };
        }) {
            server.middlewares.use('/api/calculate', async (request, response) => {
                response.setHeader('Content-Type', 'application/json');
                try {
                    if (request.method !== 'POST') {
                        response.statusCode = 405;
                        response.end(JSON.stringify({ error: 'Method not allowed' }));
                        return;
                    }
                    const binary = path.resolve(
                        'build',
                        process.platform === 'win32' ? 'ballistics_cli.exe' : 'ballistics_cli',
                    );
                    const output = await runNative(binary, await requestBody(request), request);
                    const parsed = JSON.parse(output) as { ok?: unknown };
                    response.statusCode = parsed.ok === false ? 400 : 200;
                    response.end(output);
                } catch {
                    response.statusCode = 500;
                    response.end(
                        JSON.stringify({ error: 'The development calculation service failed.' }),
                    );
                }
            });
        },
    };
}

export default defineConfig({
    plugins: [react(), cppDevelopmentApi()],
    base: './',
    server: { port: 5173, strictPort: true },
});
