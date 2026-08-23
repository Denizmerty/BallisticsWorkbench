import { useEffect, useRef, useState } from 'react';
import type { CustomDraft, Inputs, Result, UncertaintySettings } from '../types';
import { calculateAll } from './calculate';
import { RequestGeneration } from './requestGeneration';

export type CalculationState =
    | { status: 'idle'; result: null; error: '' }
    | { status: 'pending'; result: Result | null; error: '' }
    | { status: 'success'; result: Result; error: '' }
    | { status: 'stale'; result: Result; error: string }
    | { status: 'error'; result: null; error: string };

export function useCalculationController(
    inputs: Inputs,
    customLoads: CustomDraft[],
    uncertainty: UncertaintySettings,
    validationErrorCount: number,
) {
    const [state, setState] = useState<CalculationState>({
        status: 'idle',
        result: null,
        error: '',
    });
    const generation = useRef(new RequestGeneration());
    const latestResult = useRef<Result | null>(null);

    useEffect(() => {
        const requestGeneration = generation.current.begin();
        const controller = new AbortController();

        if (validationErrorCount) {
            latestResult.current = null;
            setState({ status: 'idle', result: null, error: '' });
            return () => controller.abort();
        }

        setState({ status: 'pending', result: latestResult.current, error: '' });
        const requestId = `calculation-${requestGeneration}`;
        const timer = window.setTimeout(async () => {
            try {
                const result = await calculateAll(
                    inputs,
                    customLoads,
                    requestId,
                    controller.signal,
                    uncertainty,
                );
                if (!generation.current.isCurrent(requestGeneration) || controller.signal.aborted)
                    return;
                latestResult.current = result;
                setState({ status: 'success', result, error: '' });
            } catch (error) {
                if (!generation.current.isCurrent(requestGeneration) || controller.signal.aborted)
                    return;
                const message = String(error);
                setState(
                    latestResult.current
                        ? { status: 'stale', result: latestResult.current, error: message }
                        : { status: 'error', result: null, error: message },
                );
            }
        }, 180);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [inputs, customLoads, uncertainty, validationErrorCount]);

    return state;
}
