import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useStore } from './stores/index.ts';
import ToastContainer from './components/shared/Toast.tsx';

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
      <Outlet />
      <ToastContainer />
    </>
  );
}
