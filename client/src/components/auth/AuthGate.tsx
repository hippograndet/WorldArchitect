import type { ReactNode } from 'react';
import { Show, SignIn, useAuth } from '@clerk/react';
import { setTokenGetter } from '../../lib/authToken.ts';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export const hostedAuthEnabled = Boolean(CLERK_PUBLISHABLE_KEY);

// Registers Clerk's getToken during render (not a useEffect) so it's available
// before any gated child's own data-fetch effect can run.
export function TokenBridge() {
  const { getToken } = useAuth();
  setTokenGetter(getToken);
  return null;
}

function SignInScreen() {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <SignIn />
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (!hostedAuthEnabled) return <>{children}</>;

  return (
    <Show when="signed-in" fallback={<SignInScreen />}>
      {children}
    </Show>
  );
}
