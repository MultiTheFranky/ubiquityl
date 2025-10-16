import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UdmClient } from "../udmClient";

describe("UdmClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const createAxiosStub = (overrides: Partial<ReturnType<typeof axios.create>>) =>
    ({
      defaults: { headers: { common: {} } },
      post: vi.fn(),
      request: vi.fn(),
      ...overrides,
    }) as any;

  it("authenticates and creates a port forward", async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        "set-cookie": ["csrf_token=abc; Path=/; HttpOnly"],
        "x-csrf-token": "abc",
      },
    });

    const requestMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: {
        data: {
          _id: "rule-1",
          name: "ptero-alloc-1",
          enabled: true,
          dst_port: "25565",
          fwd_port: "25565",
          fwd: "10.0.1.3",
          proto: "tcp_udp",
          src: "any",
          dst: "any",
          wanip: "wan",
        },
      },
    });

    vi.spyOn(axios, "create").mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient(
      "https://udm.example.com",
      "admin",
      "password",
      "default",
      true,
    );

    const rule = await client.createPortForward({
      name: "ptero-alloc-1",
      enabled: true,
      externalPort: 25565,
      internalPort: 25565,
      internalIp: "10.0.1.3",
      protocol: "tcp_udp",
      source: "any",
      destination: "any",
      wanIp: "wan",
    });

    expect(postMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ username: "admin" }),
      expect.any(Object),
    );
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/proxy/network/api/s/default/rest/portforward",
        data: expect.objectContaining({ proto: "tcp_udp", wanip: "wan" }),
      }),
    );
    expect(rule).toMatchObject({ id: "rule-1", protocol: "tcp_udp" });
  });

  it("lists existing port forwards", async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        "set-cookie": ["csrf_token=def; Path=/;"],
        "x-csrf-token": "def",
      },
    });

    const requestMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: {
        data: [
          {
            _id: "abc",
            name: "Example",
            enabled: true,
            dst_port: "25565",
            fwd_port: "25565",
            fwd: "10.0.1.3",
            proto: "tcp",
            src: "any",
            dst: "wan",
            wanip: "wan",
          },
        ],
      },
    });

    vi.spyOn(axios, "create").mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient(
      "https://udm.example.com",
      "admin",
      "password",
      "default",
      false,
    );

    const rules = await client.listPortForwards();

    expect(postMock).toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET" }),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: "abc", protocol: "tcp" });
  });
});
