import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { format, getFileInfo, resolveConfig } from 'prettier';

const metadataPath = 'config/product-metadata.json';
const metadataSchemaPath = 'config/product-metadata.schema.json';
const generatedTypeScriptPath = 'src/Ballistics.Desktop/shared/productIdentity.ts';
const modelArtifactPaths = [
    'validation/manifest.json',
    'validation/normalized/builtin-loads.json',
    'validation/scenarios/independent-flight-matrix.json',
    'validation/fitting/builtin-blackshock.json',
    'validation/fitting/builtin-federal-sp-150.json',
    'validation/fitting/builtin-white-blackout-hv.json',
];
const validProtocolFixturePaths = [
    'tests/protocol/valid-calibration.json',
    'tests/protocol/valid-multiple-loads.json',
];
const unsupportedProtocolFixturePath = 'tests/protocol/unsupported-version.json';

export const generatedProductConsumerPaths = Object.freeze([
    'package.json',
    'package-lock.json',
    'protocol/ballistics-protocol.schema.json',
    'protocol/ballistics-profile-interchange.schema.json',
    'protocol/ballistics-drag-data.schema.json',
    ...validProtocolFixturePaths,
    unsupportedProtocolFixturePath,
    ...modelArtifactPaths,
    generatedTypeScriptPath,
]);

const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function formattedJson(value, path) {
    const [fileInformation, prettierOptions] = await Promise.all([
        getFileInfo(path),
        resolveConfig(path, { editorconfig: true }),
    ]);
    return format(jsonText(value), {
        ...(prettierOptions ?? {}),
        filepath: path,
        parser: fileInformation.inferredParser ?? 'json',
    });
}

function assertPlainObject(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
}

export function validateProductMetadata(metadata) {
    assertPlainObject(metadata, 'Product metadata');
    const expectedKeys = [
        '$schema',
        'applicationVersion',
        'dragDataInterchangeVersion',
        'limits',
        'modelVersion',
        'profileInterchangeVersion',
        'protocolVersion',
        'settingsSchemaVersion',
    ];
    const actualKeys = Object.keys(metadata).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        throw new Error(`Product metadata keys must be exactly: ${expectedKeys.join(', ')}.`);
    }
    if (metadata.$schema !== './product-metadata.schema.json') {
        throw new Error('Product metadata must reference its checked-in schema.');
    }
    if (
        !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
            metadata.applicationVersion,
        )
    ) {
        throw new Error('applicationVersion must be a semantic version.');
    }
    if (!/^\d{4}\.\d{2}\.\d+$/.test(metadata.modelVersion)) {
        throw new Error('modelVersion must use YYYY.MM.revision notation.');
    }
    for (const field of [
        'protocolVersion',
        'profileInterchangeVersion',
        'dragDataInterchangeVersion',
        'settingsSchemaVersion',
    ]) {
        if (!Number.isInteger(metadata[field]) || metadata[field] < 1) {
            throw new Error(`${field} must be a positive integer.`);
        }
    }
    assertPlainObject(metadata.limits, 'Product metadata limits');
    const expectedLimitKeys = [
        'calculationRequestBytes',
        'csvExportBytes',
        'dragDataDocumentBytes',
        'engineResponseBytes',
        'profileDocumentBytes',
    ];
    const actualLimitKeys = Object.keys(metadata.limits).sort();
    if (JSON.stringify(actualLimitKeys) !== JSON.stringify(expectedLimitKeys)) {
        throw new Error(
            `Product metadata limit keys must be exactly: ${expectedLimitKeys.join(', ')}.`,
        );
    }
    for (const field of expectedLimitKeys) {
        if (!Number.isInteger(metadata.limits[field]) || metadata.limits[field] < 1024) {
            throw new Error(`limits.${field} must be an integer of at least 1024 bytes.`);
        }
    }
    if (metadata.limits.engineResponseBytes <= metadata.limits.calculationRequestBytes) {
        throw new Error('The engine response limit must exceed the calculation request limit.');
    }
    return metadata;
}

