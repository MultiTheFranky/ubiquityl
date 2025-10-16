import { AppConfig } from "./config";
import { logDebug } from "./logger";
import { Allocation, PterodactylClient } from "./pterodactylClient";
import {
  PortForwardRequest,
  PortForwardRule,
  UdmClient,
  UdmProtocol,
} from "./udmClient";

export class SyncService {
  private intervalRef: NodeJS.Timeout | null = null;
  private syncing = false;

  private readonly protocol: UdmProtocol;

  constructor(
    private readonly config: AppConfig,
    private readonly pterodactylClient: PterodactylClient,
    private readonly udmClient: UdmClient,
  ) {
    this.protocol = config.udm.protocol as UdmProtocol;
  }

  start(): void {
    if (this.intervalRef) {
      return;
    }

    const execute = async () => {
      try {
        await this.runSyncCycle();
      } catch (error) {
        console.error("[sync] Cycle failed:", (error as Error).message);
      }
    };

    void execute();
    this.intervalRef = setInterval(execute, this.config.pterodactyl.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async runSyncCycle(): Promise<void> {
    if (this.syncing) {
      console.warn("[sync] Previous cycle still running, skipping this tick");
      return;
    }

    this.syncing = true;
    console.log("[sync] Starting cycle");
    logDebug("[sync] Poll parameters", {
      pollIntervalMs: this.config.pterodactyl.pollIntervalMs,
      nodeId: this.config.pterodactyl.nodeId,
    });

    try {
      const [allocations, existingRules] = await Promise.all([
        this.pterodactylClient.listAllocations(this.config.pterodactyl.nodeId),
        this.udmClient.listPortForwards(),
      ]);

      logDebug("[sync] Data fetched", {
        allocationCount: allocations.length,
        ruleCount: existingRules.length,
      });

      const relevantRules = this.extractRelevantRules(existingRules);
      const desiredAllocations = new Map<number, Allocation>();
      allocations.forEach((allocation) => desiredAllocations.set(allocation.id, allocation));

      logDebug("[sync] Relevant objects", {
        managedRuleCount: relevantRules.size,
        desiredAllocations: desiredAllocations.size,
      });

      await this.reconcileRules(desiredAllocations, relevantRules);

      console.log("[sync] Cycle completed");
    } finally {
      this.syncing = false;
    }
  }

  private extractRelevantRules(rules: PortForwardRule[]): Map<number, PortForwardRule> {
    const relevant = new Map<number, PortForwardRule>();
    const { namePrefix } = this.config.udm;

    for (const rule of rules) {
      if (!rule.name.startsWith(namePrefix)) {
        continue;
      }
      const maybeId = this.parseAllocationId(rule.name);
      if (maybeId === null) {
        console.warn(
          `[sync] Found managed prefix but could not parse allocation id from rule '${rule.name}'`,
        );
        continue;
      }
      relevant.set(maybeId, rule);
    }

    return relevant;
  }

  private async reconcileRules(
    allocations: Map<number, Allocation>,
    existingRules: Map<number, PortForwardRule>,
  ): Promise<void> {
    const toDelete: PortForwardRule[] = [];
    const toCreate: Array<{ allocation: Allocation; input: PortForwardRequest }> = [];
    const toUpdate: Array<{
      rule: PortForwardRule;
      input: PortForwardRequest;
    }> = [];

    // Determine deletions and updates
    for (const [allocationId, rule] of existingRules) {
      const allocation = allocations.get(allocationId);
      if (!allocation) {
        toDelete.push(rule);
        continue;
      }

      const targetConfig = this.buildPortForwardRequest(allocation);
      if (!targetConfig) {
        console.warn(
          `[sync] Allocation ${allocation.id} missing target IP mapping; skipping update`,
        );
        continue;
      }

      if (this.isRuleOutOfSync(rule, targetConfig)) {
        toUpdate.push({ rule, input: targetConfig });
      }

      allocations.delete(allocationId);
    }

    // Remaining allocations need creation
    for (const allocation of allocations.values()) {
      const targetConfig = this.buildPortForwardRequest(allocation);
      if (!targetConfig) {
        console.warn(
          `[sync] Allocation ${allocation.id} missing target IP mapping; skipping creation`,
        );
        continue;
      }
      toCreate.push({ allocation, input: targetConfig });
    }

    await this.applyChanges({ toCreate, toUpdate, toDelete });
    logDebug("[sync] Change set summary", {
      toCreate: toCreate.length,
      toUpdate: toUpdate.length,
      toDelete: toDelete.length,
    });
  }

  private async applyChanges(changeSet: {
    toCreate: Array<{ allocation: Allocation; input: PortForwardRequest }>;
    toUpdate: Array<{ rule: PortForwardRule; input: PortForwardRequest }>;
    toDelete: PortForwardRule[];
  }): Promise<void> {
    for (const rule of changeSet.toDelete) {
      console.log(`[sync] Removing port forward '${rule.name}' (${rule.id})`);
      await this.udmClient.deletePortForward(rule.id);
    }

    for (const { rule, input } of changeSet.toUpdate) {
      console.log(`[sync] Updating port forward '${rule.name}' for allocation ${this.extractId(rule.name)}`);
      await this.udmClient.updatePortForward(rule, input);
    }

    for (const { allocation, input } of changeSet.toCreate) {
      console.log(`[sync] Creating port forward for allocation ${allocation.id}`);
      await this.udmClient.createPortForward(input);
    }
  }

  private buildPortForwardRequest(allocation: Allocation): PortForwardRequest | null {
    const targetIp = this.resolveTargetIp(allocation);
    if (!targetIp) {
      return null;
    }

    const externalPort = allocation.port;
    const internalPort = allocation.port;

    logDebug("[sync] Building port forward request", {
      allocationId: allocation.id,
      externalPort,
      targetIp,
    });

    return {
      name: this.buildRuleName(allocation.id),
      enabled: true,
      externalPort,
      internalPort,
      internalIp: targetIp,
      protocol: this.protocol,
      source: this.config.udm.source,
      destination: this.config.udm.destination,
      wanIp: this.config.udm.wanIp,
    };
  }

  private resolveTargetIp(allocation: Allocation): string | null {
    const { targetIpMap, defaultTargetIp } = this.config.udm;
    if (targetIpMap[allocation.ip]) {
      logDebug("[sync] Resolved target via IP map", {
        allocationId: allocation.id,
        externalIp: allocation.ip,
        target: targetIpMap[allocation.ip],
      });
      return targetIpMap[allocation.ip];
    }
    if (allocation.ipAlias && targetIpMap[allocation.ipAlias]) {
      logDebug("[sync] Resolved target via IP alias", {
        allocationId: allocation.id,
        externalIp: allocation.ipAlias,
        target: targetIpMap[allocation.ipAlias],
      });
      return targetIpMap[allocation.ipAlias];
    }
    if (defaultTargetIp) {
      logDebug("[sync] Using default target IP", {
        allocationId: allocation.id,
        target: defaultTargetIp,
      });
    }
    return defaultTargetIp ?? null;
  }

  private buildRuleName(allocationId: number): string {
    return `${this.config.udm.namePrefix}${allocationId}`;
  }

  private parseAllocationId(name: string): number | null {
    const pattern = new RegExp(`^${this.escapeRegExp(this.config.udm.namePrefix)}(\\d+)$`);
    const match = pattern.exec(name);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isNaN(value) ? null : value;
  }

  private extractId(name: string): string {
    return name.replace(this.config.udm.namePrefix, "");
  }

  private isRuleOutOfSync(rule: PortForwardRule, target: PortForwardRequest): boolean {
    if (rule.internalIp !== target.internalIp) {
      return true;
    }

    if (rule.internalPort !== String(target.internalPort)) {
      return true;
    }

    if (rule.externalPort !== String(target.externalPort)) {
      return true;
    }

    if (!rule.enabled && target.enabled) {
      return true;
    }

    if (rule.protocol !== target.protocol) {
      return true;
    }

    if (rule.source !== target.source) {
      return true;
    }

    if (rule.destination !== target.destination) {
      return true;
    }

    if ((rule.wanIp ?? "any") !== target.wanIp) {
      return true;
    }

    return false;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
