import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { splitSchema } from "../schemas";
import { store } from "../../store";

const splitsListSchema = z.array(splitSchema).max(100);

export const splitsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return store.getSplits(ctx.userId);
  }),

  save: protectedProcedure
    .input(z.object({ splits: splitsListSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      return store.saveSplits(ctx.userId, input.splits);
    }),
});
