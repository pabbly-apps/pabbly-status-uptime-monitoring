import { createContext, useContext, useState, useEffect } from 'react';
import { getUserTimezone } from '../utils/timezone';

const TimezoneContext = createContext();

const STORAGE_KEY = 'user-timezone-preference';

export function TimezoneProvider({ children, initialTimezone, useLocalStorage = true }) {
  // Initialize timezone from props, localStorage, or auto-detect
  const [selectedTimezone, setSelectedTimezone] = useState(() => {
    if (initialTimezone) {
      return initialTimezone;
    }
    if (useLocalStorage) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return stored;
      }
    }
    // Auto-detect user's timezone
    return getUserTimezone();
  });

  // Sync when initialTimezone prop changes (e.g., after async settings load)
  useEffect(() => {
    if (initialTimezone) {
      setSelectedTimezone(initialTimezone);
    }
  }, [initialTimezone]);

  // Save to localStorage whenever timezone changes (only if useLocalStorage is true)
  useEffect(() => {
    if (useLocalStorage) {
      localStorage.setItem(STORAGE_KEY, selectedTimezone);
    }
  }, [selectedTimezone, useLocalStorage]);

  const value = {
    timezone: selectedTimezone,
    setTimezone: setSelectedTimezone,
  };

  return (
    <TimezoneContext.Provider value={value}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  const context = useContext(TimezoneContext);
  if (!context) {
    throw new Error('useTimezone must be used within a TimezoneProvider');
  }
  return context;
}
