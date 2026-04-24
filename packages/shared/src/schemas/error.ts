import { z } from 'zod';

export const ErrorResponse = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  request_id: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
