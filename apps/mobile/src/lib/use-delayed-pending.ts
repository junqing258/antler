import { useEffect, useState } from "react";

/** Avoid flashing loading indicators during short requests and background refreshes. */
export function useDelayedPending(pending: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!pending) return;
    const timer = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(timer);
  }, [pending]);

  return pending && visible;
}
