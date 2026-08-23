import { DRAG_DATA_INTERCHANGE_VERSION, PRODUCT_LIMITS } from '../../../shared/productIdentity';
import type { CustomDraft, DragDataMetadata, MachCdPoint } from '../types';

export const DRAG_DATA_FORMAT = 'ballistics-workbench-drag-data';

export const DRAG_DATA_UNITS = Object.freeze({
    velocity: 'm/s',
    referenceDiameter: 'm',
    mach: 'dimensionless',
    dragCoefficient: 'dimensionless',
    ballisticCoefficient: 'lb/in^2',
} as const);

type ReferenceBcDragData =
    | {
          kind: 'referenceBc';
          curve: 'G1' | 'G7';
          representation: 'constant';
          ballisticCoefficient: number;
      }
    | {
          kind: 'referenceBc';
          curve: 'G1' | 'G7';
          representation: 'velocityBands';
          velocityBands: Array<{
              minimumVelocityMps: number;
              ballisticCoefficient: number;
          }>;
      };

type MachCdDragData = {
    kind: 'machCd';
    referenceDiameterM: number;
    points: MachCdPoint[];
};

export type DragDataDocument = {
    format: typeof DRAG_DATA_FORMAT;
    schemaVersion: typeof DRAG_DATA_INTERCHANGE_VERSION;
    exportedAt: string;
    name: string;
    units: typeof DRAG_DATA_UNITS;
    source: {
        citation: string;
        url: string | null;
        license: string;
        checksumSha256: string | null;
    };
    declaredDomain: {
        variable: 'velocity' | 'mach';
        minimum: number | null;
        maximum: number | null;
        unit: 'm/s' | 'Mach';
    };
    drag: ReferenceBcDragData | MachCdDragData;
    payloadChecksumSha256: string;
};

export class DragDataDocumentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DragDataDocumentError';
    }
}

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string) {
    const allowed = new Set(expected);
    const missing = expected.filter((key) => !(key in value));
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    if (missing.length || unexpected.length) {
        throw new DragDataDocumentError(
            `${path} has an invalid shape` +
                `${missing.length ? `. Missing ${missing.join(', ')}` : ''}` +
                `${unexpected.length ? `. Unknown ${unexpected.join(', ')}` : ''}.`,
        );
    }
}

function stringValue(value: unknown, path: string, maximum: number) {
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
        throw new DragDataDocumentError(
            `${path} must contain between 1 and ${maximum} characters.`,
        );
    }
    return value;
}

function finiteInRange(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
    exclusiveMinimum = false,
) {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (exclusiveMinimum ? value <= minimum : value < minimum) ||
        value > maximum
    ) {
        throw new DragDataDocumentError(`${path} is outside its supported range.`);
    }
    return value;
}

function nullableDomainValue(value: unknown, path: string, maximum: number) {
    return value === null ? null : finiteInRange(value, path, 0, maximum);
}

function sha256Value(value: unknown, path: string, nullable: true): string | null;
function sha256Value(value: unknown, path: string, nullable: false): string;
function sha256Value(value: unknown, path: string, nullable: boolean) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
        throw new DragDataDocumentError(`${path} must be a lowercase SHA-256 value.`);
    }
    return value;
}

export function defaultDragDataMetadata(): DragDataMetadata {
    return {
        citation: 'User-entered data',
        sourceUrl: '',
        license: 'Unspecified',
        sourceChecksumSha256: '',
        domainMinimum: null,
        domainMaximum: null,
    };
}

function dragFromDraft(draft: CustomDraft): ReferenceBcDragData | MachCdDragData {
    if (draft.drag === 'MachCd') {
        return {
            kind: 'machCd',
            referenceDiameterM: draft.machCdDiameterMm / 1000,
            points: draft.machCdPoints.map((point) => ({ ...point })),
        };
    }
    if (draft.drag !== 'G1' && draft.drag !== 'G7') {
        throw new DragDataDocumentError('Sphere drag cannot be exported as tabulated drag data.');
    }
    if (draft.bcMode === 'velocityBands') {
        return {
            kind: 'referenceBc',
            curve: draft.drag,
            representation: 'velocityBands',
            velocityBands: draft.bcBands.map((band) => ({ ...band })),
        };
    }
    return {
        kind: 'referenceBc',
        curve: draft.drag,
        representation: 'constant',
        ballisticCoefficient: draft.bc,
    };
}

