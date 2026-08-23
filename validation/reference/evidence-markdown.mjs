const evidenceLevelFallback = [
    {
        id: 'inventory_only',
        rank: 0,
        definition: 'Implementation values are recorded without a predictive accuracy check.',
    },
    {
        id: 'calibration_only',
        rank: 1,
        definition: 'Parameters use the reported observations and have no separate holdout.',
    },
    {
        id: 'manufacturer_conformance',
        rank: 2,
        definition: 'Output is compared with a manufacturer or publication table.',
    },
    {
        id: 'independent_model_conformance',
        rank: 3,
        definition: 'Output is compared with a separately implemented model.',
    },
    {
        id: 'empirical_holdout',
        rank: 4,
        definition: 'Predictions are compared with measurements excluded from fitting.',
    },
];

export function markdownCell(value) {
    return String(value ?? 'not recorded')
        .replaceAll('|', '\\|')
        .replaceAll('\r\n', '<br>')
        .replaceAll('\n', '<br>');
}

export function code(value) {
    return `\`${String(value ?? 'not recorded').replaceAll('`', '\\`')}\``;
}

export function labelFor(key) {
    const expanded = key
        .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replaceAll(/[_-]+/g, ' ')
        .trim();
    return expanded.length === 0 ? key : expanded[0].toUpperCase() + expanded.slice(1);
}

export function scalar(value) {
    if (value === null) return 'not recorded';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'number') return String(value);
    return String(value ?? 'not recorded');
}

function renderNestedFields(value, depth) {
    const indent = '    '.repeat(depth);
    if (Array.isArray(value)) {
        if (value.length === 0) return [`${indent}- none recorded`];
        return value.flatMap((item) => {
            if (item !== null && typeof item === 'object') {
                return [`${indent}-`, ...renderNestedFields(item, depth + 1)];
            }
            return [`${indent}- ${scalar(item)}`];
        });
    }
    if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) => {
            if (item !== null && typeof item === 'object') {
                return [`${indent}- **${labelFor(key)}:**`, ...renderNestedFields(item, depth + 1)];
            }
            return [`${indent}- **${labelFor(key)}:** ${scalar(item)}`];
        });
    }
    return [`${indent}- ${scalar(value)}`];
}

export function renderFields(record, excluded = []) {
    const excludedKeys = new Set(excluded);
    const selected = Object.fromEntries(
        Object.entries(record).filter(([key]) => !excludedKeys.has(key)),
    );
    return renderNestedFields(selected, 0);
}

function sourceTitle(dataset) {
    return dataset.source?.title ?? dataset.source?.publication ?? 'User-supplied data';
}

function sourcePublisher(dataset) {
    return dataset.source?.publisher ?? dataset.source?.author ?? 'not recorded';
}

function sourceDate(dataset) {
    return (
        dataset.source?.publicationDate ??
        dataset.source?.year ??
        dataset.source?.editionOrVersion ??
        dataset.source?.edition ??
        'not recorded'
    );
}

function sourceArchiveStatus(dataset) {
    return dataset.source?.archivedLocator ? 'yes' : 'no';
}

function evidenceLevels(manifest) {
    const levels = manifest.evidenceLevels ?? evidenceLevelFallback;
    return [...levels].sort((left, right) => left.rank - right.rank);
}

function renderEvidenceLevelSection(lines, manifest, inventory) {
    const counts = new Map();
    for (const load of inventory.loads) {
        counts.set(load.validation.level, (counts.get(load.validation.level) ?? 0) + 1);
    }

    lines.push(
        '## Evidence levels',
        '',
        '| Level | Rank | Built-in loads | Meaning |',
        '| --- | ---: | ---: | --- |',
    );
    for (const level of evidenceLevels(manifest)) {
        lines.push(
            `| ${code(level.id)} | ${level.rank} | ${counts.get(level.id) ?? 0} | ` +
                `${markdownCell(level.definition)} |`,
        );
    }
    lines.push('');
}

function renderModelSection(lines, manifest) {
    lines.push(
        '## Declared models and workflows',
        '',
        '| ID | Implementation | Description |',
        '| --- | --- | --- |',
    );
    for (const model of manifest.models) {
        lines.push(
            `| ${code(model.id)} | ${code(model.implementation)} | ` +
                `${markdownCell(model.description)} |`,
        );
    }
    lines.push('');

    for (const model of manifest.models) {
        lines.push(
            `### ${model.id}`,
            '',
            model.description,
            '',
            `Implementation: ${code(model.implementation)}.`,
            '',
            ...renderFields(model, ['id', 'description', 'implementation']),
            '',
        );
    }
}

function loadSourceSummary(load, datasetsById) {
    return (load.provenance.sourceDatasetIds ?? [])
        .map((id) => {
            const dataset = datasetsById.get(id);
            return dataset ? `${id} (${dataset.kind})` : `${id} (missing)`;
        })
        .join(', ');
}

