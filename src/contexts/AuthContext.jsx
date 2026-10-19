import { useCallback, useEffect, useState } from "react";
import { AuthContext } from "./auth-context.js";

const AUTH_STORAGE_KEY = "ai-chatbot.auth";

function readStoredAuth() {
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    const auth = saved ? JSON.parse(saved) : null;
    return auth?.token && auth?.user?.id ? auth : null;
  } catch (error) {
    console.error("Unable to restore authentication:", error);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth);

  useEffect(() => {
    try {
      if (auth) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Unable to persist authentication:", error);
    }
  }, [auth]);

  const logout = useCallback(() => setAuth(null), []);

  return (
    <AuthContext.Provider value={{ auth, setAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