function domainFromDraft(draft: CustomDraft): DragDataDocument['declaredDomain'] {
    const variable = draft.drag === 'MachCd' ? 'mach' : 'velocity';
    return {
        variable,
        minimum: draft.dragDataMetadata.domainMinimum,
        maximum: draft.dragDataMetadata.domainMaximum,
        unit: variable === 'mach' ? 'Mach' : 'm/s',
    };
}

function canonicalPayload(document: Pick<DragDataDocument, 'units' | 'declaredDomain' | 'drag'>) {
    return JSON.stringify({
        units: document.units,
        declaredDomain: document.declaredDomain,
        drag: document.drag,
    });
}

async function sha256(text: string) {
    if (!globalThis.crypto?.subtle) {
        throw new DragDataDocumentError('SHA-256 support is unavailable in this environment.');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
    );
}

function validateDomain(
    value: unknown,
    drag: ReferenceBcDragData | MachCdDragData,
): DragDataDocument['declaredDomain'] {
    if (!object(value)) throw new DragDataDocumentError('declaredDomain must be an object.');
    exactKeys(value, ['variable', 'minimum', 'maximum', 'unit'], 'declaredDomain');
    const expectedVariable = drag.kind === 'machCd' ? 'mach' : 'velocity';
    const expectedUnit = drag.kind === 'machCd' ? 'Mach' : 'm/s';
    if (value.variable !== expectedVariable || value.unit !== expectedUnit) {
        throw new DragDataDocumentError('declaredDomain does not match the drag model.');
    }
    const maximumSupported = drag.kind === 'machCd' ? 10 : 2000;
    const minimum = nullableDomainValue(value.minimum, 'declaredDomain.minimum', maximumSupported);
    const maximum = nullableDomainValue(value.maximum, 'declaredDomain.maximum', maximumSupported);
    if (minimum !== null && maximum !== null && minimum >= maximum) {
        throw new DragDataDocumentError('declaredDomain minimum must be below its maximum.');
    }
    if (drag.kind === 'machCd') {
        const tableMinimum = drag.points[0].mach;
        const tableMaximum = drag.points.at(-1)!.mach;
        if (
            (minimum !== null && minimum < tableMinimum) ||
            (maximum !== null && maximum > tableMaximum)
        ) {
            throw new DragDataDocumentError(
                'The declared Mach domain must remain inside the tabulated Mach range.',
            );
        }
    }
    return { variable: expectedVariable, minimum, maximum, unit: expectedUnit };
}

function validateReferenceBc(value: Record<string, unknown>): ReferenceBcDragData {
    if (value.curve !== 'G1' && value.curve !== 'G7') {
        throw new DragDataDocumentError('drag.curve must be G1 or G7.');
    }
    if (value.representation === 'constant') {
        exactKeys(value, ['kind', 'curve', 'representation', 'ballisticCoefficient'], 'drag');
        return {
            kind: 'referenceBc',
            curve: value.curve,
            representation: 'constant',
            ballisticCoefficient: finiteInRange(
                value.ballisticCoefficient,
                'drag.ballisticCoefficient',
                0,
                2,
                true,
            ),
        };
    }
    if (value.representation !== 'velocityBands') {
        throw new DragDataDocumentError('drag.representation is unsupported.');
    }
    exactKeys(value, ['kind', 'curve', 'representation', 'velocityBands'], 'drag');
    if (
        !Array.isArray(value.velocityBands) ||
        value.velocityBands.length < 2 ||
        value.velocityBands.length > 16
    ) {
        throw new DragDataDocumentError('drag.velocityBands must contain 2–16 entries.');
    }
    const velocityBands = value.velocityBands.map((entry, index) => {
        if (!object(entry)) {
            throw new DragDataDocumentError(`drag.velocityBands[${index}] must be an object.`);
        }
        exactKeys(
            entry,
            ['minimumVelocityMps', 'ballisticCoefficient'],
            `drag.velocityBands[${index}]`,
        );
        return {
            minimumVelocityMps: finiteInRange(
                entry.minimumVelocityMps,
                `drag.velocityBands[${index}].minimumVelocityMps`,
                0,
                2000,
            ),
            ballisticCoefficient: finiteInRange(
                entry.ballisticCoefficient,
                `drag.velocityBands[${index}].ballisticCoefficient`,
                0,
                2,
                true,
            ),
        };
    });
    if (
        velocityBands[0].minimumVelocityMps !== 0 ||
        velocityBands.some(
            (band, index) =>
                index > 0 && band.minimumVelocityMps <= velocityBands[index - 1].minimumVelocityMps,
        )
    ) {
        throw new DragDataDocumentError(
            'BC bands must start at zero and use strictly increasing velocity thresholds.',
        );
    }
    return {
        kind: 'referenceBc',
        curve: value.curve,
        representation: 'velocityBands',
        velocityBands,
    };
}

