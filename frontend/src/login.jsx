/* BAC Maps: the sign-in page. */
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/login.css";
import "./lib/pwa.js";
import LoginPage from "./components/LoginPage.jsx";

createRoot(document.getElementById("root")).render(<LoginPage />);
