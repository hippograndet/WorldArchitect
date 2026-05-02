import { Outlet } from 'react-router-dom';
import ToastContainer from './components/shared/Toast.tsx';

export default function App() {
  return (
    <>
      <Outlet />
      <ToastContainer />
    </>
  );
}