export async function readProductMetadata(repositoryRoot) {
    const root = resolve(repositoryRoot);
    const [metadata, schema] = await Promise.all([
        readFile(join(root, metadataPath), 'utf8').then(JSON.parse),
        readFile(join(root, metadataSchemaPath), 'utf8').then(JSON.parse),
    ]);
    validateProductMetadata(metadata);
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    if (!validator(metadata)) {
        throw new Error(
            `Product metadata violates its JSON Schema: ${JSON.stringify(validator.errors)}.`,
        );
    }
    return metadata;
}

export function releaseIdentity(metadata) {
    validateProductMetadata(metadata);
    return Object.freeze({
        application: metadata.applicationVersion,
        engine: metadata.applicationVersion,
        model: metadata.modelVersion,
        protocol: metadata.protocolVersion,
        profileInterchange: metadata.profileInterchangeVersion,
        dragDataInterchange: metadata.dragDataInterchangeVersion,
    });
}

export function renderProductIdentityTypeScript(metadata) {
    validateProductMetadata(metadata);
    return `/* This file is generated by scripts/product/product-metadata.mjs. Do not edit. */
export const APPLICATION_VERSION = '${metadata.applicationVersion}' as const;
export const ENGINE_VERSION = APPLICATION_VERSION;
export const MODEL_VERSION = '${metadata.modelVersion}' as const;
export const PROTOCOL_VERSION = ${metadata.protocolVersion} as const;
export const PROFILE_INTERCHANGE_VERSION = ${metadata.profileInterchangeVersion} as const;
export const DRAG_DATA_INTERCHANGE_VERSION = ${metadata.dragDataInterchangeVersion} as const;
export const SETTINGS_SCHEMA_VERSION = ${metadata.settingsSchemaVersion} as const;

export const PRODUCT_LIMITS = Object.freeze({
  calculationRequestBytes: ${metadata.limits.calculationRequestBytes},
  engineResponseBytes: ${metadata.limits.engineResponseBytes},
  profileDocumentBytes: ${metadata.limits.profileDocumentBytes},
  dragDataDocumentBytes: ${metadata.limits.dragDataDocumentBytes},
  csvExportBytes: ${metadata.limits.csvExportBytes},
});

export const PRODUCT_IDENTITY = Object.freeze({
  application: APPLICATION_VERSION,
  engine: ENGINE_VERSION,
  model: MODEL_VERSION,
  protocol: PROTOCOL_VERSION,
  profileInterchange: PROFILE_INTERCHANGE_VERSION,
  dragDataInterchange: DRAG_DATA_INTERCHANGE_VERSION,
});
`;
}

function updateProtocolSchema(schema, metadata) {
    schema.$id = `https://ballisticsworkbench.local/protocol/v${metadata.protocolVersion}/schema.json`;
    schema.title = `Ballistics Workbench engine protocol v${metadata.protocolVersion}`;
    let declarations = 0;
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (
            value.properties?.protocolVersion &&
            Object.hasOwn(value.properties.protocolVersion, 'const')
        ) {
            value.properties.protocolVersion.const = metadata.protocolVersion;
            declarations += 1;
        }
        for (const child of Object.values(value)) visit(child);
    };
    visit(schema);
    if (declarations < 1) throw new Error('Protocol schema has no protocolVersion declarations.');
    return schema;
}

function updateProfileSchema(schema, metadata) {
    if (
        !schema.properties?.schemaVersion ||
        !Object.hasOwn(schema.properties.schemaVersion, 'const')
    ) {
        throw new Error('Profile schema has no schemaVersion declaration.');
    }
    schema.properties.schemaVersion.const = metadata.profileInterchangeVersion;
    return schema;
}

function updateDragDataSchema(schema, metadata) {
    if (
        !schema.properties?.schemaVersion ||
        !Object.hasOwn(schema.properties.schemaVersion, 'const')
    ) {
        throw new Error('Drag-data schema has no schemaVersion declaration.');
    }
    schema.properties.schemaVersion.const = metadata.dragDataInterchangeVersion;
    return schema;
}