function renderBuiltInSection(lines, manifest, inventory) {
    const datasetsById = new Map(manifest.datasets.map((dataset) => [dataset.id, dataset]));
    lines.push(
        '## Built-in load evidence',
        '',
        '| Load | Drag | Evidence | Parameter source | Primary source | Archived copy |',
        '| --- | --- | --- | --- | --- | --- |',
    );
    for (const load of inventory.loads) {
        const primary = load.provenance.primarySourceIdentified === true ? 'yes' : 'no';
        lines.push(
            `| ${markdownCell(`${load.manufacturer} ${load.product}`)} | ` +
                `${markdownCell(load.implementation.dragModel)} | ${code(load.validation.level)} | ` +
                `${code(load.implementation.parameterStatus)} | ${primary} | ` +
                `${load.provenance.primarySourceArchived === true ? 'yes' : 'no'} |`,
        );
    }
    lines.push('');

    for (const load of inventory.loads) {
        lines.push(
            `### ${load.manufacturer} ${load.product}`,
            '',
            `Load ID: ${code(load.id)}. Firearm group: ${code(load.firearmGroup)}.`,
            '',
            'Implementation values:',
            '',
            ...renderFields(load.implementation),
            '',
            'Linked datasets:',
            '',
            loadSourceSummary(load, datasetsById) || 'No source datasets are linked.',
            '',
            'Known source facts:',
            '',
            load.provenance.knownSourceFacts ?? 'No source facts are recorded.',
            '',
            'Current evidence:',
            '',
            load.validation.summary,
            '',
            'Open gap:',
            '',
            load.provenance.gap,
            '',
        );
    }
}

function renderDatasetSection(lines, manifest) {
    lines.push(
        '## Dataset register',
        '',
        '| Dataset | Kind | Publisher or author | Date or edition | Archived copy |',
        '| --- | --- | --- | --- | --- |',
    );
    for (const dataset of manifest.datasets) {
        lines.push(
            `| ${code(dataset.id)} | ${code(dataset.kind)} | ` +
                `${markdownCell(sourcePublisher(dataset))} | ${markdownCell(sourceDate(dataset))} | ` +
                `${sourceArchiveStatus(dataset)} |`,
        );
    }
    lines.push('');

    for (const dataset of manifest.datasets) {
        lines.push(
            `### ${dataset.id}`,
            '',
            sourceTitle(dataset),
            '',
            `Repository data: ${code(dataset.path)}. SHA-256: ${code(dataset.sha256)}.`,
            '',
            ...renderFields(dataset, ['id', 'path', 'sha256']),
            '',
        );
    }
}

function renderOpenGapIndex(lines, inventory) {
    const withoutArchivedSource = inventory.loads.filter(
        (load) => load.provenance.primarySourceArchived !== true,
    );
    const withoutHoldout = inventory.loads.filter(
        (load) => load.validation.level !== 'empirical_holdout',
    );
    const withoutPrimarySource = inventory.loads.filter(
        (load) => load.provenance.primarySourceIdentified !== true,
    );

    lines.push(
        '## Open evidence gap index',
        '',
        `- ${withoutArchivedSource.length} of ${inventory.loads.length} built-in loads lack an ` +
            'archived primary source copy.',
        `- ${withoutPrimarySource.length} of ${inventory.loads.length} built-in loads lack an ` +
            'identified primary manufacturer source.',
        `- ${withoutHoldout.length} of ${inventory.loads.length} built-in loads lack empirical ` +
            'holdout evidence.',
        '',
        '| Load ID | Evidence level | Gap |',
        '| --- | --- | --- |',
    );
    for (const load of inventory.loads) {
        lines.push(
            `| ${code(load.id)} | ${code(load.validation.level)} | ` +
                `${markdownCell(load.provenance.gap)} |`,
        );
    }
    lines.push('');
}

export function renderSourceEvidence(manifest, inventory) {
    if (!manifest?.modelVersion || !Array.isArray(manifest.datasets)) {
        throw new Error('Validation manifest is missing its model version or dataset register.');
    }
    if (!Array.isArray(manifest.models) || !Array.isArray(inventory?.loads)) {
        throw new Error('Validation models or built-in inventory are missing.');
    }
    if (inventory.modelVersion && inventory.modelVersion !== manifest.modelVersion) {
        throw new Error('Validation manifest and built-in inventory use different model versions.');
    }

    const lines = [
        '# Validation Evidence Inventory',
        '',
        '> Generated from `validation/manifest.json` and',
        '> `validation/normalized/builtin-loads.json`. Change those records, then regenerate this file.',
        '',
        `Model version: ${code(manifest.modelVersion)}. Registered datasets: ` +
            `${manifest.datasets.length}. Declared models and workflows: ${manifest.models.length}. ` +
            `Built-in loads: ${inventory.loads.length}.`,
        '',
        'This inventory records the source, scope, and current gap for each claim. Passing numerical',
        'checks do not raise a load above the evidence level recorded in the manifest.',
        '',
    ];

    renderEvidenceLevelSection(lines, manifest, inventory);
    renderModelSection(lines, manifest);
    renderBuiltInSection(lines, manifest, inventory);
    renderOpenGapIndex(lines, inventory);
    renderDatasetSection(lines, manifest);
    while (lines.at(-1) === '') lines.pop();
    return `${lines.join('\n')}\n`;
}
