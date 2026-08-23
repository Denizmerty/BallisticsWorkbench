import { BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROTOCOL_VERSION } from '../shared/productIdentity.js';

export type UiSmokeCheck = {
    name: string;
    passed: boolean;
    detail: string;
};

export type UiSmokeReport = {
    schemaVersion: 1;
    passed: boolean;
    rendererChecks: UiSmokeCheck[];
    securityChecks: UiSmokeCheck[];
    csv: {
        file: string;
        bytes: number;
        hasUtf8Bom: boolean;
        loadSections: number;
    };
};

export function uiSmokeOutputArgument(arguments_: string[]) {
    const prefix = '--ui-smoke-output=';
    const matches = arguments_.filter((argument) => argument.startsWith(prefix));
    if (matches.length !== 1 || matches[0].length === prefix.length) {
        throw new Error('UI smoke mode requires exactly one --ui-smoke-output=<directory>.');
    }
    return path.resolve(matches[0].slice(prefix.length));
}

function rendererExercise() {
    const wait = (milliseconds: number) =>
        new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const waitFor = async (predicate: () => boolean, description: string) => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (predicate()) return;
            await wait(50);
        }
        throw new Error(`Timed out waiting for ${description}.`);
    };
    const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const buttonNamed = (name: string) =>
        buttons().find((button) => button.textContent?.trim() === name);
    const activeTab = () => document.querySelector<HTMLButtonElement>('.top-tabs button.active');
    const checks: UiSmokeCheck[] = [];
    const securityChecks: UiSmokeCheck[] = [];
    const check = (name: string, passed: boolean, detail: string) => {
        checks.push({ name, passed, detail });
        if (!passed) throw new Error(`${name}: ${detail}`);
    };
    const securityCheck = (name: string, passed: boolean, detail: string) => {
        securityChecks.push({ name, passed, detail });
        if (!passed) throw new Error(`${name}: ${detail}`);
    };
    const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const input = (element: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    };

    return (async () => {
        await waitFor(
            () => document.querySelectorAll('.loads button').length === 6,
            'six calculated built-in loads',
        );
        await waitFor(
            () => document.querySelector('.statusbar')?.textContent?.includes('Ready') === true,
            'ready engine status',
        );

        const smokeWindow = window as Window & { __ballisticsInlineScriptProbe?: boolean };
        smokeWindow.__ballisticsInlineScriptProbe = false;
        const inlineScript = document.createElement('script');
        inlineScript.textContent = 'window.__ballisticsInlineScriptProbe = true;';
        document.head.append(inlineScript);
        await wait(50);
        inlineScript.remove();
        securityCheck(
            'content-security-policy',
            Reflect.get(smokeWindow, '__ballisticsInlineScriptProbe') !== true,
            'packaged CSP blocked a dynamically inserted inline script',
        );

        const popup = window.open('https://example.invalid', '_blank');
        securityCheck(
            'external-window-blocked',
            popup === null,
            'external window creation returned no browsing context',
        );

        const originalLocation = window.location.href;
        const navigation = document.createElement('a');
        navigation.href = 'https://example.invalid/navigation-probe';
        navigation.textContent = 'Navigation probe';
        document.body.append(navigation);
        navigation.click();
        await wait(100);
        navigation.remove();
        securityCheck(
            'external-navigation-blocked',
            window.location.href === originalLocation,
            'external main-frame navigation left the packaged file URL unchanged',
        );

        const notificationPermission = await Notification.requestPermission();
        securityCheck(
            'permission-request-denied',
            notificationPermission === 'denied',
            `notification permission resolved as ${notificationPermission}`,
        );

        const loadButtons = Array.from(
            document.querySelectorAll<HTMLButtonElement>('.loads button'),
        );
        check(
            'initial-load-count',
            loadButtons.length === 6,
            `${loadButtons.length} loads rendered`,
        );

        loadButtons[1].click();
        await waitFor(
            () =>
                document
                    .querySelectorAll<HTMLButtonElement>('.loads button')[1]
                    ?.classList.contains('active') === true,
            'load selection',
        );
        const selectedLoadButton = document.querySelectorAll<HTMLButtonElement>('.loads button')[1];
        check(
            'pointer-load-selection',
            selectedLoadButton.classList.contains('active'),
            selectedLoadButton.textContent?.trim() ?? '',
        );

        buttonNamed('Imperial')?.click();
        await waitFor(
            () => buttonNamed('Imperial')?.classList.contains('active') === true,
            'imperial unit selection',
        );
        check(
            'unit-control',
            document.querySelector('.statusbar')?.textContent?.includes('US') === true,
            'status bar switched to US units',
        );

        buttonNamed('Dark')?.click();
        await waitFor(
            () => document.querySelector('.app')?.getAttribute('data-theme') === 'dark',
            'dark theme selection',
        );
        check(
            'theme-control',
            document.querySelector('.app')?.getAttribute('data-theme') === 'dark',
            'application theme changed through the toolbar',
        );

        const statusSelects = () =>
            document.querySelectorAll<HTMLSelectElement>('.status-readout select');
        change(statusSelects()[0], 'mach');
        await waitFor(() => statusSelects()[1]?.disabled === false, 'load-specific status mode');
        const liveLoadSelect = statusSelects()[1];
        change(liveLoadSelect, liveLoadSelect.options[1].value);
        await waitFor(
            () =>
                document.querySelector('.status-readout p')?.textContent?.includes('Mach') === true,
            'Mach status readout',
        );
        check(
            'status-select-interaction',
            document.querySelector('.status-readout p')?.textContent?.includes('Mach') === true,
            document.querySelector('.status-readout p')?.textContent?.trim() ?? '',
        );

        window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
        await waitFor(
            () => activeTab()?.textContent?.trim() === 'Range table',
            'range-table shortcut',
        );
        const step = document.querySelector<HTMLSelectElement>('.step select');
        if (!step) throw new Error('Range-table step selector was not rendered.');
        change(step, '50');
        await waitFor(
            () => document.querySelector<HTMLSelectElement>('.step select')?.value === '50',
            'range-table step selection',
        );
        const rowCount = document.querySelectorAll('.table-panel tbody tr').length;
        check('range-table-interaction', rowCount >= 3, `${rowCount} range rows rendered`);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
        await waitFor(() => activeTab()?.textContent?.trim() === 'Help', 'help shortcut');
        const formInput = document.querySelector<HTMLInputElement>('aside input');
        if (!formInput) throw new Error('Sidebar input was not rendered.');
        formInput.focus();
        formInput.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await wait(50);
        check(
            'focused-input-shortcut-safety',
            activeTab()?.textContent?.trim() === 'Help',
            'unmodified tab shortcut did not hijack focused input',
        );

        buttonNamed('New load…')?.click();
        await waitFor(
            () => document.querySelector('[aria-labelledby="custom-load-title"]') !== null,
            'custom-load dialog',
        );
        const dragDataDetails = document.querySelector<HTMLDetailsElement>(
            '.drag-data-transfer details',
        );
        if (!dragDataDetails) throw new Error('Drag-data metadata editor was not rendered.');
        dragDataDetails.open = true;
        dragDataDetails.dispatchEvent(new Event('toggle'));
        const dragDataInputs = document.querySelectorAll<HTMLInputElement>(
            '.drag-data-metadata-grid input',
        );
        const dragExport = buttonNamed('Export…');
        check(
            'drag-data-editor',
            dragDataInputs.length === 6 && dragExport?.disabled === false,
            `${dragDataInputs.length} provenance/domain fields rendered with export available`,
        );
        dragExport?.click();
        await waitFor(
            () =>
                document.querySelector('.drag-data-transfer [role="status"]')?.textContent ===
                'Drag data exported.',
            'native drag-data save path',
        );
        buttonNamed('Import…')?.click();
        await waitFor(
            () =>
                document
                    .querySelector('.drag-data-transfer [role="status"]')
                    ?.textContent?.startsWith('Imported and verified') === true,
            'native drag-data open path',
        );
        check(
            'native-drag-data-dialog-roundtrip',
            document
                .querySelector('.drag-data-transfer [role="status"]')
                ?.textContent?.startsWith('Imported and verified') === true,
            document.querySelector('.drag-data-transfer [role="status"]')?.textContent ?? '',
        );
        document
            .querySelector<HTMLButtonElement>('[aria-label="Close custom projectile editor"]')
            ?.click();
        await waitFor(
            () => document.querySelector('[aria-labelledby="custom-load-title"]') === null,
            'custom-load dialog close',
        );

        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'P',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
            }),
        );
        await waitFor(
            () =>
                document.querySelector(
                    '[role="dialog"][aria-labelledby="profile-manager-title"]',
                ) !== null,
            'profile manager shortcut',
        );
        check(
            'profile-dialog-shortcut',
            document.querySelector('[aria-label="Close profile manager"]') !== null,
            'profile dialog opened with its accessible close control',
        );
        const profileName = document.querySelector<HTMLInputElement>('.profile-name input');
        if (!profileName) throw new Error('Profile name input was not rendered.');
        input(profileName, 'Native dialog smoke profile');
        await waitFor(() => buttonNamed('Save current')?.disabled === false, 'profile name input');
        buttonNamed('Save current')?.click();
        await waitFor(
            () => document.querySelectorAll('.profile-row').length === 1,
            'saved smoke profile',
        );
        buttonNamed('Export all…')?.click();
        await waitFor(
            () => document.querySelector('.profile-notice')?.textContent === 'Exported 1 profile.',
            'native profile save path',
        );
        buttonNamed('Import file…')?.click();
        await waitFor(
            () =>
                document.querySelector('.profile-notice')?.textContent?.includes('1 renamed') ===
                true,
            'native profile open path',
        );
        check(
            'native-profile-dialog-roundtrip',
            document.querySelectorAll('.profile-row').length === 2,
            `${document.querySelectorAll('.profile-row').length} profiles after export/import`,
        );
        document.querySelector<HTMLButtonElement>('[aria-label="Close profile manager"]')?.click();

        const overview = buttonNamed('Overview');
        overview?.click();
        await waitFor(() => activeTab()?.textContent?.trim() === 'Overview', 'overview selection');
        const exportButton = buttonNamed('Export CSV');
        check(
            'csv-action-availability',
            exportButton?.disabled === false,
            'export action enabled for current results',
        );
        exportButton?.click();
        await wait(250);

        return {
            checks,
            securityChecks,
            activeLoad: selectedLoadButton.textContent?.trim() ?? '',
        };
    })();
}

