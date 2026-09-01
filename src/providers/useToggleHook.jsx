/**
 * Shared boolean toggle state for meeting panel visibility.
 * File: src/providers/useToggleHook.jsx
 */
import PropTypes from "prop-types";
import { createContext, useContext, useState } from "react";

// Create the context
const ToggleContext = createContext();

// Provide the context
export function ToggleProvider({ children }) {
  const [toggleState, setToggleState] = useState(false);

  return (
    <ToggleContext.Provider value={{ toggleState, setToggleState }}>
      {children}
    </ToggleContext.Provider>
  );
}

// Custom hook to use the context
export function useToggleHook() {
  return useContext(ToggleContext);
}

ToggleProvider.Proptypes = {
 children : PropTypes.node.isRequired,
}
