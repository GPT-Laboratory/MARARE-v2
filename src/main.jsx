/**
 * Application entry point (bootstrapped by Vite).
 *
 * Provider stack (outer → inner):
 * ThemeProvider → AuthProvider → ToggleProvider → Redux → RefProvider → Snackbar → App
 */
import "regenerator-runtime/runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "global";
import App from "./App.jsx";
import "./index.css";
import { Provider } from "react-redux";
import { store } from "./store/store.jsx";
import { RefProvider } from "./providers/RefProvider.jsx";
import { AuthProvider } from "./pages/auth/authcontext.jsx";
import { ToggleProvider } from "./providers/useToggleHook.jsx";
import { SnackbarProvider } from 'notistack'
import { ThemeProvider } from "./context/ThemeContext.jsx";

createRoot(document.getElementById("root")).render(
    <ThemeProvider>
      <AuthProvider>
        <ToggleProvider>
          <Provider store={store}>
            <RefProvider>
              <SnackbarProvider>
                <App />
              </SnackbarProvider>
            </RefProvider>
          </Provider>
        </ToggleProvider>
      </AuthProvider>
    </ThemeProvider>
);
