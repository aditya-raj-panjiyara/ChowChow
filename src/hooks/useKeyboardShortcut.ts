import { useEffect, useCallback } from 'react';

/**
 * Global keyboard shortcut hook.
 * Registers a key combination and fires the callback when triggered.
 * Automatically cleans up on unmount.
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  options: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Support Cmd on Mac, Ctrl on other platforms
      const modifierRequired = options.meta || options.ctrl;
      const modifierMatch = modifierRequired
        ? (event.metaKey || event.ctrlKey)
        : true;

      const shiftMatch = options.shift ? event.shiftKey : true;

      if (
        event.key.toLowerCase() === key.toLowerCase() &&
        modifierMatch &&
        shiftMatch
      ) {
        event.preventDefault();
        callback();
      }
    },
    [key, callback, options.meta, options.ctrl, options.shift]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
