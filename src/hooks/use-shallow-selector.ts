/**
 * 浅比较选择器 Hook
 * 
 * 用于优化 Zustand store 的选择器，避免不必要的重渲染
 * 
 * 使用场景：
 * - 当选择器返回对象时，使用 useShallowSelector 可以进行浅比较
 * - 当只需要 store 中的单个值时，直接使用普通选择器
 */

import { useRef, useCallback } from 'react';

/**
 * 浅比较两个值是否相等
 */
function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (
      !Object.prototype.hasOwnProperty.call(b, key) ||
      !Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    ) {
      return false;
    }
  }

  return true;
}

/**
 * 浅比较选择器 - 用于 Zustand store
 * 
 * @example
 * ```tsx
 * // 替代:
 * const { tasks, jobStatus } = useVideoBatchStore(state => ({
 *   tasks: state.tasks,
 *   jobStatus: state.jobStatus,
 * }));
 * 
 * // 使用:
 * const { tasks, jobStatus } = useVideoBatchStore(
 *   useShallowSelector(state => ({
 *     tasks: state.tasks,
 *     jobStatus: state.jobStatus,
 *   }))
 * );
 * ```
 */
export function useShallowSelector<S, T>(
  selector: (state: S) => T
): (state: S) => T {
  const prevRef = useRef<T | undefined>(undefined);

  return useCallback(
    (state: S) => {
      const next = selector(state);
      
      if (shallowEqual(prevRef.current, next)) {
        return prevRef.current as T;
      }
      
      prevRef.current = next;
      return next;
    },
    [selector]
  );
}

/**
 * 创建稳定的选择器
 * 用于避免每次渲染都创建新的选择器函数
 * 
 * @example
 * ```tsx
 * // 在组件外部创建选择器
 * const selectTasks = createSelector((state: VideoBatchState) => state.tasks);
 * const selectJobStatus = createSelector((state: VideoBatchState) => state.jobStatus);
 * 
 * // 在组件内使用
 * function MyComponent() {
 *   const tasks = useVideoBatchStore(selectTasks);
 *   const jobStatus = useVideoBatchStore(selectJobStatus);
 * }
 * ```
 */
export function createSelector<S, T>(selector: (state: S) => T): (state: S) => T {
  return selector;
}

/**
 * 创建带记忆的选择器
 * 只有当依赖项改变时才重新计算
 * 
 * @example
 * ```tsx
 * const selectFilteredTasks = createMemoSelector(
 *   (state: VideoBatchState) => state.tasks,
 *   (state: VideoBatchState) => state.filter,
 *   (tasks, filter) => tasks.filter(t => t.status === filter)
 * );
 * ```
 */
export function createMemoSelector<S, D extends unknown[], R>(
  ...args: [...selectors: ((state: S) => D[number])[], combiner: (...deps: D) => R]
): (state: S) => R {
  const selectors = args.slice(0, -1) as ((state: S) => D[number])[];
  const combiner = args[args.length - 1] as (...deps: D) => R;
  
  let lastDeps: D | undefined;
  let lastResult: R | undefined;

  return (state: S): R => {
    const deps = selectors.map(selector => selector(state)) as D;
    
    // 检查依赖是否改变
    const depsChanged = !lastDeps || deps.some((dep, i) => !Object.is(dep, lastDeps![i]));
    
    if (depsChanged) {
      lastDeps = deps;
      lastResult = combiner(...deps);
    }
    
    return lastResult!;
  };
}

export default useShallowSelector;