function rendererScript() {
    return `(${rendererExercise.toString()})()`;
}

async function waitForCsv(csvPath: string) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            return await readFile(csvPath);
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    throw new Error('The renderer did not produce the expected CSV export.');
}

async function probeUntrustedIpc(preloadPath: string): Promise<UiSmokeCheck> {
    const untrustedWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            sandbox: true,
        },
    });
    try {
        await untrustedWindow.loadURL('data:text/html,<title>Untrusted IPC probe</title>');
        const result = (await untrustedWindow.webContents.executeJavaScript(
            `window.ballistics.calculate({
                protocolVersion: ${PROTOCOL_VERSION},
                requestId: 'untrusted-frame-probe',
                scenario: {},
                customLoads: []
            }).then(() => 'accepted', (error) => String(error?.message ?? error))`,
            true,
        )) as string;
        return {
            name: 'untrusted-ipc-rejection',
            passed: result.includes('did not come from the application'),
            detail: result,
        };
    } finally {
        untrustedWindow.destroy();
    }
}

export async function runPackagedUiSmoke(
    window: BrowserWindow,
    outputDirectory: string,
    preloadPath: string,
) {
    await mkdir(outputDirectory, { recursive: true });
    const csvPath = path.join(outputDirectory, 'ballistics_range_table.csv');
    const reportPath = path.join(outputDirectory, 'ui-smoke-report.json');
    const renderer = (await window.webContents.executeJavaScript(rendererScript(), true)) as {
        checks: UiSmokeCheck[];
        securityChecks: UiSmokeCheck[];
        activeLoad: string;
    };
    const securityChecks = [
        ...renderer.securityChecks,
        await probeUntrustedIpc(preloadPath),
        {
            name: 'popup-window-count',
            passed: BrowserWindow.getAllWindows().length === 1,
            detail: `${BrowserWindow.getAllWindows().length} application window remained`,
        },
    ];
    const csv = await waitForCsv(csvPath);
    const csvText = csv.toString('utf8');
    const loadSections = (csvText.match(/^"# Trajectory events"/gm) ?? []).length;
    const report: UiSmokeReport = {
        schemaVersion: 1,
        passed:
            renderer.checks.length >= 8 &&
            renderer.checks.every((check) => check.passed) &&
            securityChecks.length >= 6 &&
            securityChecks.every((check) => check.passed) &&
            csv.length > 1_000 &&
            csv[0] === 0xef &&
            csv[1] === 0xbb &&
            csv[2] === 0xbf &&
            loadSections === 6,
        rendererChecks: renderer.checks,
        securityChecks,
        csv: {
            file: path.basename(csvPath),
            bytes: csv.length,
            hasUtf8Bom: csv[0] === 0xef && csv[1] === 0xbb && csv[2] === 0xbf,
            loadSections,
        },
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (!report.passed) throw new Error('Packaged UI smoke checks did not all pass.');
    return report;
}
