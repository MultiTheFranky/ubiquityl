import axios, { AxiosInstance } from "axios";
import { logDebug } from "./logger";

export interface Allocation {
  id: number;
  ip: string;
  ipAlias: string | null;
  port: number;
  notes: string | null;
  isDefault: boolean;
}

interface AllocationResponse {
  object: string;
  attributes: {
    id: number;
    ip: string;
    ip_alias: string | null;
    port: number;
    notes: string | null;
    is_default: boolean;
  };
}

interface PaginatedResponse {
  object: string;
  data: AllocationResponse[];
  meta?: {
    pagination?: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

export class PterodactylClient {
  private readonly http: AxiosInstance;

  constructor(private readonly baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: `${baseUrl}/api/application`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 15_000,
    });
  }

  async listAllocations(nodeId: number): Promise<Allocation[]> {
    const allocations: Allocation[] = [];
    let currentPage = 1;

    while (true) {
      logDebug("[ptero] Fetching allocations", {
        nodeId,
        page: currentPage,
      });
      const response = await this.http.get<PaginatedResponse>(
        `/nodes/${nodeId}/allocations`,
        {
          params: {
            page: currentPage,
            per_page: 50,
          },
        },
      );

      const payload = response.data;
      if (!Array.isArray(payload.data)) {
        throw new Error("Unexpected payload when fetching allocations from Pterodactyl");
      }

      allocations.push(
        ...payload.data.map((item) => ({
          id: item.attributes.id,
          ip: item.attributes.ip,
          ipAlias: item.attributes.ip_alias,
          port: item.attributes.port,
          notes: item.attributes.notes,
          isDefault: item.attributes.is_default,
        })),
      );
      logDebug("[ptero] Received allocation page", {
        nodeId,
        page: currentPage,
        count: payload.data.length,
      });

      const pagination = payload.meta?.pagination;
      if (!pagination || pagination.current_page >= pagination.total_pages) {
        break;
      }
      currentPage += 1;
    }

    logDebug("[ptero] Completed allocation fetch", {
      nodeId,
      total: allocations.length,
    });

    return allocations;
  }
}
