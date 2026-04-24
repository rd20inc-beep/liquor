import { z } from 'zod';

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative().optional(),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const Money = z.number().nonnegative().multipleOf(0.01);

export const Uuid = z.string().uuid();

export const DateStr = z.string().date();

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type Pagination = z.infer<typeof Pagination>;

export const PaginatedResponse = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    next_cursor: z.string().nullable(),
  });

export const AgingBuckets = z.object({
  b_0_7: z.number(),
  b_8_15: z.number(),
  b_16_30: z.number(),
  b_31_60: z.number(),
  b_60_plus: z.number(),
});
export type AgingBuckets = z.infer<typeof AgingBuckets>;

export const IdParam = z.object({ id: Uuid });
