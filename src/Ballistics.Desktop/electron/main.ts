import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import type { MenuItemConstructorOptions, OpenDialogOptions } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    calculationRequestId,
    EngineResponseCollector,
    serializeCalculationRequest,
    validateCsvExport,
    validateDragDataDocument,
    validateProfileDocument,
} from './security.js';
import { runPackagedUiSmoke, uiSmokeOutputArgument } from './uiSmoke.js';
import { MODEL_VERSION, PRODUCT_LIMITS, PROTOCOL_VERSION } from '../shared/productIdentity.js';
const projectRoot = app.getAppPath();
const isMac = process.platform === 'darwin';
const cliName = process.platform === 'win32' ? 'ballistics_cli.exe' : 'ballistics_cli';
const windowIconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
const profileDocumentLimitBytes = PRODUCT_LIMITS.profileDocumentBytes;
const dragDataDocumentLimitBytes = PRODUCT_LIMITS.dragDataDocumentBytes;
const engineSmokeTestMode = process.argv.includes('--smoke-test');
const uiSmokeTestMode = process.argv.includes('--ui-smoke-test');
const smokeTestMode = engineSmokeTestMode || uiSmokeTestMode;
const uiSmokeOutputDirectory = uiSmokeTestMode ? uiSmokeOutputArgument(process.argv) : null;
const uiSmokeDialogDirectory = uiSmokeOutputDirectory
    ? path.join(uiSmokeOutputDirectory, 'native-dialog-files')
    : null;
let uiSmokeProfilePath: string | null = null;
let uiSmokeDragDataPath: string | null = null;
const activeCalculations = new Map<string, AbortController>();
const trustedRendererIds = new Set<number>();
const hardenedSessions = new WeakSet<Electron.Session>();
const productionCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');
if (smokeTestMode) {
    app.disableHardwareAcceleration();
    app.setPath(
        'userData',
        uiSmokeOutputDirectory
            ? path.join(uiSmokeOutputDirectory, 'profile')
            : path.join(path.dirname(process.execPath), '.smoke-profile'),
    );
}

async function calculateNative(request: unknown, calculationKey?: string) {
    const developmentBinaries = [
        path.join(projectRoot, 'build', 'stage', 'bin', cliName),
        path.join(projectRoot, 'build', cliName),
    ];
    const binary = app.isPackaged
        ? path.join(process.resourcesPath, 'bin', cliName)
        : (developmentBinaries.find(existsSync) ?? developmentBinaries[0]);
    const requestText = serializeCalculationRequest(request);
    const controller = new AbortController();
    if (calculationKey) {
        activeCalculations.get(calculationKey)?.abort();
        activeCalculations.set(calculationKey, controller);
    }
    try {
        return await new Promise<unknown>((resolve, reject) => {
            const child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            const response = new EngineResponseCollector();
            let settled = false;
            let timedOut = false;
            const finish = (action: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                controller.signal.removeEventListener('abort', abort);
                action();
            };
            const abort = () => child.kill();
            const timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, 30_000);
            controller.signal.addEventListener('abort', abort, { once: true });
            child.stdout.on('data', (chunk: Buffer) => {
                try {
                    response.append(chunk);
                } catch (error) {
                    controller.abort();
                    finish(() => reject(error));
                }
            });
            child.stderr.resume();
            child.on('error', () =>
                finish(() =>
                    reject(new Error('The native ballistics engine could not be started.')),
                ),
            );
            child.on('close', () => {
                if (controller.signal.aborted) {
                    finish(() =>
                        reject(
                            new Error(
                                timedOut
                                    ? 'The ballistics engine timed out.'
                                    : 'Calculation was cancelled.',
                            ),
                        ),
                    );
                    return;
                }
                try {
                    const parsed = response.parseJson();
                    finish(() => resolve(parsed));
                } catch (error) {
                    finish(() => reject(error));
                }
            });
            child.stdin.on('error', () => undefined);
            child.stdin.end(requestText, 'utf8');
        });
    } finally {
        if (calculationKey && activeCalculations.get(calculationKey) === controller) {
            activeCalculations.delete(calculationKey);
        }
    }
}

function allowedRendererUrl(url: string) {
    if (!app.isPackaged)
        return url === 'http://localhost:5173/' || url.startsWith('http://localhost:5173/');
    const distPrefix = pathToFileURL(`${path.join(projectRoot, 'dist')}${path.sep}`).href;
    return url.startsWith(distPrefix);
}

function trustedIpcSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
    return (
        trustedRendererIds.has(event.sender.id) &&
        event.senderFrame === event.sender.mainFrame &&
        allowedRendererUrl(event.senderFrame.url)
    );
}

function requireTrustedIpcSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
    if (!trustedIpcSender(event))
        throw new Error('The IPC request did not come from the application.');
}

async function readBoundedUtf8File(filePath: string, byteLimit: number, oversizedMessage: string) {
    const file = await open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(byteLimit + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > byteLimit) throw new Error(oversizedMessage);
        return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
        await file.close();
    }
}

ipcMain.handle('ballistics:calculate', async (event, request: unknown) => {
    requireTrustedIpcSender(event);
    const senderPrefix = `${event.sender.id}:`;
    for (const [key, calculation] of activeCalculations) {
        if (key.startsWith(senderPrefix)) calculation.abort();
    }
    const requestId = calculationRequestId(request);
    return calculateNative(request, `${senderPrefix}${requestId}`);
});
ipcMain.on('ballistics:cancel-calculation', (event, requestId: string) => {
    if (!trustedIpcSender(event) || typeof requestId !== 'string' || requestId.length > 128) return;
    activeCalculations.get(`${event.sender.id}:${requestId}`)?.abort();
});
ipcMain.handle('ballistics:save-csv', async (event, content: unknown, defaultName: unknown) => {
    requireTrustedIpcSender(event);
    const exportData = validateCsvExport(content, defaultName);
    if (uiSmokeOutputDirectory) {
        await mkdir(uiSmokeOutputDirectory, { recursive: true });
        await writeFile(
            path.join(uiSmokeOutputDirectory, exportData.defaultName),
            exportData.content,
            'utf8',
        );
        return true;
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
        title: 'Export range table',
        defaultPath: exportData.defaultName,
        filters: [{ name: 'CSV files', extensions: ['csv'] }],
    };
    const selection = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return false;
    await writeFile(selection.filePath, exportData.content, 'utf8');
    return true;
});
ipcMain.handle(
    'ballistics:save-profiles',
    async (event, content: unknown, defaultName: unknown) => {
        requireTrustedIpcSender(event);
        const exportData = validateProfileDocument(content, defaultName);
        if (uiSmokeDialogDirectory) {
            await mkdir(uiSmokeDialogDirectory, { recursive: true });
            uiSmokeProfilePath = path.join(uiSmokeDialogDirectory, exportData.defaultName);
            await writeFile(uiSmokeProfilePath, exportData.content, 'utf8');
            return true;
        }
        const owner = BrowserWindow.fromWebContents(event.sender);
        const options = {
            title: 'Export Ballistics Workbench profiles',
            defaultPath: exportData.defaultName,
            filters: [{ name: 'Ballistics Workbench profiles', extensions: ['json'] }],
        };
        const selection = owner
            ? await dialog.showSaveDialog(owner, options)
            : await dialog.showSaveDialog(options);
        if (selection.canceled || !selection.filePath) return false;
        await writeFile(selection.filePath, exportData.content, 'utf8');
        return true;
    },
);
ipcMain.handle('ballistics:open-profiles', async (event) => {
    requireTrustedIpcSender(event);
    if (uiSmokeDialogDirectory) {
        if (!uiSmokeProfilePath) {
            throw new Error('The UI smoke test must export profiles before importing them.');
        }
        const content = await readBoundedUtf8File(
            uiSmokeProfilePath,
            profileDocumentLimitBytes,
            'Profile document exceeds the 1 MiB limit.',
        );
        const imported = validateProfileDocument(content, path.basename(uiSmokeProfilePath));
        return { content: imported.content, fileName: imported.defaultName };
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
        title: 'Import Ballistics Workbench profiles',
        properties: ['openFile'],
        filters: [{ name: 'Ballistics Workbench profiles', extensions: ['json'] }],
    };
    const selection = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    const selectedPath = selection.filePaths[0];
    const content = await readBoundedUtf8File(
        selectedPath,
        profileDocumentLimitBytes,
        'Profile document exceeds the 1 MiB limit.',
    );
    const imported = validateProfileDocument(content, path.basename(selectedPath));
    return { content: imported.content, fileName: imported.defaultName };
});

