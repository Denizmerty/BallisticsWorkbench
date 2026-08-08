import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const isMac = process.platform === 'darwin';
const cliName = process.platform === 'win32' ? 'ballistics_cli.exe' : 'ballistics_cli';
const smokeTestMode = process.argv.includes('--smoke-test');
if (smokeTestMode) {
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(path.dirname(process.execPath), '.smoke-profile'));
}

async function calculateNative(input: Record<string, number | string | undefined>) {
  const developmentBinaries = [
    path.join(projectRoot, 'x64', 'Release', cliName),
    path.join(projectRoot, 'x64', 'Debug', cliName),
    path.join(projectRoot, 'build', cliName),
    path.join(projectRoot, 'build', 'Release', cliName),
  ];
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', cliName)
    : (developmentBinaries.find(existsSync) ?? developmentBinaries[0]);
  const args = [
    '--distance',
    String(input.distanceM),
    '--temperature',
    String(input.temperatureC),
    '--pressure',
    String(input.pressureHpa),
    '--humidity',
    String(input.humidityPercent),
    '--headwind',
    String(input.headwindMps),
    '--crosswind',
    String(input.crosswindMps),
    '--vital-zone',
    String(input.vitalZoneM),
    '--shotgun-sight',
    String(input.shotgunSightM),
    '--rifle-sight',
    String(input.rifleSightM),
    '--shotgun-mv',
    String(input.shotgunMvMultiplier),
    '--rifle-mv',
    String(input.rifleMvMultiplier),
    '--rifle-twist',
    String(input.rifleTwistInches),
    '--twist-direction',
    String(input.twistDirection),
  ];
  if (input.customName)
    args.push(
      '--custom-name',
      String(input.customName),
      '--custom-drag',
      String(input.customDrag),
      '--custom-group',
      String(input.customGroup),
      '--custom-mass',
      String(input.customMassKg),
      '--custom-mv',
      String(input.customMuzzleVelocityMps),
      '--custom-bc',
      String(input.customBc),
      '--custom-sphere-diameter',
      String(input.customSphereDiameterM),
      '--custom-density',
      String(input.customDensityKgM3),
      '--custom-count',
      String(input.customPelletCount),
      '--custom-length',
      String(input.customBulletLengthInches),
      '--custom-diameter',
      String(input.customBulletDiameterInches),
      '--custom-twist',
      String(input.customTwistInches),
    );
  const { stdout } = await execute(binary, args, { maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

ipcMain.handle(
  'ballistics:calculate',
  async (_event, input: Record<string, number | string | undefined>) => calculateNative(input),
);
ipcMain.handle('ballistics:save-csv', async (event, content: string, defaultName: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: 'Export range table',
    defaultPath: defaultName,
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  };
  const selection = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (selection.canceled || !selection.filePath) return false;
  await writeFile(selection.filePath, content, 'utf8');
  return true;
});

function installApplicationMenu() {
  const sendToWindow = (channel: string) =>
    BrowserWindow.getFocusedWindow()?.webContents.send(channel);
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Export range table…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToWindow('menu:export-csv'),
        },
        { type: 'separator' },
        {
          label: 'Add custom projectile…',
          click: () => sendToWindow('menu:add-custom'),
        },
        { type: 'separator' },
        isMac
          ? { role: 'close' }
          : { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle dark / light theme',
          click: () => sendToWindow('menu:toggle-theme'),
        },
        {
          label: 'Toggle metric / imperial',
          click: () => sendToWindow('menu:toggle-units'),
        },
        {
          label: 'Reset atmosphere',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendToWindow('menu:reset-atmosphere'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Ballistics Workbench Help',
          accelerator: 'F1',
          click: () => sendToWindow('menu:open-help'),
        },
        { type: 'separator' },
        {
          label: 'About Ballistics Workbench',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'About Ballistics Workbench',
              message: `Ballistics Workbench ${app.getVersion()}`,
              detail:
                'Developed and maintained by Deniz Mert Yayla.\n\nFor bug reports, proposed fixes, and suggestions, email denizmerty@gmail.com.\n\nLicensed under the GNU General Public License, version 3 or any later version.\n\nResults are computational estimates. Confirm firearm setup and trajectory with real-world measurement.',
            }),
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    icon: path.join(projectRoot, 'assets', 'icon.ico'),
    backgroundColor: '#e8eaed',
    autoHideMenuBar: false,
    show: true,
    webPreferences: {
      preload: app.isPackaged
        ? path.join(app.getAppPath(), 'src', 'Ballistics.Desktop', 'electron', 'preload.cjs')
        : path.join(projectRoot, 'src', 'Ballistics.Desktop', 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (process.argv.includes('--dev')) await window.loadURL('http://localhost:5173');
  else await window.loadFile(path.join(projectRoot, 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  if (smokeTestMode) {
    try {
      const result = await calculateNative({
        distanceM: 100,
        temperatureC: 15,
        pressureHpa: 1013.25,
        humidityPercent: 50,
        headwindMps: 0,
        crosswindMps: 0,
        vitalZoneM: 0.2,
        shotgunSightM: 0.025,
        rifleSightM: 0.04,
        shotgunMvMultiplier: 1,
        rifleMvMultiplier: 1,
        rifleTwistInches: 10,
        twistDirection: 1,
      });
      console.log(
        `Smoke test passed: ${result.loads.length} loads returned by packaged C++ engine.`,
      );
      app.exit(result.loads.length >= 6 ? 0 : 3);
    } catch (error) {
      console.error('Smoke test failed:', error);
      app.exit(2);
    }
    return;
  }
  installApplicationMenu();
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
