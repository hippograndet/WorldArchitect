import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ClerkProvider } from '@clerk/react';
import { router } from './routes.tsx';
import { AuthGate, TokenBridge, hostedAuthEnabled } from './components/auth/AuthGate.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

const app = hostedAuthEnabled ? (
  <ClerkProvider
    publishableKey={clerkPublishableKey}
    afterSignOutUrl="/"
    signInUrl="/"
    signUpUrl="/"
    signInFallbackRedirectUrl="/"
    signUpFallbackRedirectUrl="/"
  >
    <TokenBridge />
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </ClerkProvider>
) : (
  <RouterProvider router={router} />
);

createRoot(root).render(<StrictMode>{app}</StrictMode>);
