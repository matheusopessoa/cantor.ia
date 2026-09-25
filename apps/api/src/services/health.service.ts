interface HealthStatus {
  status: string;
  timestamp: Date;
}

export const healthService = {
  check(): HealthStatus {
    return {
      status: "ok",
      timestamp: new Date(),
    };
  },
};
