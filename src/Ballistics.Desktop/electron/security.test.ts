import { describe, expect, it } from 'vitest';
import {
    DRAG_DATA_INTERCHANGE_VERSION,
    ENGINE_VERSION,
    MODEL_VERSION,
    PRODUCT_LIMITS,
    PROFILE_INTERCHANGE_VERSION,
    PROTOCOL_VERSION,
    SETTINGS_SCHEMA_VERSION,
} from '../shared/productIdentity';
import {
    calculationRequestId,
    EngineResponseCollector,
    serializeCalculationRequest,
    validateCsvExport,
    validateDragDataDocument,
    validateProfileDocument,
} from './security';

const calculation = () => ({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'calculation-1',
    scenario: {},
    customLoads: [],
});

describe('Electron IPC payload guards', () => {
    it('accepts calculation and calibration envelopes', () => {
        expect(calculationRequestId(calculation())).toBe('calculation-1');
        expect(
            calculationRequestId({
                protocolVersion: PROTOCOL_VERSION,
                requestId: 'calibration-1',
                operation: 'calibrateReferenceBc',
                atmosphere: {},
                projectile: {},
                fit: {},
                observations: [],
            }),
        ).toBe('calibration-1');
    });

    it('rejects invalid versions, operations, request IDs, and payload shapes', () => {
        expect(() =>
            calculationRequestId({ ...calculation(), protocolVersion: PROTOCOL_VERSION + 1 }),
        ).toThrow('envelope is invalid');
        expect(() => calculationRequestId({ ...calculation(), requestId: '' })).toThrow(
            'envelope is invalid',
        );
        expect(() => calculationRequestId({ ...calculation(), operation: 'shell' })).toThrow(
            'unsupported',
        );
        expect(() => calculationRequestId({ ...calculation(), customLoads: {} })).toThrow(
            'payload is invalid',
        );
    });

    it('rejects cyclic and oversized calculation input', () => {
        const cyclic = calculation() as Record<string, unknown>;
        cyclic.self = cyclic;
        expect(() => serializeCalculationRequest(cyclic)).toThrow('could not be serialized');
        expect(() =>
            serializeCalculationRequest({
                ...calculation(),
                padding: 'x'.repeat(PRODUCT_LIMITS.calculationRequestBytes),
            }),
        ).toThrow('exceeds the 1 MiB');
    });

    it('accepts the exact calculation limit and rejects the next UTF-8 byte', () => {
        const base = { ...calculation(), padding: '' };
        const baseBytes = Buffer.byteLength(JSON.stringify(base), 'utf8');
        const atLimit = {
            ...base,
            padding: 'x'.repeat(PRODUCT_LIMITS.calculationRequestBytes - baseBytes),
        };
        const serialized = serializeCalculationRequest(atLimit);
        expect(Buffer.byteLength(serialized, 'utf8')).toBe(PRODUCT_LIMITS.calculationRequestBytes);
        expect(() =>
            serializeCalculationRequest({ ...atLimit, padding: `${atLimit.padding}x` }),
        ).toThrow('exceeds the 1 MiB');
    });

    it('accepts the exact engine-response limit and rejects the next byte', () => {
        const response = new EngineResponseCollector();
        const half = PRODUCT_LIMITS.engineResponseBytes / 2;
        response.append(Buffer.alloc(half, 0x20));
        response.append(Buffer.alloc(half, 0x20));
        expect(response.byteLength).toBe(PRODUCT_LIMITS.engineResponseBytes);
        expect(() => response.append(Buffer.from('x'))).toThrow('exceeded 16 MiB');

        const valid = new EngineResponseCollector();
        valid.append(Buffer.from('{"ok":true}', 'utf8'));
        expect(valid.parseJson()).toEqual({ ok: true });
        const invalid = new EngineResponseCollector();
        invalid.append(Buffer.from('{', 'utf8'));
        expect(() => invalid.parseJson()).toThrow('invalid response');
    });

    it('bounds CSV content and accepts only a plain CSV filename', () => {
        expect(validateCsvExport('a,b\r\n1,2', 'range table.csv')).toEqual({
            content: 'a,b\r\n1,2',
            defaultName: 'range table.csv',
        });
        expect(() => validateCsvExport('data', '../range.csv')).toThrow('filename is invalid');
        expect(() => validateCsvExport('data', 'range.txt')).toThrow('filename is invalid');
        expect(() =>
            validateCsvExport('x'.repeat(PRODUCT_LIMITS.csvExportBytes + 1), 'range.csv'),
        ).toThrow('exceeds the 64 MiB');
        const exactUtf8Content =
            'x'.repeat(PRODUCT_LIMITS.csvExportBytes - Buffer.byteLength('Ç', 'utf8')) + 'Ç';
        expect(validateCsvExport(exactUtf8Content, 'range.csv').content).toBe(exactUtf8Content);
    });

    it('bounds and validates current profile interchange envelopes', () => {
        const content = JSON.stringify({
            format: 'ballistics-workbench-profile-set',
            schemaVersion: PROFILE_INTERCHANGE_VERSION,
            exportedAt: '2026-08-18T12:00:00.000Z',
            unitConvention: 'SI',
            profiles: [{}],
        });
        expect(validateProfileDocument(content, 'profiles.bwprofile.json')).toEqual({
            content,
            defaultName: 'profiles.bwprofile.json',
        });
        const versionOne = JSON.stringify({ ...JSON.parse(content), schemaVersion: 1 });
        expect(validateProfileDocument(versionOne, 'profiles-v1.json').content).toBe(versionOne);
        expect(() => validateProfileDocument(content, '../profiles.json')).toThrow(
            'filename is invalid',
        );
        expect(() =>
            validateProfileDocument(
                JSON.stringify({
                    ...JSON.parse(content),
                    schemaVersion: PROFILE_INTERCHANGE_VERSION + 1,
                }),
                'profiles.json',
            ),
        ).toThrow('envelope is invalid');
        expect(() =>
            validateProfileDocument(
                'x'.repeat(PRODUCT_LIMITS.profileDocumentBytes + 1),
                'profiles.json',
            ),
        ).toThrow('exceeds the 1 MiB');

        const maximumUnicodeName = `${'Ç'.repeat(100)}.json`;
        expect(validateProfileDocument(content, maximumUnicodeName).defaultName).toBe(
            maximumUnicodeName,
        );
        expect(() => validateProfileDocument(content, `${'Ç'.repeat(101)}.json`)).toThrow(
            'filename is invalid',
        );
    });

    it('accepts a structurally valid profile at exactly the UTF-8 byte limit', () => {
        const envelope = {
            format: 'ballistics-workbench-profile-quarantine',
            schemaVersion: 1,
            exportedAt: '2026-08-23T00:00:00.000Z',
            sourceName: 'Boundary profile',
            reason: 'Boundary test',
            importedAt: '2026-08-23T00:00:00.000Z',
            rawJson: '',
        };
        const baseBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
        const content = JSON.stringify({
            ...envelope,
            rawJson: 'x'.repeat(PRODUCT_LIMITS.profileDocumentBytes - baseBytes),
        });
        expect(Buffer.byteLength(content, 'utf8')).toBe(PRODUCT_LIMITS.profileDocumentBytes);
        expect(validateProfileDocument(content, 'boundary.json').content).toBe(content);
    });

    it('accepts migration and quarantine envelopes but rejects unsupported data', () => {
        const legacy = JSON.stringify({
            schemaVersion: SETTINGS_SCHEMA_VERSION - 1,
            inputs: {},
            customLoads: [],
        });
        expect(validateProfileDocument(legacy, 'legacy.json').content).toBe(legacy);
        const quarantine = JSON.stringify({
            format: 'ballistics-workbench-profile-quarantine',
            schemaVersion: 1,
            exportedAt: '2026-08-18T12:00:00.000Z',
            sourceName: 'Damaged profile',
            reason: 'Unknown member.',
            importedAt: '2026-08-18T11:00:00.000Z',
            rawJson: '{"unknown":true}',
        });
        expect(validateProfileDocument(quarantine, 'damaged.quarantine.json').content).toBe(
            quarantine,
        );
        expect(() => validateProfileDocument('{', 'profiles.json')).toThrow('not valid JSON');
        expect(() =>
            validateProfileDocument(
                JSON.stringify({ schemaVersion: 1, inputs: {} }),
                'profiles.json',
            ),
        ).toThrow('unsupported');
    });

    it('bounds and validates drag-data interchange envelopes and filenames', () => {
        const envelope = {
            format: 'ballistics-workbench-drag-data',
            schemaVersion: DRAG_DATA_INTERCHANGE_VERSION,
            exportedAt: '2026-08-23T12:00:00.000Z',
            name: 'G7 schedule',
            units: {},
            source: {},
            declaredDomain: {},
            drag: {},
            payloadChecksumSha256: 'a'.repeat(64),
        };
        const content = JSON.stringify(envelope);
        expect(validateDragDataDocument(content, 'g7-schedule.bwdrag.json')).toEqual({
            content,
            defaultName: 'g7-schedule.bwdrag.json',
        });
        expect(() => validateDragDataDocument(content, '../schedule.json')).toThrow(
            'filename is invalid',
        );
        expect(() =>
            validateDragDataDocument(
                JSON.stringify({
                    ...envelope,
                    schemaVersion: DRAG_DATA_INTERCHANGE_VERSION + 1,
                }),
                'schedule.json',
            ),
        ).toThrow('envelope is invalid');
        expect(() =>
            validateDragDataDocument(
                JSON.stringify({ ...envelope, payloadChecksumSha256: 'not-a-checksum' }),
                'schedule.json',
            ),
        ).toThrow('envelope is invalid');

        const maximumUnicodeName = `${'Ç'.repeat(100)}.json`;
        expect(validateDragDataDocument(content, maximumUnicodeName).defaultName).toBe(
            maximumUnicodeName,
        );
        expect(() => validateDragDataDocument(content, `${'Ç'.repeat(101)}.json`)).toThrow(
            'filename is invalid',
        );
    });

    it('accepts drag data at exactly the UTF-8 byte limit and rejects the next byte', () => {
        const envelope = {
            format: 'ballistics-workbench-drag-data',
            schemaVersion: DRAG_DATA_INTERCHANGE_VERSION,
            exportedAt: '2026-08-23T12:00:00.000Z',
            name: 'Boundary',
            units: {},
            source: {},
            declaredDomain: {},
            drag: {},
            payloadChecksumSha256: 'a'.repeat(64),
            padding: '',
        };
        const baseBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
        const content = JSON.stringify({
            ...envelope,
            padding: 'x'.repeat(PRODUCT_LIMITS.dragDataDocumentBytes - baseBytes),
        });
        expect(Buffer.byteLength(content, 'utf8')).toBe(PRODUCT_LIMITS.dragDataDocumentBytes);
        expect(validateDragDataDocument(content, 'boundary.json').content).toBe(content);
        expect(() => validateDragDataDocument(`${content}x`, 'boundary.json')).toThrow(
            'exceeds the 1 MiB limit',
        );
    });

    it('exposes generated engine/model identity to both Electron and renderer consumers', () => {
        expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
        expect(MODEL_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    });
});
