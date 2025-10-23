import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Allocation } from '../pterodactylClient';
import type { AppConfig } from '../config';
import { SyncService } from '../syncService';
import type { PterodactylClient } from '../pterodactylClient';
import type { PortForwardRequest, PortForwardRule, UdmClient } from '../udmClient';

const baseConfig: AppConfig = {
  pterodactyl: {
    url: 'https://panel.example.com',
    apiKey: 'api-key',
    nodeId: 1,
    pollIntervalMs: 1_000,
  },
  udm: {
    url: 'https://udm.example.com',
    username: 'admin',
    password: 'password',
    site: 'default',
    allowSelfSigned: true,
    namePrefix: 'ptero-alloc-',
    protocol: 'tcp_udp',
    defaultTargetIp: '10.0.1.10',
    targetIpMap: {},
    wanIp: 'any',
    source: 'any',
    destination: 'any',
  },
};

const allocationFactory = (overrides: Partial<Allocation> = {}): Allocation => ({
  id: 101,
  ip: '198.51.100.10',
  ipAlias: null,
  port: 25565,
  notes: null,
  isDefault: false,
  ...overrides,
});

const createService = (configOverrides: Partial<AppConfig['udm']> = {}) => {
  const config: AppConfig = {
    ...baseConfig,
    udm: {
      ...baseConfig.udm,
      ...configOverrides,
    },
  };

  return new SyncService(config, {} as unknown as PterodactylClient, {} as unknown as UdmClient);
};

const ruleFactory = (overrides: Partial<PortForwardRule> = {}): PortForwardRule => ({
  id: 'rule-101',
  name: 'ptero-alloc-101',
  enabled: true,
  externalPort: '25565',
  internalPort: '25565',
  internalIp: '10.0.1.10',
  protocol: 'tcp_udp',
  source: 'any',
  destination: 'any',
  wanIp: 'any',
  raw: {} as never,
  ...overrides,
});

const invokeResolveTargetIp = (service: SyncService, allocation: Allocation): string | null => {
  const resolver = service as unknown as {
    resolveTargetIp: (alloc: Allocation) => string | null;
  };
  return resolver.resolveTargetIp(allocation);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncService.resolveTargetIp', () => {
  it('returns a mapped IP when the allocation IP matches', () => {
    const service = createService({
      targetIpMap: {
        '198.51.100.10': '10.0.1.20',
      },
    });
    const allocation = allocationFactory();

    expect(invokeResolveTargetIp(service, allocation)).toBe('10.0.1.20');
  });

  it('falls back to alias mapping when available', () => {
    const service = createService({
      targetIpMap: {
        '203.0.113.20': '10.0.1.30',
      },
    });
    const allocation = allocationFactory({ ipAlias: '203.0.113.20' });

    expect(invokeResolveTargetIp(service, allocation)).toBe('10.0.1.30');
  });

  it('uses the default target IP when no mapping exists', () => {
    const service = createService({
      defaultTargetIp: '10.0.1.40',
    });
    const allocation = allocationFactory();

    expect(invokeResolveTargetIp(service, allocation)).toBe('10.0.1.40');
  });

  it('returns null when no mapping or default is configured', () => {
    const service = createService({
      targetIpMap: {},
      defaultTargetIp: undefined,
    });
    const allocation = allocationFactory();

    expect(invokeResolveTargetIp(service, allocation)).toBeNull();
  });
});

const createSyncContext = ({
  allocations = [],
  rules = [],
  configOverrides = {},
}: {
  allocations?: Allocation[];
  rules?: PortForwardRule[];
  configOverrides?: Partial<AppConfig['udm']>;
}) => {
  const config: AppConfig = {
    ...baseConfig,
    udm: {
      ...baseConfig.udm,
      ...configOverrides,
    },
  };

  const pterodactyl = {
    listAllocations: vi.fn().mockResolvedValue(allocations),
  };

  const udm = {
    listPortForwards: vi.fn().mockResolvedValue(rules),
    createPortForward: vi.fn().mockResolvedValue(undefined),
    updatePortForward: vi.fn().mockResolvedValue(undefined),
    deletePortForward: vi.fn().mockResolvedValue(undefined),
  };

  const service = new SyncService(
    config,
    pterodactyl as unknown as PterodactylClient,
    udm as unknown as UdmClient,
  );

  const runCycle = async () => {
    const runner = service as unknown as { runSyncCycle: () => Promise<void> };
    await runner.runSyncCycle();
  };

  return { runCycle, pterodactyl, udm, service };
};

