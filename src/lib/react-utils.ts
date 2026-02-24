/**
 * React 性能优化工具
 * 
 * 包含：
 * - 类型安全的 memo 包装器
 * - 防抖和节流 hooks
 * - 稳定回调 hook
 */

import { memo, useCallback, useRef, useEffect, useState, ComponentType } from 'react';

// ============================================================================
// 类型安全的 memo 包装器
// ============================================================================

/**
 * 类型安全的 React.memo 包装器
 * 
 * @example
 * ```tsx
 * interface Props {
 *   name: string;
 *   onClick: () => void;
 * }
 * 
 * const MyComponent = typedMemo<Props>(({ name, onClick }) => (
 *   <button onClick={onClick}>{name}</button>
 * ));
 * ```
 */
export function typedMemo<P extends object>(
  Component: ComponentType<P>,
  propsAreEqual?: (prevProps: Readonly<P>, nextProps: Readonly<P>) => boolean
): ComponentType<P> {
  return memo(Component, propsAreEqual) as unknown as ComponentType<P>;
}

// ============================================================================
// 防抖 Hook
// ============================================================================

/**
 * 防抖 Hook - 延迟执行函数，直到停止调用一段时间后
 * 
 * @example
 * ```tsx
 * const debouncedSearch = useDebouncedCallback(
 *   (query: string) => searchAPI(query),
 *   300
 * );
 * 
 * <input onChange={(e) => debouncedSearch(e.target.value)} />
 * ```
 */
export function useDebouncedCallback<T extends (...args: Parameters<T>) => ReturnType<T>>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const callbackRef = useRef(callback);

  // 保持 callback 引用最新
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 清理
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

/**
 * 防抖值 Hook - 返回防抖后的值
 * 
 * @example
 * ```tsx
 * const [searchQuery, setSearchQuery] = useState('');
 * const debouncedQuery = useDebouncedValue(searchQuery, 300);
 * 
 * useEffect(() => {
 *   searchAPI(debouncedQuery);
 * }, [debouncedQuery]);
 * ```
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// ============================================================================
// 节流 Hook
// ============================================================================

/**
 * 节流 Hook - 限制函数执行频率
 * 
 * @example
 * ```tsx
 * const throttledScroll = useThrottledCallback(
 *   () => console.log('scrolled'),
 *   100
 * );
 * 
 * window.addEventListener('scroll', throttledScroll);
 * ```
 */
export function useThrottledCallback<T extends (...args: Parameters<T>) => ReturnType<T>>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const lastRun = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastRun = now - lastRun.current;

      if (timeSinceLastRun >= delay) {
        lastRun.current = now;
        callbackRef.current(...args);
      } else {
        // 确保最后一次调用会执行
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastRun.current = Date.now();
          callbackRef.current(...args);
        }, delay - timeSinceLastRun);
      }
    },
    [delay]
  );
}

// ============================================================================
// 稳定回调 Hook
// ============================================================================

/**
 * 稳定回调 Hook - 返回始终引用最新函数的稳定回调
 * 用于避免在 useEffect 依赖中频繁触发
 * 
 * @example
 * ```tsx
 * const onClick = useStableCallback(() => {
 *   console.log(someState);
 * });
 * 
 * // onClick 引用不会改变，但总是执行最新的函数
 * useEffect(() => {
 *   element.addEventListener('click', onClick);
 *   return () => element.removeEventListener('click', onClick);
 * }, []); // 无需将 onClick 加入依赖
 * ```
 */
export function useStableCallback<T extends (...args: Parameters<T>) => ReturnType<T>>(
  callback: T
): T {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  );
}

// ============================================================================
// 上一个值 Hook
// ============================================================================

/**
 * 获取上一个渲染周期的值
 * 
 * @example
 * ```tsx
 * const [count, setCount] = useState(0);
 * const prevCount = usePrevious(count);
 * 
 * // prevCount 是上一次渲染时的 count 值
 * ```
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// ============================================================================
// 首次渲染检测 Hook
// ============================================================================

/**
 * 检测是否是首次渲染
 */
export function useIsFirstRender(): boolean {
  const isFirst = useRef(true);

  if (isFirst.current) {
    isFirst.current = false;
    return true;
  }

  return false;
}

// ============================================================================
// 更新效果 Hook
// ============================================================================

/**
 * 仅在更新时执行的 useEffect（跳过首次渲染）
 * 
 * @example
 * ```tsx
 * useUpdateEffect(() => {
 *   console.log('count changed:', count);
 * }, [count]);
 * // 首次渲染不会执行
 * ```
 */
export function useUpdateEffect(
  effect: React.EffectCallback,
  deps?: React.DependencyList
): void {
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    return effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ============================================================================
// 挂载检测 Hook
// ============================================================================

/**
 * 获取组件是否已挂载
 * 用于避免在卸载后更新状态
 * 
 * @example
 * ```tsx
 * const isMounted = useIsMounted();
 * 
 * useEffect(() => {
 *   fetchData().then(data => {
 *     if (isMounted()) {
 *       setState(data);
 *     }
 *   });
 * }, []);
 * ```
 */
export function useIsMounted(): () => boolean {
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return useCallback(() => isMounted.current, []);
}

export default {
  typedMemo,
  useDebouncedCallback,
  useDebouncedValue,
  useThrottledCallback,
  useStableCallback,
  usePrevious,
  useIsFirstRender,
  useUpdateEffect,
  useIsMounted,
};
