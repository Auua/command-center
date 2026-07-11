import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { HealthResponseSchema } from "@command-center/contracts";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it("returns an ok health response matching the contract", () => {
    const result = service.getHealth();

    expect(() => HealthResponseSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("api");
    expect(Number.isNaN(Date.parse(result.time))).toBe(false);
  });
});
