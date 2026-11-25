import type { ScopeEvent, StateHandle } from "@kalaido/state/scope";
import { type Context, createContext, useContext } from "react";

export type ScopeContext<
  S extends object,
  E extends ScopeEvent = never,
> = Context<StateHandle<S, E> | null>;

/**
 * Create a typed React Context for distributing a parent or root
 * {@link StateHandle} down the component tree so descendants can narrow slices
 * via `useScope({ from, state, events })` without prop-drilling.
 */
export function createScopeContext<
  S extends object,
  E extends ScopeEvent = never,
>(displayName = "ScopeContext"): ScopeContext<S, E> {
  const ctx = createContext<StateHandle<S, E> | null>(null);
  ctx.displayName = displayName;
  return ctx;
}

/** Read the nearest {@link StateHandle} from `context`, or `null` outside its provider. */
export function useOptionalScopeContext<
  S extends object,
  E extends ScopeEvent = never,
>(context: ScopeContext<S, E>): StateHandle<S, E> | null {
  return useContext(context);
}

/** Read the nearest {@link StateHandle} from `context`, throwing if outside its provider. */
export function useScopeContext<S extends object, E extends ScopeEvent = never>(
  context: ScopeContext<S, E>,
): StateHandle<S, E> {
  const scope = useContext(context);
  if (!scope) {
    const name = context.displayName ?? "ScopeContext";
    throw new Error(
      `useScopeContext (${name}) must be used inside a ${name}.Provider.`,
    );
  }
  return scope;
}
