import React from "react";

type Props = { children: React.ReactNode; fallback?: React.ReactNode };
type State = { hasError: boolean; msg?: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(err: any): State {
    return { hasError: true, msg: String(err?.message || err) };
  }
  componentDidCatch(err: any, info: any) {
    console.error("ErrorBoundary caught:", err, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: "1rem" }}>
          <h3>Something went wrong.</h3>
          <div style={{ color: "#888", fontSize: 12 }}>{this.state.msg}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
