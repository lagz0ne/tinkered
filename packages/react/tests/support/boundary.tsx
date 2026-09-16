import { Component } from "react";
import type { ReactNode } from "react";

type Props = { readonly fallback: (error: unknown) => ReactNode; readonly children: ReactNode };
type State = { readonly error: unknown };

/** A test error boundary: renders `fallback(error)` once a descendant throws. React error
 * boundaries must be class components — this is the one class the React tests use. */
export class Catch extends Component<Props, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  render(): ReactNode {
    return this.state.error === undefined
      ? this.props.children
      : this.props.fallback(this.state.error);
  }
}
