import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().max(255).check(z.email());

const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .superRefine((value, ctx) => {
    if (!/[A-Za-z]/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Must contain at least one letter' });
    }
    if (!/[0-9]/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Must contain at least one digit' });
    }
  });

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.password === data.name) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must not equal the name',
      });
    }
    if (data.password === data.email) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must not equal the email',
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(72),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
