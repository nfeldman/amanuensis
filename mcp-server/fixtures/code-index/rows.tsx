// Fixture for the code-index extractor: every TSX row of PLAN §4.2.
import React from "react";

export interface ButtonProps {
  label: string;
}

type Size = "s" | "m";

enum Tone {
  Plain,
}

/** A button. */
export function Button({ label }: ButtonProps) {
  return <button className="btn">{label}</button>;
}

function* frames() {
  yield <span />;
}

export class Panel extends React.Component<ButtonProps> {
  state = { open: false };

  constructor(props: ButtonProps) {
    super(props);
  }

  get open(): boolean {
    return this.state.open;
  }

  set open(value: boolean) {
    this.setState({ open: value });
  }

  render() {
    return <div>{this.props.label}</div>;
  }
}

namespace Layout {
  export const gap = 8;
}

export const Icon = ({ size }: { size: Size }) => <i data-size={size} />;

const theme = { tone: Tone.Plain };

export default Panel;
