import { userRepository } from "../repositories/user.repository.js";
import { emailBindex } from "../utils/bindex.js";
import { UserAlreadyExistsError, UnauthorizedError } from "../utils/errors.js";
import { hash, compare } from "../utils/hash.js";
import type { FastifyInstance } from "fastify";

interface RegisterUserInput {
  email: string;
  password: string;
  name: string;
}

interface LoginUserInput {
  email: string;
  password: string;
}

interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

interface LoginResponse {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export const authService = {
  async register({ email, password, name }: RegisterUserInput): Promise<PublicUser> {
    const bindex = emailBindex(email);

    const existingUser = await userRepository.findByEmailBindex(bindex);
    if (existingUser) {
      throw new UserAlreadyExistsError(email);
    }

    const hashedPassword = await hash(password);

    const user = await userRepository.create({
      email,
      emailBindex: bindex,
      password: hashedPassword,
      name,
      lastPasswords: [hashedPassword],
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    };
  },

  async login({email, password}: LoginUserInput, app: FastifyInstance): Promise<LoginResponse> {
    const bindex = emailBindex(email);

    const user = await userRepository.findByEmailBindex(bindex);
    if (!user) {
      throw new UnauthorizedError();
    }
    
    const passwordCompare = await compare(password, user.password)
    if (!passwordCompare) {
      throw new UnauthorizedError();
    }

    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: "15m" }
    )

    const refreshToken = app.jwt.sign(
      { sub: user.id, type: "refresh" },
      { expiresIn: "7d" }
    )

    const loginReply: LoginResponse = {
    user: { id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt
          },
    accessToken: accessToken,
    refreshToken: refreshToken
    }

    return loginReply
  }
};
