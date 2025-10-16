import { describe, expect, it } from "vitest";

import type { Allocation } from "../pterodactylClient";
import type { AppConfig } from "../config";
import { SyncService } from "../syncService";
import type { PterodactylClient } from "../pterodactylClient";
import type { UdmClient } from "../udmClient";

const baseConfig: AppConfig = {
  pterodactyl: {
    url: "https://panel.example.com",
    apiKey: "api-key",
    nodeId: 1,
    pollIntervalMs: 1_000,
  },
  udm: {
    url: "https://udm.example.com",
    username: "admin",
    password: "password",
    site: "default",
    allowSelfSigned: true,
    namePrefix: "ptero-alloc-",
    protocol: "tcp_udp",
    defaultTargetIp: "10.0.1.10",
    targetIpMap: {},
    wanIp: "any",
    source: "any",
    destination: "any",
  },
};

const allocationFactory = (overrides: Partial<Allocation> = {}): Allocation => ({
  id: 101,
  ip: "198.51.100.10",
  ipAlias: null,
  port: 25565,
  notes: null,
  isDefault: false,
  ...overrides,
});

const createService = (configOverrides: Partial<AppConfig["udm"]> = {}) => {
  const config: AppConfig = {
    ...baseConfig,
    udm: {
      ...baseConfig.udm,
      ...configOverrides,
    },
  };

  return new SyncService(
    config,
    {} as unknown as PterodactylClient,
    {} as unknown as UdmClient,
  );
};

const invokeResolveTargetIp = (service: SyncService, allocation: Allocation): string | null => {
  const resolver = service as unknown as {
    resolveTargetIp: (alloc: Allocation) => string | null;
  };
  return resolver.resolveTargetIp(allocation);
};

describe("SyncService.resolveTargetIp", () => {
  it("returns a mapped IP when the allocation IP matches", () => {
    const service = createService({
      targetIpMap: {
        "198.51.100.10": "10.0.1.20",
      },
    });
    const allocation = allocationFactory();

    expect(invokeResolveTargetIp(service, allocation)).toBe("10.0.1.20");
  });

  it("falls back to alias mapping when available", () => {
    const service = createService({
      targetIpMap: {
        "203.0.113.20": "10.0.1.30",
      },
    });
    const allocation = allocationFactory({ ipAlias: "203.0.113.20" });

    expect(invokeResolveTargetIp(service, allocation)).toBe("10.0.1.30");
  });

  it("uses the default target IP when no mapping exists", () => {
    const service = createService({
      defaultTargetIp: "10.0.1.40",
    });
    const allocation = allocationFactory();

    expect(invokeResolveTargetIp(service, allocation)).toBe("10.0.1.40");
  });

  it("returns null when no mapping or default is configured", () => {
    const service = createService({
      targetIpMap: {},
      defaultTargetIp: undefined,
    });
    const allocation = allocationFactory();

    expect(invokeResolveTargetIp(service, allocation)).toBeNull();
  });
});
