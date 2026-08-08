import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

function cppDevelopmentApi() {
  return {
    name: 'cpp-development-api',
    configureServer(server: {
      middlewares: {
        use: (
          route: string,
          handler: (
            req: { url?: string },
            res: {
              statusCode: number;
              setHeader: (key: string, value: string) => void;
              end: (body: string) => void;
            },
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use('/api/calculate', async (req, res) => {
        try {
          const query = new URL(req.url || '/', 'http://localhost').searchParams;
          const names: Record<string, string> = {
            distanceM: '--distance',
            temperatureC: '--temperature',
            pressureHpa: '--pressure',
            humidityPercent: '--humidity',
            headwindMps: '--headwind',
            crosswindMps: '--crosswind',
            vitalZoneM: '--vital-zone',
            shotgunSightM: '--shotgun-sight',
            rifleSightM: '--rifle-sight',
            shotgunMvMultiplier: '--shotgun-mv',
            rifleMvMultiplier: '--rifle-mv',
            rifleTwistInches: '--rifle-twist',
            twistDirection: '--twist-direction',
          };
          const args: string[] = [];
          for (const [key, flag] of Object.entries(names)) {
            const value = query.get(key);
            if (value !== null) {
              if (!Number.isFinite(Number(value))) throw new Error(`Invalid ${key}`);
              args.push(flag, value);
            }
          }
          const customFlags: Record<string, string> = {
            customName: '--custom-name',
            customDrag: '--custom-drag',
            customGroup: '--custom-group',
            customMassKg: '--custom-mass',
            customMuzzleVelocityMps: '--custom-mv',
            customBc: '--custom-bc',
            customSphereDiameterM: '--custom-sphere-diameter',
            customDensityKgM3: '--custom-density',
            customPelletCount: '--custom-count',
            customBulletLengthInches: '--custom-length',
            customBulletDiameterInches: '--custom-diameter',
            customTwistInches: '--custom-twist',
          };
          for (const [key, flag] of Object.entries(customFlags)) {
            const value = query.get(key);
            if (value !== null) args.push(flag, value);
          }
          const binary = path.resolve('build/ballistics_cli.exe');
          const { stdout } = await execute(binary, args, { maxBuffer: 16 * 1024 * 1024 });
          res.setHeader('Content-Type', 'application/json');
          res.end(stdout);
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
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
