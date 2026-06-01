import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "../styles.css";
import { i18nReady } from "../shared/i18n";

// Wait for locale resources to load before rendering, so t() never
// falls back to raw key names on first paint.
i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
