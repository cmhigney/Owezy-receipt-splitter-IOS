import { createTRPCRouter } from "./create-context";
import { usersRouter } from "./routes/users";
import { friendsRouter } from "./routes/friends";
import { splitsRouter } from "./routes/splits";
import { scansRouter } from "./routes/scans";

export const appRouter = createTRPCRouter({
  users: usersRouter,
  friends: friendsRouter,
  splits: splitsRouter,
  scans: scansRouter,
});

export type AppRouter = typeof appRouter;
