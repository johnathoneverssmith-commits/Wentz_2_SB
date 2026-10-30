import { useEffect, useRef, useState } from 'react';
import type { GamePlan } from '@/state/gamePlan';
import { requestPlanPreview } from '@/state/planPreviewClient';
import { comparePlans, type PlanComparison } from './model';
/** One in-flight comparison per mounted editor, trailing debounce, bounded snapshot-local cache.
 * A changed plan/context immediately hides old evidence; obsolete queued work never starts. */
export function usePlanComparison(enabled: boolean, context: object, saved: GamePlan, plan: GamePlan) {
    const key = JSON.stringify([saved, plan]);
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const cache = useRef<{
        context: object;
        values: Map<string, PlanComparison | null>;
    }>({ context, values: new Map() });
    const [retry, setRetry] = useState(0);
    const [result, setResult] = useState<{
        context: object;
        key: string;
        value?: PlanComparison | null;
        error?: string;
    }>();
    useEffect(() => {
        if (!enabled)
            return;
        let current = true;
        if (cache.current.context !== context)
            cache.current = { context, values: new Map() };
        const found = cache.current.values;
        const timer = setTimeout(() => {
            queue.current = queue.current.catch(() => { }).then(async () => {
                if (!current)
                    return;
                try {
                    const value = found.has(key) ? found.get(key)! : await comparePlans(saved, plan, p => {
                        if (!current)
                            throw Error('Superseded projection');
                        return requestPlanPreview(p);
                    });
                    if (!current)
                        return;
                    found.set(key, value);
                    if (found.size > 8)
                        found.delete(found.keys().next().value!);
                    setResult({ context, key, value });
                }
                catch (e) {
                    if (current)
                        setResult({ context, key, error: e instanceof Error ? e.message : 'Projection unavailable. Try again.' });
                }
            });
        }, 450);
        return () => { current = false; clearTimeout(timer); };
    }, [enabled, context, key, retry]); // plans are completely represented in key
    const fresh = result?.context === context && result.key === key;
    return { value: enabled && fresh ? result.value : undefined, error: enabled && fresh ? result.error : undefined, busy: enabled && (!fresh || (!result?.error && result?.value === undefined)), retry: () => { cache.current.values.delete(key); setResult(undefined); setRetry(n => n + 1); } };
}
