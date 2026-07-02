import { useState, useCallback } from 'react';

/**
 * Navigation state hook — manages nav rail collapse and provides utilities.
 */
export function useNavigation() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  return {
    isCollapsed,
    toggleCollapse,
  };
}