describe('SyncService.runSyncCycle', () => {
  it('reconciles port forwards by deleting, updating, and creating rules', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const allocations = [
      allocationFactory({ id: 101, port: 25565 }),
      allocationFactory({ id: 202, ip: '203.0.113.20', port: 25570 }),
      allocationFactory({ id: 404, port: 27015 }),
    ];

    const ruleToKeep = ruleFactory({
      id: 'rule-101',
      name: 'ptero-alloc-101',
      internalIp: '10.0.1.10',
      externalPort: '25565',
      internalPort: '25565',
    });
    const ruleToUpdate = ruleFactory({
      id: 'rule-202',
      name: 'ptero-alloc-202',
      internalIp: '10.0.9.9',
      externalPort: '40000',
      internalPort: '40000',
      wanIp: 'wan',
    });
    const ruleToDelete = ruleFactory({
      id: 'rule-303',
      name: 'ptero-alloc-303',
    });
    const ignoredRule = ruleFactory({
      id: 'rule-ignored',
      name: 'custom-rule',
    });
    const malformedRule = ruleFactory({
      id: 'rule-bad',
      name: 'ptero-alloc-not-a-number',
    });

    const { runCycle, udm, pterodactyl } = createSyncContext({
      allocations,
      rules: [ruleToKeep, ruleToUpdate, ruleToDelete, ignoredRule, malformedRule],
      configOverrides: {
        targetIpMap: {
          '203.0.113.20': '10.0.2.20',
        },
      },
    });

    await runCycle();

    expect(pterodactyl.listAllocations).toHaveBeenCalledOnce();
    expect(udm.listPortForwards).toHaveBeenCalledOnce();

    expect(udm.deletePortForward).toHaveBeenCalledWith('rule-303');
    expect(udm.updatePortForward).toHaveBeenCalledWith(
      ruleToUpdate,
      expect.objectContaining({
        name: 'ptero-alloc-202',
        internalIp: '10.0.2.20',
        externalPort: 25570,
      }),
    );
    expect(udm.createPortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ptero-alloc-404',
        internalIp: '10.0.1.10',
        externalPort: 27015,
        wanIp: 'any',
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "[sync] Found managed prefix but could not parse allocation id from rule 'ptero-alloc-not-a-number'",
    );
  });

  it('skips changes when no target IP can be resolved', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const allocation = allocationFactory({ id: 999 });
    const existingRule = ruleFactory({
      id: 'rule-999',
      name: 'ptero-alloc-999',
      internalIp: '10.0.9.9',
    });

    const { runCycle, udm } = createSyncContext({
      allocations: [allocation],
      rules: [existingRule],
      configOverrides: {
        defaultTargetIp: undefined,
        targetIpMap: {},
      },
    });

    await runCycle();

    expect(udm.updatePortForward).not.toHaveBeenCalled();
    expect(udm.createPortForward).not.toHaveBeenCalled();
    expect(udm.deletePortForward).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[sync] Allocation 999 missing target IP mapping; skipping update',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[sync] Allocation 999 missing target IP mapping; skipping creation',
    );
  });
});

describe('SyncService lifecycle', () => {
  it('starts once and stops the polling interval cleanly', async () => {
    vi.useFakeTimers();
    const { service, pterodactyl, udm } = createSyncContext({
      allocations: [],
      rules: [],
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    service.start();
    await Promise.resolve();

    expect(pterodactyl.listAllocations).toHaveBeenCalledTimes(1);
    expect(udm.listPortForwards).toHaveBeenCalledTimes(1);

    service.start();
    await Promise.resolve();

    expect(pterodactyl.listAllocations).toHaveBeenCalledTimes(1);

    service.stop();
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    expect(pterodactyl.listAllocations).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('ignores stop calls when no interval is active', () => {
    const { service } = createSyncContext({
      allocations: [],
      rules: [],
    });
    const clearSpy = vi.spyOn(global, 'clearInterval');

    service.stop();

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('skips sync cycles while one is already running', async () => {
    const { service, pterodactyl, udm } = createSyncContext({
      allocations: [],
      rules: [],
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const runner = service as unknown as { runSyncCycle: () => Promise<void>; syncing: boolean };
    runner.syncing = true;
    await runner.runSyncCycle();

    expect(pterodactyl.listAllocations).not.toHaveBeenCalled();
    expect(udm.listPortForwards).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[sync] Previous cycle still running, skipping this tick');
  });
});

describe('SyncService.isRuleOutOfSync', () => {
  const requestFactory = (): PortForwardRequest => ({
    name: 'ptero-alloc-1',
    enabled: true,
    externalPort: 25565,
    internalPort: 25565,
    internalIp: '10.0.1.10',
    protocol: 'tcp_udp',
    source: 'any',
    destination: 'any',
    wanIp: 'any',
  });

  const getChecker = (service: SyncService) =>
    (
      service as unknown as {
        isRuleOutOfSync: (rule: PortForwardRule, target: PortForwardRequest) => boolean;
      }
    ).isRuleOutOfSync.bind(service);

  it('returns false when rule state matches target', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25565',
      enabled: true,
      protocol: 'tcp_udp',
      source: 'any',
      destination: 'any',
      wanIp: 'any',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(false);
  });

  it('detects internal port mismatches', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25564',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });

  it('detects external port mismatches', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25564',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });

  it('detects disabled rules when target expects enabled', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25565',
      enabled: false,
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });

  it('detects protocol mismatches', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25565',
      protocol: 'tcp',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });

  it('detects source restriction mismatches', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25565',
      source: 'wan-only',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });

  it('detects destination restriction mismatches', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25565',
      destination: 'lan',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });

  it('detects WAN binding mismatches', () => {
    const service = createService();
    const isOutOfSync = getChecker(service);
    const rule = ruleFactory({
      internalIp: '10.0.1.10',
      internalPort: '25565',
      externalPort: '25565',
      wanIp: 'wan',
    });

    expect(isOutOfSync(rule, requestFactory())).toBe(true);
  });
});
