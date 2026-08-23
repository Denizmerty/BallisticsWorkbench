import type { MouseEvent } from 'react';
import type { CustomDraft, Inputs } from '../types';
import { GR_TO_KG, MPS_TO_FPS } from '../lib/units';
import { CalibrationPanel } from './CalibrationPanel';

type Props = {
    draft: CustomDraft;
    inputs: Inputs;
    imperial: boolean;
    errors: string[];
    editing: boolean;
    transferNotice: string;
    onChange: (draft: CustomDraft) => void;
    onImportDragData: () => void;
    onExportDragData: () => void;
    onCancel: () => void;
    onSave: () => void;
};

export function CustomLoadDialog({
    draft,
    inputs,
    imperial,
    errors,
    editing,
    transferNotice,
    onChange,
    onImportDragData,
    onExportDragData,
    onCancel,
    onSave,
}: Props) {
    const update = (patch: Partial<CustomDraft>) => onChange({ ...draft, ...patch });
    const updateDragMetadata = (patch: Partial<CustomDraft['dragDataMetadata']>) =>
        update({ dragDataMetadata: { ...draft.dragDataMetadata, ...patch } });
    const sphereMassKg = (draft.density * Math.PI * Math.pow(draft.sphereMm / 1000, 3)) / 6;
    const sphereMass = imperial
        ? `${(sphereMassKg / GR_TO_KG).toFixed(2)} gr`
        : `${(sphereMassKg * 1000).toFixed(3)} g`;
    const closeBackdrop = (event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onCancel();
    };

    return (
        <div className="modal-backdrop" onMouseDown={closeBackdrop}>
            <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="custom-load-title"
            >
                <div className="modal-head">
                    <div>
                        <span className="eyebrow">USER-DEFINED BALLISTIC MODEL</span>
                        <h2 id="custom-load-title">Custom projectile</h2>
                    </div>
                    <button
                        type="button"
                        aria-label="Close custom projectile editor"
                        onClick={onCancel}
                    >
                        ×
                    </button>
                </div>
                <div className="modal-grid">
                    <label>
                        Name
                        <input
                            value={draft.name}
                            onChange={(event) => update({ name: event.target.value })}
                        />
                    </label>
                    <label>
                        Drag model
                        <select
                            value={draft.drag}
                            onChange={(event) =>
                                update({ drag: event.target.value as CustomDraft['drag'] })
                            }
                        >
                            <option>G1</option>
                            <option>G7</option>
                            <option value="MachCd">Mach–Cd table</option>
                            <option>Sphere</option>
                        </select>
                    </label>
                    <label>
                        Firearm profile
                        <select
                            value={draft.group}
                            onChange={(event) =>
                                update({ group: event.target.value as CustomDraft['group'] })
                            }
                        >
                            <option value="shotgun">Shotgun</option>
                            <option value="rifle">Rifle</option>
                        </select>
                    </label>
                    <label>
                        Muzzle velocity ({imperial ? 'ft/s' : 'm/s'})
                        <input
                            type="number"
                            value={imperial ? draft.mv * MPS_TO_FPS : draft.mv}
                            onChange={(event) =>
                                update({
                                    mv: imperial
                                        ? Number(event.target.value) / MPS_TO_FPS
                                        : Number(event.target.value),
                                })
                            }
                        />
                    </label>
                    {draft.drag === 'Sphere' ? (
                        <>
                            <label>
                                Sphere diameter ({imperial ? 'in' : 'mm'})
                                <input
                                    type="number"
                                    value={imperial ? draft.sphereMm / 25.4 : draft.sphereMm}
                                    onChange={(event) =>
                                        update({
                                            sphereMm: imperial
                                                ? Number(event.target.value) * 25.4
                                                : Number(event.target.value),
                                        })
                                    }
                                />
                            </label>
                            <label>
                                Material density (kg/m³)
                                <input
                                    type="number"
                                    value={draft.density}
                                    onChange={(event) =>
                                        update({ density: Number(event.target.value) })
                                    }
                                />
                            </label>
                            <p className="modal-note">Derived mass per pellet: {sphereMass}</p>
                        </>
                    ) : (
                        <>
                            <label>
                                Projectile mass ({imperial ? 'gr' : 'g'})
                                <input
                                    type="number"
                                    value={imperial ? draft.massG / (GR_TO_KG * 1000) : draft.massG}
                                    onChange={(event) =>
                                        update({
                                            massG: imperial
                                                ? Number(event.target.value) * GR_TO_KG * 1000
                                                : Number(event.target.value),
                                        })
                                    }
                                />
                            </label>
                            {draft.drag === 'MachCd' ? (
                                <>
                                    <label>
                                        Drag reference diameter ({imperial ? 'in' : 'mm'})
                                        <input
                                            type="number"
                                            value={
                                                imperial
                                                    ? draft.machCdDiameterMm / 25.4
                                                    : draft.machCdDiameterMm
                                            }
                                            onChange={(event) =>
                                                update({
                                                    machCdDiameterMm: imperial
                                                        ? Number(event.target.value) * 25.4
                                                        : Number(event.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                    <div className="bc-bands curve-points">
                                        <div className="bc-bands-head">
                                            <span>Mach</span>
                                            <span>Cd</span>
                                            <span />
                                        </div>
                                        {draft.machCdPoints.map((point, index) => (
                                            <div className="bc-band-row" key={index}>
                                                <input
                                                    aria-label={`Mach–Cd point ${index + 1} Mach`}
                                                    type="number"
                                                    min="0"
                                                    max="10"
                                                    step="0.05"
                                                    value={point.mach}
                                                    onChange={(event) =>
                                                        update({
                                                            machCdPoints: draft.machCdPoints.map(
                                                                (item, itemIndex) =>
                                                                    itemIndex === index
                                                                        ? {
                                                                              ...item,
                                                                              mach: Number(
                                                                                  event.target
                                                                                      .value,
                                                                              ),
                                                                          }
                                                                        : item,
                                                            ),
                                                        })
                                                    }
                                                />
                                                <input
                                                    aria-label={`Mach–Cd point ${index + 1} coefficient`}
                                                    type="number"
                                                    min="0"
                                                    max="5"
                                                    step="0.001"
                                                    value={point.dragCoefficient}
                                                    onChange={(event) =>
                                                        update({
                                                            machCdPoints: draft.machCdPoints.map(
                                                                (item, itemIndex) =>
                                                                    itemIndex === index
                                                                        ? {
                                                                              ...item,
                                                                              dragCoefficient:
                                                                                  Number(
                                                                                      event.target
                                                                                          .value,
                                                                                  ),
                                                                          }
                                                                        : item,
                                                            ),
                                                        })
                                                    }
                                                />
                                                <button
                                                    type="button"
                                                    disabled={draft.machCdPoints.length <= 2}
                                                    onClick={() =>
                                                        update({
                                                            machCdPoints: draft.machCdPoints.filter(
                                                                (_item, itemIndex) =>
                                                                    itemIndex !== index,
                                                            ),
                                                        })
                                                    }
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            disabled={
                                                draft.machCdPoints.length >= 64 ||
                                                (draft.machCdPoints.at(-1)?.mach ?? 0) >= 10
                                            }
                                            onClick={() => {
                                                const previous = draft.machCdPoints.at(-1) ?? {
                                                    mach: 0,
                                                    dragCoefficient: 0.25,
                                                };
                                                update({
                                                    machCdPoints: [
                                                        ...draft.machCdPoints,
                                                        {
                                                            mach: Math.min(
                                                                10,
                                                                previous.mach + 0.25,
                                                            ),
                                                            dragCoefficient:
                                                                previous.dragCoefficient,
                                                        },
                                                    ],
                                                });
                                            }}
                                        >
                                            Add Mach–Cd point
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <label>
                                        BC representation
                                        <select
                                            value={draft.bcMode}
                                            onChange={(event) =>
                                                update({
                                                    bcMode: event.target
                                                        .value as CustomDraft['bcMode'],
                                                })
                                            }
                                        >
                                            <option value="constant">Constant BC</option>
                                            <option value="velocityBands">
                                                Velocity-banded BC
                                            </option>
                                        </select>
                                    </label>
                                    {draft.bcMode === 'constant' ? (
                                        <label>
                                            Ballistic coefficient
                                            <input
                                                type="number"
                                                step="0.001"
                                                value={draft.bc}
                                                onChange={(event) =>
                                                    update({ bc: Number(event.target.value) })
                                                }
                                            />
                                        </label>
                                    ) : (
                                        <div className="bc-bands">
                                            <div className="bc-bands-head">
                                                <span>
                                                    Minimum velocity ({imperial ? 'ft/s' : 'm/s'})
                                                </span>
                                                <span>BC</span>
                                                <span />
                                            </div>
                                            {draft.bcBands.map((band, index) => (
                                                <div className="bc-band-row" key={index}>
                                                    <input
                                                        aria-label={`BC band ${index + 1} minimum velocity`}
                                                        type="number"
                                                        disabled={index === 0}
                                                        value={
                                                            imperial
                                                                ? band.minimumVelocityMps *
                                                                  MPS_TO_FPS
                                                                : band.minimumVelocityMps
                                                        }
                                                        onChange={(event) =>
                                                            update({
                                                                bcBands: draft.bcBands.map(
                                                                    (item, itemIndex) =>
                                                                        itemIndex === index
                                                                            ? {
                                                                                  ...item,
                                                                                  minimumVelocityMps:
                                                                                      imperial
                                                                                          ? Number(
                                                                                                event
                                                                                                    .target
                                                                                                    .value,
                                                                                            ) /
                                                                                            MPS_TO_FPS
                                                                                          : Number(
                                                                                                event
                                                                                                    .target
                                                                                                    .value,
                                                                                            ),
                                                                              }
                                                                            : item,
                                                                ),
                                                            })
                                                        }
                                                    />
                                                    <input
                                                        aria-label={`BC band ${index + 1} coefficient`}
                                                        type="number"
                                                        step="0.001"
                                                        value={band.ballisticCoefficient}
                                                        onChange={(event) =>
                                                            update({
                                                                bcBands: draft.bcBands.map(
                                                                    (item, itemIndex) =>
                                                                        itemIndex === index
                                                                            ? {
                                                                                  ...item,
                                                                                  ballisticCoefficient:
                                                                                      Number(
                                                                                          event
                                                                                              .target
                                                                                              .value,
                                                                                      ),
                                                                              }
                                                                            : item,
                                                                ),
                                                            })
                                                        }
                                                    />
                                                    <button
                                                        type="button"
                                                        disabled={
                                                            index === 0 || draft.bcBands.length <= 2
                                                        }
                                                        onClick={() =>
                                                            update({
                                                                bcBands: draft.bcBands.filter(
                                                                    (_item, itemIndex) =>
                                                                        itemIndex !== index,
                                                                ),
                                                            })
                                                        }
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                disabled={
                                                    draft.bcBands.length >= 16 ||
                                                    (draft.bcBands.at(-1)?.minimumVelocityMps ??
                                                        0) >= 2000
                                                }
                                                onClick={() => {
                                                    const previous = draft.bcBands.at(-1) ?? {
                                                        minimumVelocityMps: 0,
                                                        ballisticCoefficient: draft.bc,
                                                    };
                                                    update({
                                                        bcBands: [
                                                            ...draft.bcBands,
                                                            {
                                                                minimumVelocityMps: Math.min(
                                                                    2000,
                                                                    previous.minimumVelocityMps +
                                                                        100,
                                                                ),
                                                                ballisticCoefficient:
                                                                    previous.ballisticCoefficient,
                                                            },
                                                        ],
                                                    });
                                                }}
                                            >
                                                Add BC band
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                    <label>
                        Projectiles / pellets in payload
                        <input
                            type="number"
                            min="1"
                            max="1000"
                            step="1"
                            value={draft.count}
                            onChange={(event) => update({ count: Number(event.target.value) })}
                        />
                    </label>
                    {draft.group === 'rifle' && (
                        <>
                            <label>
                                Bullet length (in)
                                <input
                                    type="number"
                                    value={draft.length}
                                    onChange={(event) =>
                                        update({ length: Number(event.target.value) })
                                    }
                                />
                            </label>
                            <label>
                                Bullet diameter (in)
                                <input
                                    type="number"
                                    value={draft.diameter}
                                    onChange={(event) =>
                                        update({ diameter: Number(event.target.value) })
                                    }
                                />
                            </label>
                            <label>
                                Twist override (in)
                                <input
                                    type="number"
                                    value={draft.twist}
                                    onChange={(event) =>
                                        update({ twist: Number(event.target.value) })
                                    }
                                />
                            </label>
                        </>
                    )}
                </div>
                <section className="drag-data-transfer" aria-label="Drag-data interchange">
                    <header>
                        <div>
                            <strong>Portable drag data</strong>
                            <span>
                                Import or export G1/G7 BC schedules and Mach–Cd curves with source
                                and domain metadata.
                            </span>
                        </div>
                        <div className="drag-data-actions">
                            <button type="button" onClick={onImportDragData}>
                                Import…
                            </button>
                            <button
                                type="button"
                                disabled={draft.drag === 'Sphere'}
                                onClick={onExportDragData}
                            >
                                Export…
                            </button>
                        </div>
                    </header>
                    {draft.drag !== 'Sphere' && (
                        <details>
                            <summary>Source, license, and declared domain</summary>
                            <div className="drag-data-metadata-grid">
                                <label>
                                    Source citation
                                    <input
                                        value={draft.dragDataMetadata.citation}
                                        maxLength={500}
                                        onChange={(event) =>
                                            updateDragMetadata({ citation: event.target.value })
                                        }
                                    />
                                </label>
                                <label>
                                    Source URL
                                    <input
                                        type="url"
                                        value={draft.dragDataMetadata.sourceUrl}
                                        maxLength={2000}
                                        placeholder="https://…"
                                        onChange={(event) =>
                                            updateDragMetadata({ sourceUrl: event.target.value })
                                        }
                                    />
                                </label>
                                <label>
                                    License or usage terms
                                    <input
                                        value={draft.dragDataMetadata.license}
                                        maxLength={200}
                                        onChange={(event) =>
                                            updateDragMetadata({ license: event.target.value })
                                        }
                                    />
                                </label>
                                <label>
                                    Source SHA-256 (optional)
                                    <input
                                        value={draft.dragDataMetadata.sourceChecksumSha256}
                                        maxLength={64}
                                        spellCheck={false}
                                        onChange={(event) =>
                                            updateDragMetadata({
                                                sourceChecksumSha256: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    Domain minimum ({draft.drag === 'MachCd' ? 'Mach' : 'm/s'})
                                    <input
                                        type="number"
                                        min="0"
                                        max={draft.drag === 'MachCd' ? 10 : 2000}
                                        value={draft.dragDataMetadata.domainMinimum ?? ''}
                                        onChange={(event) =>
                                            updateDragMetadata({
                                                domainMinimum:
                                                    event.target.value === ''
                                                        ? null
                                                        : Number(event.target.value),
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    Domain maximum ({draft.drag === 'MachCd' ? 'Mach' : 'm/s'})
                                    <input
                                        type="number"
                                        min="0"
                                        max={draft.drag === 'MachCd' ? 10 : 2000}
                                        value={draft.dragDataMetadata.domainMaximum ?? ''}
                                        onChange={(event) =>
                                            updateDragMetadata({
                                                domainMaximum:
                                                    event.target.value === ''
                                                        ? null
                                                        : Number(event.target.value),
                                            })
                                        }
                                    />
                                </label>
                            </div>
                        </details>
                    )}
                    {transferNotice && <p role="status">{transferNotice}</p>}
                </section>
                {(draft.drag === 'G1' || draft.drag === 'G7') && (
                    <CalibrationPanel
                        draft={draft}
                        inputs={inputs}
                        imperial={imperial}
                        onApply={(patch) => update(patch)}
                    />
                )}
                {draft.drag === 'Sphere' && (
                    <p className="modal-explanation">
                        Sphere mass is derived from diameter and density. The projectile-mass and BC
                        fields are not used. Payload totals equal one-pellet values × count.
                    </p>
                )}
                {draft.drag === 'MachCd' && (
                    <p className="modal-explanation">
                        Cd is linearly interpolated between Mach knots. The reference diameter
                        defines the frontal area used by the physical drag equation. Outside the
                        supplied knot range, the nearest endpoint Cd is used and the result carries
                        an extrapolation warning.
                    </p>
                )}
                {!!errors.length && (
                    <div className="validation-summary" role="alert">
                        {errors.map((message) => (
                            <p key={message}>{message}</p>
                        ))}
                    </div>
                )}
                <div className="modal-actions">
                    <button type="button" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="primary"
                        disabled={!!errors.length}
                        onClick={onSave}
                    >
                        {editing ? 'Save custom load' : 'Add custom load'}
                    </button>
                </div>
            </section>
        </div>
    );
}
