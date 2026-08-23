import type { Load } from '../types';

export function firearmLabel(load: Load) {
    return load.firearmGroup === 'rifle' ? 'Rifle' : 'Shotgun';
}

export function projectileLabel(load: Load) {
    return load.pelletCount > 1 ? 'pellet' : 'projectile';
}

export function dragDescription(load: Load) {
    if (load.dragModel === 'Sphere') {
        return 'Reynolds–Mach sphere';
    }
    if (load.dragModel === 'MachCd') {
        return 'tabulated Mach–Cd';
    }
    return `${load.dragModel}${load.ballisticCoefficientBands.length ? ' banded' : ''} reference`;
}
