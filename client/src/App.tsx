import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { UserButton } from '@clerk/react';
import { useStore } from './stores/index.ts';
import ToastContainer from './components/shared/Toast.tsx';
import { hostedAuthEnabled } from './components/auth/AuthGate.tsx';

export default function App() {
  const globalTheme = useStore((s) => s.globalTheme);
  const fontSize = useStore((s) => s.fontSize);

  useEffect(() => {
    if (globalTheme !== 'default') {
      document.documentElement.setAttribute('data-theme', globalTheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [globalTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--wa-fs', String(fontSize));
  }, [fontSize]);

  return (
    <>
      {hostedAuthEnabled && (
        <div className="fixed bottom-4 left-4 z-40">
          <UserButton />
        </div>
      )}
      <Outlet />
      <ToastContainer />
    </>
  );
}