ipcMain.handle(
    'ballistics:save-drag-data',
    async (event, content: unknown, defaultName: unknown) => {
        requireTrustedIpcSender(event);
        const exportData = validateDragDataDocument(content, defaultName);
        if (uiSmokeDialogDirectory) {
            await mkdir(uiSmokeDialogDirectory, { recursive: true });
            uiSmokeDragDataPath = path.join(uiSmokeDialogDirectory, exportData.defaultName);
            await writeFile(uiSmokeDragDataPath, exportData.content, 'utf8');
            return true;
        }
        const owner = BrowserWindow.fromWebContents(event.sender);
        const options = {
            title: 'Export drag data',
            defaultPath: exportData.defaultName,
            filters: [{ name: 'Ballistics Workbench drag data', extensions: ['json'] }],
        };
        const selection = owner
            ? await dialog.showSaveDialog(owner, options)
            : await dialog.showSaveDialog(options);
        if (selection.canceled || !selection.filePath) return false;
        await writeFile(selection.filePath, exportData.content, 'utf8');
        return true;
    },
);

ipcMain.handle('ballistics:open-drag-data', async (event) => {
    requireTrustedIpcSender(event);
    if (uiSmokeDialogDirectory) {
        if (!uiSmokeDragDataPath) {
            throw new Error('The UI smoke test must export drag data before importing it.');
        }
        const content = await readBoundedUtf8File(
            uiSmokeDragDataPath,
            dragDataDocumentLimitBytes,
            'Drag-data document exceeds the 1 MiB limit.',
        );
        const imported = validateDragDataDocument(content, path.basename(uiSmokeDragDataPath));
        return { content: imported.content, fileName: imported.defaultName };
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
        title: 'Import drag data',
        properties: ['openFile'],
        filters: [{ name: 'Ballistics Workbench drag data', extensions: ['json'] }],
    };
    const selection = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    const selectedPath = selection.filePaths[0];
    const content = await readBoundedUtf8File(
        selectedPath,
        dragDataDocumentLimitBytes,
        'Drag-data document exceeds the 1 MiB limit.',
    );
    const imported = validateDragDataDocument(content, path.basename(selectedPath));
    return { content: imported.content, fileName: imported.defaultName };
});

function hardenWindow(window: BrowserWindow) {
    const { webContents } = window;
    trustedRendererIds.add(webContents.id);
    window.on('closed', () => {
        trustedRendererIds.delete(webContents.id);
        const senderPrefix = `${webContents.id}:`;
        for (const [key, calculation] of activeCalculations) {
            if (key.startsWith(senderPrefix)) calculation.abort();
        }
    });
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-navigate', (event, navigationUrl) => {
        if (!allowedRendererUrl(navigationUrl)) event.preventDefault();
    });

    const { session } = webContents;
    if (hardenedSessions.has(session)) return;
    hardenedSessions.add(session);
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    if (app.isPackaged) {
        session.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
            const responseHeaders = { ...details.responseHeaders };
            for (const name of Object.keys(responseHeaders)) {
                if (name.toLowerCase() === 'content-security-policy') delete responseHeaders[name];
            }
            responseHeaders['Content-Security-Policy'] = [productionCsp];
            callback({ responseHeaders });
        });
    }
}

function installApplicationMenu() {
    const sendToWindow = (channel: string) =>
        BrowserWindow.getFocusedWindow()?.webContents.send(channel);
    const template: MenuItemConstructorOptions[] = [
        ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'Profiles…',
                    accelerator: 'CmdOrCtrl+Shift+P',
                    click: () => sendToWindow('menu:open-profiles'),
                },
                {
                    label: 'Import profiles…',
                    click: () => sendToWindow('menu:import-profiles'),
                },
                {
                    label: 'Export profiles…',
                    click: () => sendToWindow('menu:export-profiles'),
                },
                { type: 'separator' },
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
                            detail: [
                                'Developed and maintained by Deniz Mert Yayla.',
                                'For bug reports, proposed fixes, and suggestions, email denizmerty@gmail.com.',
                                'Licensed under the GNU General Public License, version 3 or any later version.',
                                'Results are computational estimates. Confirm firearm setup and trajectory ' +
                                    'with real-world measurement.',
                            ].join('\n\n'),
                        }),
                },
            ],
        },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function applicationPreloadPath() {
    return app.isPackaged
        ? path.join(app.getAppPath(), 'src', 'Ballistics.Desktop', 'electron', 'preload.cjs')
        : path.join(projectRoot, 'src', 'Ballistics.Desktop', 'electron', 'preload.cjs');
}

