import { useEffect } from "react";

export default function Toast({ message, type = "success", onDismiss }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  if (!message) return null;
  return <div className={`toast ${type}`}>{message}</div>;
}
