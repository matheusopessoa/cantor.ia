import { z } from "zod";

export const registerUserBodySchema = z.object({
    email: z.email(),
    password: z.string().min(8),
    name: z.string().min(1),
});

export const loginBodySchema = z.object({
    email: z.email(),
    password: z.string().min(8)
})