function validateMachCd(value: Record<string, unknown>): MachCdDragData {
    exactKeys(value, ['kind', 'referenceDiameterM', 'points'], 'drag');
    if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > 64) {
        throw new DragDataDocumentError('drag.points must contain 2–64 entries.');
    }
    const points = value.points.map((entry, index) => {
        if (!object(entry)) {
            throw new DragDataDocumentError(`drag.points[${index}] must be an object.`);
        }
        exactKeys(entry, ['mach', 'dragCoefficient'], `drag.points[${index}]`);
        return {
            mach: finiteInRange(entry.mach, `drag.points[${index}].mach`, 0, 10),
            dragCoefficient: finiteInRange(
                entry.dragCoefficient,
                `drag.points[${index}].dragCoefficient`,
                0,
                5,
                true,
            ),
        };
    });
    if (points.some((point, index) => index > 0 && point.mach <= points[index - 1].mach)) {
        throw new DragDataDocumentError('Mach–Cd points must be strictly increasing by Mach.');
    }
    return {
        kind: 'machCd',
        referenceDiameterM: finiteInRange(
            value.referenceDiameterM,
            'drag.referenceDiameterM',
            0,
            0.05,
            true,
        ),
        points,
    };
}

function validateDrag(value: unknown): ReferenceBcDragData | MachCdDragData {
    if (!object(value)) throw new DragDataDocumentError('drag must be an object.');
    if (value.kind === 'referenceBc') return validateReferenceBc(value);
    if (value.kind === 'machCd') return validateMachCd(value);
    throw new DragDataDocumentError('drag.kind is unsupported.');
}

function validateUnits(value: unknown): typeof DRAG_DATA_UNITS {
    if (!object(value)) throw new DragDataDocumentError('units must be an object.');
    exactKeys(value, Object.keys(DRAG_DATA_UNITS), 'units');
    for (const [name, expected] of Object.entries(DRAG_DATA_UNITS)) {
        if (value[name] !== expected) {
            throw new DragDataDocumentError(`units.${name} must be ${expected}.`);
        }
    }
    return DRAG_DATA_UNITS;
}

function validateSource(value: unknown): DragDataDocument['source'] {
    if (!object(value)) throw new DragDataDocumentError('source must be an object.');
    exactKeys(value, ['citation', 'url', 'license', 'checksumSha256'], 'source');
    const url = value.url === null ? null : stringValue(value.url, 'source.url', 2000);
    if (url !== null && !/^https?:\/\//.test(url)) {
        throw new DragDataDocumentError('source.url must use HTTP or HTTPS.');
    }
    return {
        citation: stringValue(value.citation, 'source.citation', 500),
        url,
        license: stringValue(value.license, 'source.license', 200),
        checksumSha256: sha256Value(value.checksumSha256, 'source.checksumSha256', true),
    };
}

export async function serializeDragDataDocument(
    draft: CustomDraft,
    exportedAt = new Date().toISOString(),
) {
    const drag = dragFromDraft(draft);
    const documentWithoutChecksum: Omit<DragDataDocument, 'payloadChecksumSha256'> = {
        format: DRAG_DATA_FORMAT,
        schemaVersion: DRAG_DATA_INTERCHANGE_VERSION,
        exportedAt,
        name: draft.name.trim() || 'Custom drag data',
        units: DRAG_DATA_UNITS,
        source: {
            citation: draft.dragDataMetadata.citation.trim() || 'User-entered data',
            url: draft.dragDataMetadata.sourceUrl.trim() || null,
            license: draft.dragDataMetadata.license.trim() || 'Unspecified',
            checksumSha256:
                draft.dragDataMetadata.sourceChecksumSha256.trim().toLowerCase() || null,
        },
        declaredDomain: domainFromDraft(draft),
        drag,
    };
    const payloadChecksumSha256 = await sha256(canonicalPayload(documentWithoutChecksum));
    const document: DragDataDocument = { ...documentWithoutChecksum, payloadChecksumSha256 };
    const validated = await decodeDragDataDocument(`${JSON.stringify(document)}\n`);
    return `${JSON.stringify(validated, null, 2)}\n`;
}

