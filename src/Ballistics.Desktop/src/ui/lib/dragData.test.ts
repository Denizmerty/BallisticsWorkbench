import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import dragDataSchema from '../../../../../protocol/ballistics-drag-data.schema.json';
import { PRODUCT_LIMITS } from '../../../shared/productIdentity';
import {
    applyDragDataDocument,
    decodeDragDataDocument,
    dragDataFileName,
    serializeDragDataDocument,
} from './dragData';
import { createDefaultCustomDraft } from './workbenchDefaults';

const NOW = '2026-08-23T12:00:00.000Z';

describe('drag-data interchange', () => {
    it('serializes a velocity-banded BC schedule that satisfies the public schema', async () => {
        const draft = {
            ...createDefaultCustomDraft(),
            name: 'Verified G7 schedule',
            drag: 'G7' as const,
            bcMode: 'velocityBands' as const,
            bcBands: [
                { minimumVelocityMps: 0, ballisticCoefficient: 0.37 },
                { minimumVelocityMps: 450, ballisticCoefficient: 0.41 },
                { minimumVelocityMps: 800, ballisticCoefficient: 0.45 },
            ],
            dragDataMetadata: {
                citation: 'Manufacturer technical sheet, revision 4',
                sourceUrl: 'https://example.test/drag-data',
                license: 'Used with permission',
                sourceChecksumSha256: 'A'.repeat(64),
                domainMinimum: 0,
                domainMaximum: 1_000,
            },
        };

        const text = await serializeDragDataDocument(draft, NOW);
        const raw = JSON.parse(text);
        const validate = new Ajv2020({ allErrors: true, strict: false }).compile(dragDataSchema);

        expect(validate(raw), JSON.stringify(validate.errors)).toBe(true);
        expect(raw.source.checksumSha256).toBe('a'.repeat(64));
        expect(raw.payloadChecksumSha256).toMatch(/^[0-9a-f]{64}$/);

        const decoded = await decodeDragDataDocument(text);
        expect(decoded.drag).toEqual({
            kind: 'referenceBc',
            curve: 'G7',
            representation: 'velocityBands',
            velocityBands: draft.bcBands,
        });
        expect(decoded.declaredDomain).toEqual({
            variable: 'velocity',
            minimum: 0,
            maximum: 1_000,
            unit: 'm/s',
        });
    });

    it('round-trips Mach-Cd data and applies it without changing projectile identity', async () => {
        const source = {
            ...createDefaultCustomDraft(),
            name: 'Reference curve',
            drag: 'MachCd' as const,
            machCdDiameterMm: 6.71,
            machCdPoints: [
                { mach: 0.3, dragCoefficient: 0.19 },
                { mach: 1.0, dragCoefficient: 0.41 },
                { mach: 2.5, dragCoefficient: 0.23 },
            ],
            dragDataMetadata: {
                citation: 'Doppler-derived curve',
                sourceUrl: '',
                license: 'CC-BY-4.0',
                sourceChecksumSha256: '',
                domainMinimum: 0.3,
                domainMaximum: 2.5,
            },
        };
        const target = {
            ...createDefaultCustomDraft(),
            id: 'custom:keep-this-id',
            name: 'Keep this load name',
            massG: 12.4,
        };

        const document = await decodeDragDataDocument(await serializeDragDataDocument(source, NOW));
        const applied = applyDragDataDocument(target, document);

        expect(applied.id).toBe(target.id);
        expect(applied.name).toBe(target.name);
        expect(applied.massG).toBe(target.massG);
        expect(applied.drag).toBe('MachCd');
        expect(applied.machCdDiameterMm).toBeCloseTo(6.71);
        expect(applied.machCdPoints).toEqual(source.machCdPoints);
        expect(applied.dragDataMetadata).toEqual(source.dragDataMetadata);
    });

    it('detects payload tampering through the canonical SHA-256 checksum', async () => {
        const raw = JSON.parse(await serializeDragDataDocument(createDefaultCustomDraft(), NOW));
        raw.drag.ballisticCoefficient = 0.9;

        await expect(decodeDragDataDocument(JSON.stringify(raw))).rejects.toThrow(
            'payload checksum does not match',
        );
    });

    it('rejects unexpected units, model-domain mismatches, and unknown properties', async () => {
        const text = await serializeDragDataDocument(createDefaultCustomDraft(), NOW);
        const wrongUnits = JSON.parse(text);
        wrongUnits.units.velocity = 'ft/s';
        await expect(decodeDragDataDocument(JSON.stringify(wrongUnits))).rejects.toThrow(
            'units.velocity',
        );

        const wrongDomain = JSON.parse(text);
        wrongDomain.declaredDomain.variable = 'mach';
        await expect(decodeDragDataDocument(JSON.stringify(wrongDomain))).rejects.toThrow(
            'does not match the drag model',
        );

        const unknownProperty = JSON.parse(text);
        unknownProperty.drag.notes = 'not part of the contract';
        await expect(decodeDragDataDocument(JSON.stringify(unknownProperty))).rejects.toThrow(
            'Unknown notes',
        );
    });

    it('rejects invalid BC schedules and Mach domains before trusting the checksum', async () => {
        const banded = {
            ...createDefaultCustomDraft(),
            bcMode: 'velocityBands' as const,
        };
        const invalidBands = JSON.parse(await serializeDragDataDocument(banded, NOW));
        invalidBands.drag.velocityBands[1].minimumVelocityMps = 0;
        await expect(decodeDragDataDocument(JSON.stringify(invalidBands))).rejects.toThrow(
            'strictly increasing',
        );

        const mach = {
            ...createDefaultCustomDraft(),
            drag: 'MachCd' as const,
            dragDataMetadata: {
                ...createDefaultCustomDraft().dragDataMetadata,
                domainMinimum: 0,
                domainMaximum: 3,
            },
        };
        const invalidDomain = JSON.parse(await serializeDragDataDocument(mach, NOW));
        invalidDomain.declaredDomain.maximum = 4;
        await expect(decodeDragDataDocument(JSON.stringify(invalidDomain))).rejects.toThrow(
            'inside the tabulated Mach range',
        );
    });

    it('enforces the byte boundary and rejects sphere export', async () => {
        await expect(
            decodeDragDataDocument(' '.repeat(PRODUCT_LIMITS.dragDataDocumentBytes + 1)),
        ).rejects.toThrow('exceeds the 1 MiB limit');
        await expect(
            serializeDragDataDocument({ ...createDefaultCustomDraft(), drag: 'Sphere' }, NOW),
        ).rejects.toThrow('Sphere drag cannot be exported');
    });

    it('creates portable, bounded filenames', () => {
        expect(dragDataFileName('  168 gr / G7: match load  ')).toBe(
            '168_gr_G7_match_load.bwdrag.json',
        );
        expect(dragDataFileName('***')).toBe('custom_drag_data.bwdrag.json');
        expect(dragDataFileName('x'.repeat(200))).toHaveLength(92);
    });
});
