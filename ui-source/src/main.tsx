import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "./theme.css";
import { App } from "./App.tsx";
import { useStore } from "./state/store.ts";

// Dev-only handle on the league, so a stage deep in the annual cycle can be
// reached from the console instead of clicked to. `import.meta.env.DEV` is a
// compile-time constant, so this whole block is dropped from the build.
if (import.meta.env.DEV) {
  (window as unknown as { store: typeof useStore }).store = useStore;
}

// HashRouter (not BrowserRouter) so routes work when the built single-file
// index.html is opened directly from disk (file://) with no server.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