async function createWindow() {
    const preloadPath = applicationPreloadPath();
    const window = new BrowserWindow({
        width: 1480,
        height: 940,
        minWidth: 1040,
        minHeight: 680,
        icon: path.join(projectRoot, 'assets', windowIconName),
        backgroundColor: '#e8eaed',
        autoHideMenuBar: false,
        show: !uiSmokeTestMode,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            sandbox: true,
        },
    });
    hardenWindow(window);
    if (process.argv.includes('--dev')) await window.loadURL('http://localhost:5173');
    else await window.loadFile(path.join(projectRoot, 'dist', 'index.html'));
    return window;
}

app.whenReady().then(async () => {
    if (engineSmokeTestMode) {
        try {
            const result = (await calculateNative({
                protocolVersion: PROTOCOL_VERSION,
                requestId: 'packaged-smoke-test',
                scenario: {
                    displayDistanceM: 100,
                    solutionHorizonM: 2000,
                    vitalZoneM: 0.2,
                    atmosphere: {
                        temperatureC: 15,
                        stationPressureHpa: 1013.25,
                        relativeHumidityPercent: 50,
                        headwindMps: 0,
                        crosswindMps: 0,
                    },
                    firearms: {
                        shotgun: {
                            sightHeightM: 0.025,
                            zeroRangeM: 50,
                            muzzleVelocityMultiplier: 1,
                        },
                        rifle: {
                            sightHeightM: 0.04,
                            zeroRangeM: 100,
                            muzzleVelocityMultiplier: 1,
                            twistInches: 10,
                            twistDirection: 1,
                        },
                    },
                },
                customLoads: [],
            })) as {
                ok?: boolean;
                modelVersion?: string;
                loads?: Array<{
                    id?: string;
                    coveredDistanceM?: number;
                    points?: Array<{ distanceM?: number; speedMps?: number; pathM?: number }>;
                    trajectoryEvents?: {
                        zeroCrossingsStatus?: string;
                        farZeroM?: number | null;
                    };
                }>;
            };
            const hornady = result.loads?.find((load) => load.id === 'builtin:hornady-amax-168');
            const hundredMetrePoint = hornady?.points?.find(
                (point) => Math.abs((point.distanceM ?? -1) - 100) < 1e-7,
            );
            const representativeResultIsValid =
                result.ok === true &&
                result.modelVersion === MODEL_VERSION &&
                result.loads?.length === 6 &&
                hornady?.coveredDistanceM === 100 &&
                (hundredMetrePoint?.speedMps ?? 0) > 760 &&
                (hundredMetrePoint?.speedMps ?? 0) < 762 &&
                Math.abs(hundredMetrePoint?.pathM ?? 1) < 0.0001 &&
                hornady?.trajectoryEvents?.zeroCrossingsStatus === 'complete' &&
                Math.abs((hornady.trajectoryEvents.farZeroM ?? 0) - 100) < 0.001;
            const smokeStatus = representativeResultIsValid ? 'passed' : 'failed';
            const smokeLoadCount = result.loads?.length ?? 0;
            console.log(
                `Smoke test ${smokeStatus}: ${smokeLoadCount} loads returned by packaged C++ engine.`,
            );
            app.exit(representativeResultIsValid ? 0 : 3);
        } catch (error) {
            console.error('Smoke test failed:', error);
            app.exit(2);
        }
        return;
    }
    if (uiSmokeTestMode) {
        try {
            const window = await createWindow();
            const report = await runPackagedUiSmoke(
                window,
                uiSmokeOutputDirectory!,
                applicationPreloadPath(),
            );
            console.log(
                `UI smoke test passed: ${report.rendererChecks.length} renderer checks and ` +
                    `${report.securityChecks.length} security checks with ` +
                    `${report.csv.loadSections} CSV load sections.`,
            );
            app.exit(0);
        } catch (error) {
            console.error('UI smoke test failed:', error);
            app.exit(4);
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
