import type { User } from "../generated/prisma/client.js";
import { prisma } from "../utils/prisma.js";

export interface CreateUserData {
  email: string;
  emailBindex: string;
  password: string;
  name: string;
  lastPasswords: string[];
}

interface Password {
  password: string;
  passwordHash: string;
}

export const userRepository = {
  findByEmailBindex(emailBindex: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { emailBindex } });
  },

  create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  },

};