import type { CustomDraft, Inputs, Result } from '../types';

export async function calculate(inputs: Inputs): Promise<Result> {
  if (window.ballistics) return window.ballistics.calculate(inputs);
  const query = new URLSearchParams(
    Object.entries(inputs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`/api/calculate?${query}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export const customToInputs = (draft: CustomDraft): Partial<Inputs> => ({
  customName: draft.name,
  customDrag: draft.drag,
  customGroup: draft.group,
  customMassKg: draft.massG / 1000,
  customMuzzleVelocityMps: draft.mv,
  customBc: draft.bc,
  customSphereDiameterM: draft.sphereMm / 1000,
  customDensityKgM3: draft.density,
  customPelletCount: draft.count,
  customBulletLengthInches: draft.length,
  customBulletDiameterInches: draft.diameter,
  customTwistInches: draft.twist,
});

export async function calculateAll(inputs: Inputs, customLoads: CustomDraft[]): Promise<Result> {
  const {
    customName,
    customDrag,
    customGroup,
    customMassKg,
    customMuzzleVelocityMps,
    customBc,
    customSphereDiameterM,
    customDensityKgM3,
    customPelletCount,
    customBulletLengthInches,
    customBulletDiameterInches,
    customTwistInches,
    ...standardInputs
  } = inputs;
  const base = await calculate(standardInputs);
  if (!customLoads.length) return base;
  const customResults = await Promise.all(
    customLoads.map((draft) => calculate({ ...standardInputs, ...customToInputs(draft) })),
  );
  return {
    ...base,
    loads: [...base.loads, ...customResults.map((result) => result.loads.at(-1)!)],
  };
}
