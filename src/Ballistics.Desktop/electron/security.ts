import {
    DRAG_DATA_INTERCHANGE_VERSION,
    PRODUCT_LIMITS,
    PROFILE_INTERCHANGE_VERSION,
    PROTOCOL_VERSION,
    SETTINGS_SCHEMA_VERSION,
} from '../shared/productIdentity.js';

const CALCULATION_REQUEST_LIMIT_BYTES = PRODUCT_LIMITS.calculationRequestBytes;
const CSV_EXPORT_LIMIT_BYTES = PRODUCT_LIMITS.csvExportBytes;
const PROFILE_DOCUMENT_LIMIT_BYTES = PRODUCT_LIMITS.profileDocumentBytes;
const DRAG_DATA_DOCUMENT_LIMIT_BYTES = PRODUCT_LIMITS.dragDataDocumentBytes;
const CSV_FILENAME = /^[^<>:"/\\|?*\u0000-\u001f]{1,116}\.csv$/i;
const PROFILE_FILENAME = /^[^<>:"/\\|?*\u0000-\u001f]{1,100}(?:\.bwprofile)?\.json$/i;
const DRAG_DATA_FILENAME = /^[^<>:"/\\|?*\u0000-\u001f]{1,100}(?:\.bwdrag)?\.json$/i;

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export class EngineResponseCollector {
    readonly #chunks: Buffer[] = [];
    #byteLength = 0;

    get byteLength() {
        return this.#byteLength;
    }

    append(chunk: Buffer) {
        if (chunk.length > PRODUCT_LIMITS.engineResponseBytes - this.#byteLength) {
            throw new Error('Ballistics engine response exceeded 16 MiB.');
        }
        this.#chunks.push(chunk);
        this.#byteLength += chunk.length;
    }

    parseJson(): unknown {
        try {
            return JSON.parse(Buffer.concat(this.#chunks, this.#byteLength).toString('utf8'));
        } catch {
            throw new Error('The native ballistics engine returned an invalid response.');
        }
    }
}

export function calculationRequestId(request: unknown): string {
    if (
        !object(request) ||
        request.protocolVersion !== PROTOCOL_VERSION ||
        typeof request.requestId !== 'string' ||
        request.requestId.length < 1 ||
        request.requestId.length > 128
    ) {
        throw new Error('The calculation request envelope is invalid.');
    }

    if (request.operation === undefined) {
        if (!object(request.scenario) || !Array.isArray(request.customLoads)) {
            throw new Error('The calculation request payload is invalid.');
        }
    } else if (request.operation === 'calibrateReferenceBc') {
        if (
            !object(request.atmosphere) ||
            !object(request.projectile) ||
            !object(request.fit) ||
            !Array.isArray(request.observations)
        ) {
            throw new Error('The calibration request payload is invalid.');
        }
    } else {
        throw new Error('The calculation operation is unsupported.');
    }

    return request.requestId;
}

export function serializeCalculationRequest(request: unknown): string {
    calculationRequestId(request);
    let requestText: string;
    try {
        requestText = JSON.stringify(request);
    } catch {
        throw new Error('The calculation request could not be serialized.');
    }
    if (Buffer.byteLength(requestText, 'utf8') > CALCULATION_REQUEST_LIMIT_BYTES) {
        throw new Error('Calculation request exceeds the 1 MiB protocol limit.');
    }
    return requestText;
}

export function validateCsvExport(
    content: unknown,
    defaultName: unknown,
): {
    content: string;
    defaultName: string;
} {
    if (typeof content !== 'string') throw new Error('CSV export content is invalid.');
    if (Buffer.byteLength(content, 'utf8') > CSV_EXPORT_LIMIT_BYTES) {
        throw new Error('CSV export exceeds the 64 MiB limit.');
    }
    if (typeof defaultName !== 'string' || !CSV_FILENAME.test(defaultName)) {
        throw new Error('CSV export filename is invalid.');
    }
    return { content, defaultName };
}

function validateProfileEnvelope(content: string) {
    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch {
        throw new Error('Profile document is not valid JSON.');
    }
    if (!object(value)) throw new Error('Profile document envelope is invalid.');
    if (value.format === 'ballistics-workbench-profile-quarantine') {
        if (
            value.schemaVersion !== 1 ||
            typeof value.exportedAt !== 'string' ||
            typeof value.sourceName !== 'string' ||
            typeof value.reason !== 'string' ||
            typeof value.importedAt !== 'string' ||
            typeof value.rawJson !== 'string'
        ) {
            throw new Error('Profile quarantine envelope is invalid.');
        }
        return;
    }
    if (value.format === 'ballistics-workbench-profile-set') {
        if (
            typeof value.schemaVersion !== 'number' ||
            value.schemaVersion < 1 ||
            value.schemaVersion > PROFILE_INTERCHANGE_VERSION ||
            value.unitConvention !== 'SI' ||
            typeof value.exportedAt !== 'string' ||
            !Array.isArray(value.profiles) ||
            value.profiles.length < 1 ||
            value.profiles.length > 64
        ) {
            throw new Error('Profile document envelope is invalid.');
        }
        return;
    }
    if (
        typeof value.schemaVersion !== 'number' ||
        value.schemaVersion < 2 ||
        value.schemaVersion >= SETTINGS_SCHEMA_VERSION ||
        !object(value.inputs) ||
        (value.customLoads !== undefined && !Array.isArray(value.customLoads)) ||
        (Array.isArray(value.customLoads) && value.customLoads.length > 3)
    ) {
        throw new Error('Profile document format or schema version is unsupported.');
    }
}

export function validateProfileDocument(
    content: unknown,
    defaultName: unknown,
): { content: string; defaultName: string } {
    if (typeof content !== 'string') throw new Error('Profile document content is invalid.');
    if (Buffer.byteLength(content, 'utf8') > PROFILE_DOCUMENT_LIMIT_BYTES) {
        throw new Error('Profile document exceeds the 1 MiB limit.');
    }
    if (typeof defaultName !== 'string' || !PROFILE_FILENAME.test(defaultName)) {
        throw new Error('Profile document filename is invalid.');
    }
    validateProfileEnvelope(content);
    return { content, defaultName };
}

export function validateDragDataDocument(
    content: unknown,
    defaultName: unknown,
): { content: string; defaultName: string } {
    if (typeof content !== 'string') throw new Error('Drag-data document content is invalid.');
    if (Buffer.byteLength(content, 'utf8') > DRAG_DATA_DOCUMENT_LIMIT_BYTES) {
        throw new Error('Drag-data document exceeds the 1 MiB limit.');
    }
    if (typeof defaultName !== 'string' || !DRAG_DATA_FILENAME.test(defaultName)) {
        throw new Error('Drag-data document filename is invalid.');
    }

    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch {
        throw new Error('Drag-data document is not valid JSON.');
    }
    if (
        !object(value) ||
        value.format !== 'ballistics-workbench-drag-data' ||
        value.schemaVersion !== DRAG_DATA_INTERCHANGE_VERSION ||
        typeof value.exportedAt !== 'string' ||
        typeof value.name !== 'string' ||
        !object(value.units) ||
        !object(value.source) ||
        !object(value.declaredDomain) ||
        !object(value.drag) ||
        typeof value.payloadChecksumSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(value.payloadChecksumSha256)
    ) {
        throw new Error('Drag-data document envelope is invalid.');
    }
    return { content, defaultName };
}
