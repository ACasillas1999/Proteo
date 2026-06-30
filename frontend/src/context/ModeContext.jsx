import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const ModeContext = createContext({ mode: null, branchId: null, loading: true });

export function ModeProvider({ children }) {
  const [mode,     setMode]     = useState(null);
  const [branchId, setBranchId] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    axios.get('/api/mode')
      .then(r => { setMode(r.data.mode); setBranchId(r.data.branchId); })
      .catch(() => setMode('master'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ModeContext.Provider value={{ mode, branchId, loading }}>
      {children}
    </ModeContext.Provider>
  );
}

export const useMode = () => useContext(ModeContext);
