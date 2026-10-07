import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

// True when the window has the native frosted backdrop (macOS and Windows only).
export function useGlass(): boolean {
  const [backdrop, setBackdrop] = useState('none');

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    invoke<string>('backdrop')
      .then(setBackdrop)
      .catch(() => setBackdrop('none'));
  }, []);

  return backdrop !== 'none';
}
