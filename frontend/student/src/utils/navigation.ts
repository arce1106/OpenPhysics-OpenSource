import type { Location, NavigateFunction } from 'react-router-dom';

export type ReturnRouteState = Record<string, unknown> & {
  from?: string;
};

function canUseHistoryBack() {
  if (typeof window === 'undefined') return false;
  const historyIndex = window.history.state?.idx;
  return typeof historyIndex !== 'number' || historyIndex > 0;
}

export function getReturnState(location: Location): ReturnRouteState {
  return (location.state || {}) as ReturnRouteState;
}

export function buildReturnState(location: Location, extra: ReturnRouteState = {}): ReturnRouteState {
  return {
    ...getReturnState(location),
    ...extra,
    from: `${location.pathname}${location.search}`,
  };
}

export function navigateBackToPreviousPage(
  navigate: NavigateFunction,
  location: Location,
  fallback: string,
  options: { state?: ReturnRouteState } = {},
) {
  const routeState = getReturnState(location);
  const from = routeState.from;

  if (from) {
    const nextState: ReturnRouteState = { ...routeState, ...(options.state || {}) };
    delete nextState.from;
    navigate(from, { state: nextState, replace: true });
    return;
  }

  if (canUseHistoryBack()) {
    navigate(-1);
    return;
  }

  navigate(fallback, { replace: true, state: options.state });
}
