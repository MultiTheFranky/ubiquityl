import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

const baseEnv: Record<string, string> = {
  PTERODACTYL_URL: "https://panel.example.com",
  PTERODACTYL_API_KEY: "secret",
  PTERODACTYL_NODE_ID: "1",
  SYNC_INTERVAL_SECONDS: "30",
  UDM_URL: "https://udm.example.com",
  UDM_USERNAME: "admin",
  UDM_PASSWORD: "password",
  UDM_SITE: "default",
  UDM_ALLOW_SELF_SIGNED: "true",
  PORT_FORWARD_NAME_PREFIX: "ptero-alloc-",
  PORT_FORWARD_PROTOCOL: "tcp_udp",
  TARGET_IP_DEFAULT: "10.0.1.10",
  UDM_WAN_IP: "any",
  PORT_FORWARD_SOURCE: "any",
  PORT_FORWARD_DESTINATION: "any",
};

const loadConfig = async () => {
  vi.resetModules();
  return import("../config");
};

const managedKeys = [...Object.keys(baseEnv), "TARGET_IP_MAP"];

const setEnv = (overrides: Record<string, string | undefined>) => {
  const next: Record<string, string> = { ...ORIGINAL_ENV } as Record<string, string>;
  managedKeys.forEach((key) => {
    delete next[key];
  });

  Object.entries(overrides).forEach(([key, value]) => {
    if (value !== undefined) {
      next[key] = value;
    }
  });

  process.env = next as NodeJS.ProcessEnv;
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  vi.resetModules();
});

describe("config module", () => {
  it("parses a valid configuration", async () => {
    setEnv({ ...baseEnv, TARGET_IP_MAP: undefined });

    const { appConfig } = await loadConfig();

    expect(appConfig.pterodactyl.url).toBe("https://panel.example.com");
    expect(appConfig.udm.defaultTargetIp).toBe("10.0.1.10");
    expect(appConfig.udm.protocol).toBe("tcp_udp");
  });

  it("accepts a target IP map instead of a default", async () => {
    setEnv({
      ...baseEnv,
      TARGET_IP_DEFAULT: undefined,
      TARGET_IP_MAP: JSON.stringify({
        "198.51.100.10": "10.0.1.20",
      }),
    });

    const { appConfig } = await loadConfig();

    expect(appConfig.udm.defaultTargetIp).toBeUndefined();
    expect(appConfig.udm.targetIpMap["198.51.100.10"]).toBe("10.0.1.20");
  });

  it("throws when neither default nor map is provided", async () => {
    setEnv({
      ...baseEnv,
      TARGET_IP_DEFAULT: undefined,
      TARGET_IP_MAP: undefined,
    });

    await expect(loadConfig()).rejects.toThrow(/must define either TARGET_IP_DEFAULT/i);
  });

  it("throws when TARGET_IP_MAP is invalid JSON", async () => {
    setEnv({
      ...baseEnv,
      TARGET_IP_DEFAULT: undefined,
      TARGET_IP_MAP: "{invalid}",
    });

    await expect(loadConfig()).rejects.toThrow(/Failed to parse TARGET_IP_MAP/i);
  });
});
