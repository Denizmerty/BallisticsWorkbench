export function reconcileSelectedLoadId(
    selectedId: string | null,
    resultIds: readonly string[],
    pendingCustomIds: readonly string[],
    resultIsCurrent: boolean,
) {
    if (!resultIsCurrent) return selectedId;
    if (selectedId && (resultIds.includes(selectedId) || pendingCustomIds.includes(selectedId))) {
        return selectedId;
    }
    return resultIds[0] ?? null;
}
