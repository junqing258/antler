import type { ReactNode } from "react";

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
  leading?: ReactNode;
  background?: ReactNode;
};
