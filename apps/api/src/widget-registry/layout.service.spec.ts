import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { WidgetLayoutItem } from "@command-center/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { LayoutRepository } from "./layout.repository";
import { LayoutService } from "./layout.service";

const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  token: "jwt",
};

function item(widgetId: string): WidgetLayoutItem {
  return { widgetId, gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} };
}

describe("LayoutService", () => {
  let service: LayoutService;
  let repository: jest.Mocked<
    Pick<LayoutRepository, "findAllForUser" | "replaceForUser">
  >;

  beforeEach(async () => {
    repository = {
      findAllForUser: jest.fn(),
      replaceForUser: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LayoutService,
        { provide: LayoutRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get(LayoutService);
  });

  it("returns the persisted layout for the user", async () => {
    repository.findAllForUser.mockResolvedValue([item("clock")]);

    await expect(service.getLayout(user)).resolves.toEqual({
      items: [item("clock")],
    });
    expect(repository.findAllForUser).toHaveBeenCalledWith(user);
  });

  it("replaces the layout and echoes the persisted items", async () => {
    const items = [item("clock"), item("braindump")];

    await expect(service.putLayout(user, { items })).resolves.toEqual({ items });
    expect(repository.replaceForUser).toHaveBeenCalledWith(user, items);
  });

  it("rejects duplicate widget ids without touching persistence", async () => {
    const items = [item("clock"), item("clock")];

    await expect(service.putLayout(user, { items })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.replaceForUser).not.toHaveBeenCalled();
  });
});
