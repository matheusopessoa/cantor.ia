export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UserAlreadyExistsError extends AppError {
  constructor(email: string) {
    super(`User with email "${email}" already exists`, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(`Unauthorized for this action`, 401)
  }
}

export class InvalidEnvironmentError extends AppError {
  constructor(issues: Record<string, string[] | undefined>) {
    const details = Object.entries(issues)
      .map(([variable, messages]) => `${variable} (${messages?.join(", ")})`)
      .join("; ");

    super(`Invalid environment variables: ${details}`, 500);
  }
}

