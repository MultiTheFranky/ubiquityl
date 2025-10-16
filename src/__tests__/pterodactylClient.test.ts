import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PterodactylClient } from "../pterodactylClient";

describe("PterodactylClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a single page of allocations", async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: {
        data: [
          {
            attributes: {
              id: 10,
              ip: "198.51.100.10",
              ip_alias: null,
              port: 25565,
              notes: null,
              is_default: false,
            },
          },
        ],
        meta: {
          pagination: {
            current_page: 1,
            total_pages: 1,
          },
        },
      },
    });

    vi.spyOn(axios, "create").mockReturnValue({ get: getMock } as ReturnType<typeof axios.create>);

    const client = new PterodactylClient("https://panel.example.com", "token");
    const allocations = await client.listAllocations(5);

    expect(getMock).toHaveBeenCalledWith("/nodes/5/allocations", {
      params: { page: 1, per_page: 50 },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ id: 10, port: 25565 });
  });

  it("handles pagination by merging subsequent pages", async () => {
    const getMock = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              attributes: {
                id: 1,
                ip: "198.51.100.10",
                ip_alias: null,
                port: 25565,
                notes: null,
                is_default: false,
              },
            },
          ],
          meta: {
            pagination: {
              current_page: 1,
              total_pages: 2,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              attributes: {
                id: 2,
                ip: "198.51.100.11",
                ip_alias: null,
                port: 25566,
                notes: null,
                is_default: false,
              },
            },
          ],
          meta: {
            pagination: {
              current_page: 2,
              total_pages: 2,
            },
          },
        },
      });

    vi.spyOn(axios, "create").mockReturnValue({ get: getMock } as ReturnType<typeof axios.create>);

    const client = new PterodactylClient("https://panel.example.com", "token");
    const allocations = await client.listAllocations(7);

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(allocations.map((alloc) => alloc.id)).toEqual([1, 2]);
  });
});
