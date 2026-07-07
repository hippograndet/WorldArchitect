declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
      };
      tenant?: {
        ownerId: string;
        worldId?: string;
      };
      requestId?: string;
    }
  }
}

export {};
