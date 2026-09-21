import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { THEMES } from "./lib/themes";
import { backendAddress, backendIsUp, connectBackend } from "./lib/utils";

/* Seconds before the start screen says what it is waiting for. */
const PATIENCE_S = 15;

/* The bundled backend takes a few seconds to start, so the panes mount only
   once it answers: the first question never meets a closed port. It keeps
   waiting rather than giving up, since in development the server may be
   started after the app. */
function Boot() {
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let active = true;
    const started = Date.now();

    const wait = async () => {
      await connectBackend();
      while (active) {
        if (await backendIsUp()) {
          if (active) setReady(true);
          return;
        }
        if (Date.now() - started > PATIENCE_S * 1000) setSlow(true);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    };
    wait();

    return () => {
      active = false;
    };
  }, []);

  if (ready) return <App />;

  let message = "Starting xref-rag…";
  if (slow) message = `Still waiting for the backend at ${backendAddress()}…`;

  const colors = THEMES[0].colors;
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bg,
        color: colors.textMuted,
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>,
);