export async function decodeDragDataDocument(text: string): Promise<DragDataDocument> {
    if (new TextEncoder().encode(text).byteLength > PRODUCT_LIMITS.dragDataDocumentBytes) {
        throw new DragDataDocumentError('Drag-data document exceeds the 1 MiB limit.');
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new DragDataDocumentError('Drag-data document is not valid JSON.');
    }
    if (!object(value)) throw new DragDataDocumentError('Document must be an object.');
    exactKeys(
        value,
        [
            'format',
            'schemaVersion',
            'exportedAt',
            'name',
            'units',
            'source',
            'declaredDomain',
            'drag',
            'payloadChecksumSha256',
        ],
        'document',
    );
    if (value.format !== DRAG_DATA_FORMAT) {
        throw new DragDataDocumentError('Drag-data document format is unsupported.');
    }
    if (value.schemaVersion !== DRAG_DATA_INTERCHANGE_VERSION) {
        throw new DragDataDocumentError(
            `Drag-data schema version ${String(value.schemaVersion)} is unsupported.`,
        );
    }
    const exportedAt = stringValue(value.exportedAt, 'exportedAt', 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(exportedAt)) {
        throw new DragDataDocumentError('exportedAt must be an ISO-8601 UTC timestamp.');
    }
    const drag = validateDrag(value.drag);
    const document: DragDataDocument = {
        format: DRAG_DATA_FORMAT,
        schemaVersion: DRAG_DATA_INTERCHANGE_VERSION,
        exportedAt,
        name: stringValue(value.name, 'name', 120).trim(),
        units: validateUnits(value.units),
        source: validateSource(value.source),
        declaredDomain: validateDomain(value.declaredDomain, drag),
        drag,
        payloadChecksumSha256: sha256Value(
            value.payloadChecksumSha256,
            'payloadChecksumSha256',
            false,
        ),
    };
    const actualChecksum = await sha256(canonicalPayload(document));
    if (actualChecksum !== document.payloadChecksumSha256) {
        throw new DragDataDocumentError('Drag-data payload checksum does not match its content.');
    }
    return document;
}

export function applyDragDataDocument(draft: CustomDraft, document: DragDataDocument): CustomDraft {
    const metadata: DragDataMetadata = {
        citation: document.source.citation,
        sourceUrl: document.source.url ?? '',
        license: document.source.license,
        sourceChecksumSha256: document.source.checksumSha256 ?? '',
        domainMinimum: document.declaredDomain.minimum,
        domainMaximum: document.declaredDomain.maximum,
    };
    if (document.drag.kind === 'machCd') {
        return {
            ...draft,
            drag: 'MachCd',
            machCdDiameterMm: document.drag.referenceDiameterM * 1000,
            machCdPoints: document.drag.points.map((point) => ({ ...point })),
            dragDataMetadata: metadata,
        };
    }
    if (document.drag.representation === 'constant') {
        return {
            ...draft,
            drag: document.drag.curve,
            bcMode: 'constant',
            bc: document.drag.ballisticCoefficient,
            dragDataMetadata: metadata,
        };
    }
    return {
        ...draft,
        drag: document.drag.curve,
        bcMode: 'velocityBands',
        bcBands: document.drag.velocityBands.map((band) => ({ ...band })),
        bc: document.drag.velocityBands.at(-1)!.ballisticCoefficient,
        dragDataMetadata: metadata,
    };
}

export function dragDataFileName(name: string) {
    const stem = name
        .trim()
        .replace(/[^a-z0-9._-]+/gi, '_')
        .replace(/^[_\.]+|[_\.]+$/g, '')
        .slice(0, 80);
    return `${stem || 'custom_drag_data'}.bwdrag.json`;
}
