import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {
    generatedProductConsumerPaths,
    readProductMetadata,
    releaseIdentity,
    renderProductIdentityTypeScript,
    synchronizeProductMetadata,
    validateProductMetadata,
} from './product-metadata.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const temporaryDirectories = [];

async function temporaryDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'ballistics-product-metadata-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

async function copyFixture() {
    const root = await temporaryDirectory();
    const paths = [
        '.editorconfig',
        '.prettierrc.json',
        'config/product-metadata.json',
        'config/product-metadata.schema.json',
        ...generatedProductConsumerPaths,
    ];
    for (const path of paths) {
        const destination = join(root, path);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(join(repositoryRoot, path), destination);
    }
    return root;
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

describe('authoritative product metadata', () => {
    it('is schema-valid and exposes the public release identity', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        expect(releaseIdentity(metadata)).toEqual({
            application: metadata.applicationVersion,
            engine: metadata.applicationVersion,
            model: metadata.modelVersion,
            protocol: metadata.protocolVersion,
            profileInterchange: metadata.profileInterchangeVersion,
            dragDataInterchange: metadata.dragDataInterchangeVersion,
        });
    });

    it('rejects unknown declarations and malformed versions', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        expect(() => validateProductMetadata({ ...metadata, extra: true })).toThrow(
            'keys must be exactly',
        );
        expect(() => validateProductMetadata({ ...metadata, applicationVersion: 'v1' })).toThrow(
            'semantic version',
        );
        expect(() => validateProductMetadata({ ...metadata, modelVersion: 'August' })).toThrow(
            'YYYY.MM.revision',
        );
        expect(() => validateProductMetadata({ ...metadata, protocolVersion: 0 })).toThrow(
            'positive integer',
        );
    });

    it('rejects unsafe or incomplete byte-limit declarations', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        expect(() =>
            validateProductMetadata({
                ...metadata,
                limits: { ...metadata.limits, calculationRequestBytes: 100 },
            }),
        ).toThrow('at least 1024');
        const { csvExportBytes: _omitted, ...incompleteLimits } = metadata.limits;
        expect(() => validateProductMetadata({ ...metadata, limits: incompleteLimits })).toThrow(
            'limit keys must be exactly',
        );
        expect(() =>
            validateProductMetadata({
                ...metadata,
                limits: {
                    ...metadata.limits,
                    engineResponseBytes: metadata.limits.calculationRequestBytes,
                },
            }),
        ).toThrow('response limit must exceed');
    });

    it('renders literal TypeScript declarations from metadata', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        const output = renderProductIdentityTypeScript(metadata);
        expect(output).toContain(`APPLICATION_VERSION = '${metadata.applicationVersion}'`);
        expect(output).toContain(`MODEL_VERSION = '${metadata.modelVersion}'`);
        expect(output).toContain(`PROTOCOL_VERSION = ${metadata.protocolVersion}`);
        expect(output).toContain(`engineResponseBytes: ${metadata.limits.engineResponseBytes}`);
    });

    it('detects drift, repairs every consumer, and becomes idempotent', async () => {
        const root = await copyFixture();
        await expect(synchronizeProductMetadata(root)).resolves.toMatchObject({ changed: [] });
        const metadataPath = join(root, 'config/product-metadata.json');
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        metadata.applicationVersion = '1.2.3';
        metadata.modelVersion = '2026.08.99';
        metadata.protocolVersion = 4;
        metadata.profileInterchangeVersion = 3;
        metadata.dragDataInterchangeVersion = 2;
        await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

        const drift = await synchronizeProductMetadata(root);
        expect(drift.changed).toContain('package.json');
        expect(drift.changed).toContain('protocol/ballistics-protocol.schema.json');
        expect(drift.changed).toContain('validation/manifest.json');
        expect(drift.changed).toContain('src/Ballistics.Desktop/shared/productIdentity.ts');

        await synchronizeProductMetadata(root, { write: true });
        await expect(synchronizeProductMetadata(root)).resolves.toMatchObject({ changed: [] });
        const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        const protocolSchema = JSON.parse(
            await readFile(join(root, 'protocol/ballistics-protocol.schema.json'), 'utf8'),
        );
        const profileSchema = JSON.parse(
            await readFile(
                join(root, 'protocol/ballistics-profile-interchange.schema.json'),
                'utf8',
            ),
        );
        const dragDataSchema = JSON.parse(
            await readFile(join(root, 'protocol/ballistics-drag-data.schema.json'), 'utf8'),
        );
        expect(packageJson.version).toBe('1.2.3');
        expect(protocolSchema.$id).toContain('/v4/');
        expect(profileSchema.properties.schemaVersion.const).toBe(3);
        expect(dragDataSchema.properties.schemaVersion.const).toBe(2);
    });

    it('keeps protocol schema declarations and checked-in fixtures synchronized', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        const schema = JSON.parse(
            await readFile(
                join(repositoryRoot, 'protocol/ballistics-protocol.schema.json'),
                'utf8',
            ),
        );
        const declarations = [];
        const visit = (value) => {
            if (!value || typeof value !== 'object') return;
            if (value.properties?.protocolVersion?.const !== undefined) {
                declarations.push(value.properties.protocolVersion.const);
            }
            Object.values(value).forEach(visit);
        };
        visit(schema);
        expect(declarations.length).toBeGreaterThanOrEqual(5);
        expect(new Set(declarations)).toEqual(new Set([metadata.protocolVersion]));
        expect(schema.$id).toContain(`/v${metadata.protocolVersion}/`);

        const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
        for (const path of [
            'tests/protocol/valid-calibration.json',
            'tests/protocol/valid-multiple-loads.json',
        ]) {
            const fixture = JSON.parse(await readFile(join(repositoryRoot, path), 'utf8'));
            expect(validate(fixture), `${path}: ${JSON.stringify(validate.errors)}`).toBe(true);
        }
        const unsupported = JSON.parse(
            await readFile(join(repositoryRoot, 'tests/protocol/unsupported-version.json'), 'utf8'),
        );
        expect(validate(unsupported)).toBe(false);
    });

    it('keeps profile-interchange schema identity synchronized', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        const schema = JSON.parse(
            await readFile(
                join(repositoryRoot, 'protocol/ballistics-profile-interchange.schema.json'),
                'utf8',
            ),
        );
        expect(schema.properties.schemaVersion.const).toBe(metadata.profileInterchangeVersion);
        const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
        expect(
            validate({
                format: 'ballistics-workbench-profile-set',
                schemaVersion: metadata.profileInterchangeVersion,
                exportedAt: '2026-08-22T00:00:00.000Z',
                unitConvention: 'SI',
                profiles: [
                    {
                        id: 'profile:contract-test',
                        name: 'Contract test',
                        kind: 'environment',
                        createdAt: '2026-08-22T00:00:00.000Z',
                        updatedAt: '2026-08-22T00:00:00.000Z',
                        data: {
                            temperatureC: 15,
                            pressureHpa: 1013.25,
                            pressureSource: 'stationPressure',
                            pressureAltitudeM: 0,
                            geometricAltitudeM: 0,
                            altimeterSettingHpa: 1013.25,
                            humidityPercent: 50,
                            headwindMps: 0,
                            crosswindMps: 0,
                            altitudeDependentAtmosphere: false,
                            useLocalGravity: false,
                            coriolisEnabled: false,
                            latitudeDeg: 45,
                            azimuthDeg: 0,
                            windLayers: [],
                            windProvenance: '',
                        },
                    },
                ],
            }),
            JSON.stringify(validate.errors),
        ).toBe(true);
    });

    it('keeps drag-data schema identity synchronized', async () => {
        const metadata = await readProductMetadata(repositoryRoot);
        const schema = JSON.parse(
            await readFile(
                join(repositoryRoot, 'protocol/ballistics-drag-data.schema.json'),
                'utf8',
            ),
        );
        expect(schema.properties.schemaVersion.const).toBe(metadata.dragDataInterchangeVersion);
        const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
        expect(
            validate({
                format: 'ballistics-workbench-drag-data',
                schemaVersion: metadata.dragDataInterchangeVersion,
                exportedAt: '2026-08-23T00:00:00.000Z',
                name: 'Contract fixture',
                units: {
                    velocity: 'm/s',
                    referenceDiameter: 'm',
                    mach: 'dimensionless',
                    dragCoefficient: 'dimensionless',
                    ballisticCoefficient: 'lb/in^2',
                },
                source: {
                    citation: 'Contract test',
                    url: null,
                    license: 'Test only',
                    checksumSha256: null,
                },
                declaredDomain: {
                    variable: 'velocity',
                    minimum: 0,
                    maximum: 1_000,
                    unit: 'm/s',
                },
                drag: {
                    kind: 'referenceBc',
                    curve: 'G7',
                    representation: 'constant',
                    ballisticCoefficient: 0.475,
                },
                payloadChecksumSha256: 'a'.repeat(64),
            }),
            JSON.stringify(validate.errors),
        ).toBe(true);
    });
});
