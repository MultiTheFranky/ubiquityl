import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const importLogger = async () => {
  vi.resetModules();
  return import("../logger");
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("does not output when DEBUG is falsy", async () => {
    process.env.DEBUG = "";
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { logDebug } = await importLogger();

    logDebug("message");
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints debug statements when DEBUG is true", async () => {
    process.env.DEBUG = "true";
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { logDebug } = await importLogger();

    logDebug("message", { payload: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
