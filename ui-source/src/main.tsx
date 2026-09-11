import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "./theme.css";
import { App } from "./App.tsx";

// HashRouter (not BrowserRouter) so routes work when the built single-file
// index.html is opened directly from disk (file://) with no server.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
