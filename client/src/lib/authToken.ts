type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;

export function setTokenGetter(fn: TokenGetter | null): void {
  getter = fn;
}

export async function getAuthToken(): Promise<string | null> {
  return getter ? getter() : null;
}