function updateModelArtifact(document, metadata, path) {
    if (path.includes('/fitting/')) {
        if (!document.method || typeof document.method.version !== 'string') {
            throw new Error(`${path} has no fitting method version.`);
        }
        document.method.version = metadata.modelVersion;
    } else {
        if (typeof document.modelVersion !== 'string') {
            throw new Error(`${path} has no modelVersion declaration.`);
        }
        document.modelVersion = metadata.modelVersion;
    }
    return document;
}

async function desiredConsumers(repositoryRoot, metadata) {
    const root = resolve(repositoryRoot);
    const jsonConsumers = new Map();
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    packageJson.version = metadata.applicationVersion;
    jsonConsumers.set('package.json', packageJson);

    const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    packageLock.version = metadata.applicationVersion;
    if (!packageLock.packages?.[''])
        throw new Error('package-lock.json has no root package record.');
    packageLock.packages[''].version = metadata.applicationVersion;
    jsonConsumers.set('package-lock.json', packageLock);

    const protocolSchema = JSON.parse(
        await readFile(join(root, 'protocol/ballistics-protocol.schema.json'), 'utf8'),
    );
    jsonConsumers.set(
        'protocol/ballistics-protocol.schema.json',
        updateProtocolSchema(protocolSchema, metadata),
    );
    const profileSchema = JSON.parse(
        await readFile(join(root, 'protocol/ballistics-profile-interchange.schema.json'), 'utf8'),
    );
    jsonConsumers.set(
        'protocol/ballistics-profile-interchange.schema.json',
        updateProfileSchema(profileSchema, metadata),
    );
    const dragDataSchema = JSON.parse(
        await readFile(join(root, 'protocol/ballistics-drag-data.schema.json'), 'utf8'),
    );
    jsonConsumers.set(
        'protocol/ballistics-drag-data.schema.json',
        updateDragDataSchema(dragDataSchema, metadata),
    );

    for (const path of validProtocolFixturePaths) {
        const fixture = JSON.parse(await readFile(join(root, path), 'utf8'));
        fixture.protocolVersion = metadata.protocolVersion;
        jsonConsumers.set(path, fixture);
    }
    const unsupportedFixture = JSON.parse(
        await readFile(join(root, unsupportedProtocolFixturePath), 'utf8'),
    );
    unsupportedFixture.protocolVersion = metadata.protocolVersion + 1;
    jsonConsumers.set(unsupportedProtocolFixturePath, unsupportedFixture);

    for (const path of modelArtifactPaths) {
        const document = JSON.parse(await readFile(join(root, path), 'utf8'));
        jsonConsumers.set(
            path,
            updateModelArtifact(document, metadata, path.replaceAll('\\', '/')),
        );
    }

    const consumers = new Map();
    for (const [path, value] of jsonConsumers) {
        consumers.set(path, await formattedJson(value, join(root, path)));
    }
    consumers.set(generatedTypeScriptPath, renderProductIdentityTypeScript(metadata));
    return consumers;
}

export async function synchronizeProductMetadata(repositoryRoot, { write = false } = {}) {
    const root = resolve(repositoryRoot);
    const metadata = await readProductMetadata(root);
    const consumers = await desiredConsumers(root, metadata);
    const changed = [];
    for (const [path, expected] of consumers) {
        let current = null;
        try {
            current = await readFile(join(root, path), 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        if (current === expected) continue;
        changed.push(path);
        if (write) await writeFile(join(root, path), expected, 'utf8');
    }
    return { metadata, changed };
}

async function main() {
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    const check = process.argv.includes('--check');
    const write = process.argv.includes('--write');
    const unknown = process.argv
        .slice(2)
        .filter((argument) => !['--check', '--write'].includes(argument));
    if (unknown.length || check === write) {
        throw new Error('Usage: product-metadata.mjs (--check | --write)');
    }
    const result = await synchronizeProductMetadata(repositoryRoot, { write });
    if (check && result.changed.length) {
        throw new Error(
            `Generated product metadata consumers are stale: ${result.changed.join(', ')}. Run npm run identity:generate.`,
        );
    }
    process.stdout.write(
        `${write ? 'Synchronized' : 'Verified'} product metadata ${result.metadata.applicationVersion} / ${result.metadata.modelVersion}` +
            `${result.changed.length ? ` (${result.changed.length} file(s) updated)` : ''}.\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
