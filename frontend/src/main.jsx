/* BAC Maps: the map page. theme.js (in <head>) has already set light or
   dark; the map module, its data and Pathfinder are plain scripts loaded
   before this one (index.html). */
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/map-theme.css";
import "./lib/pwa.js";
import App from "./components/App.jsx";

// No StrictMode: it mounts effects twice in development, which would mount
// the map module twice into the same element.
createRoot(document.getElementById("root")).render(<App />);
