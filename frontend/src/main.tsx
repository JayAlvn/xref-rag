import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SetupScreen } from "./components/SetupScreen";
import { THEMES } from "./lib/themes";
import {
  backendAddress, backendIsUp, beginSetup, connectBackend, fetchSetup,
  type SetupStatus,
} from "./lib/utils";

/* Seconds before the start screen says what it is waiting for. */
const PATIENCE_S = 15;

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* The panes mount only once the backend answers and a language model is ready:
   the first question never meets a closed port or a missing model. Until then
   it waits (in development the server may be started after the app) or shows
   the one-time setup. */
function Boot() {
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [setup, setSetup] = useState<SetupStatus | null>(null);

  useEffect(() => {
    let active = true;
    const started = Date.now();

    const wait = async () => {
      await connectBackend();
      while (active && !(await backendIsUp())) {
        if (Date.now() - started > PATIENCE_S * 1000) setSlow(true);
        await pause(500);
      }

      while (active) {
        const status = await fetchSetup();
        if (!active) return;
        if (status !== null && status.state === "ready") {
          setReady(true);
          return;
        }
        if (status !== null) setSetup(status);
        await pause(1000);
      }
    };
    wait();

    return () => {
      active = false;
    };
  }, []);

  if (ready) return <App />;
  if (setup !== null) return <SetupScreen status={setup} onStart={beginSetup} />;

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
