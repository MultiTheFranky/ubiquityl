import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import https from 'node:https';
import { Cookie, CookieJar } from 'tough-cookie';
import { logDebug } from './logger';

export type UdmProtocol = 'tcp' | 'udp' | 'tcp_udp';

export interface PortForwardRule {
  id: string;
  name: string;
  enabled: boolean;
  externalPort: string;
  internalPort: string;
  internalIp: string;
  protocol: UdmProtocol;
  source: string;
  destination: string;
  wanIp?: string;
  raw: RawPortForward;
}

export interface PortForwardRequest {
  name: string;
  enabled: boolean;
  externalPort: number;
  internalPort: number;
  internalIp: string;
  protocol: UdmProtocol;
  source: string;
  destination: string;
  wanIp: string;
}

interface RawPortForward {
  _id: string;
  name: string;
  enabled?: boolean;
  dst_port?: string;
  fwd_port?: string;
  fwd?: string;
  proto?: string;
  src?: string;
  dst?: string;
  wanip?: string;
  site_id?: string;
  [key: string]: unknown;
}

interface PortForwardResponse {
  data?: RawPortForward | RawPortForward[];
}

interface PortForwardPayload {
  _id?: string;
  name: string;
  enabled: boolean;
  proto: string;
  dst_port: string;
  fwd_port: string;
  fwd: string;
  src: string;
  dst: string;
  wanip: string;
  site_id: string;
  [key: string]: unknown;
}

export class UdmClient {
  private readonly http: AxiosInstance;
  private readonly siteEndpoint: string;
  private jar: CookieJar;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;

  private loginPromise: Promise<void> | null = null;
  private csrfToken: string | null = null;

  constructor(
    baseUrl: string,
    username: string,
    password: string,
    private readonly site: string,
    allowSelfSigned: boolean,
  ) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.siteEndpoint = `/proxy/network/api/s/${this.site}/rest/portforward`;
    this.jar = new CookieJar();

    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: !allowSelfSigned }),
      timeout: 15_000,
      withCredentials: true,
    });
  }

  async listPortForwards(): Promise<PortForwardRule[]> {
    logDebug('[udm] Listing port forwards');
    const response = await this.request<PortForwardResponse | RawPortForward[]>({
      method: 'GET',
      url: this.siteEndpoint,
    });

    const payload = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.data)
        ? response.data?.data
        : [];

    logDebug('[udm] List port forwards response', { count: payload.length });
    if (payload[0]) {
      logDebug('[udm] Sample existing port forward', payload[0]);
    }

    return payload.map((raw) => this.mapRawToRule(raw));
  }

  async createPortForward(request: PortForwardRequest): Promise<PortForwardRule> {
    const payload = this.toPayload(request);
    logDebug('[udm] Creating port forward', {
      name: payload.name,
      externalPort: payload.dst_port,
      internalIp: payload.fwd,
      source: payload.src,
      destination: payload.dst,
      wanIp: payload.wanip,
      protocol: payload.proto,
    });
    const response = await this.request<PortForwardResponse>({
      method: 'POST',
      url: this.siteEndpoint,
      data: payload,
    });
    const raw = this.unwrapSingle(response.data);
    return this.mapRawToRule(raw);
  }

  async updatePortForward(
    rule: PortForwardRule,
    request: PortForwardRequest,
  ): Promise<PortForwardRule> {
    const payload = {
      ...rule.raw,
      ...this.toPayload(request),
      _id: rule.id,
    };
    logDebug('[udm] Updating port forward', {
      id: rule.id,
      name: rule.name,
      externalPort: payload.dst_port,
      internalIp: payload.fwd,
      protocol: payload.proto,
    });
    const response = await this.request<PortForwardResponse>({
      method: 'PUT',
      url: `${this.siteEndpoint}/${rule.id}`,
      data: payload,
    });
    const raw = this.unwrapSingle(response.data);
    return this.mapRawToRule(raw);
  }

  async deletePortForward(id: string): Promise<void> {
    logDebug('[udm] Deleting port forward', { id });
    await this.request<void>({
      method: 'DELETE',
      url: `${this.siteEndpoint}/${id}`,
    });
  }

  private async request<T>(config: AxiosRequestConfig, attempt = 0): Promise<AxiosResponse<T>> {
    await this.ensureAuthenticated();

    const prepared: AxiosRequestConfig = {
      ...config,
      headers: {
        ...config.headers,
      },
    };

    const targetUrl = this.resolveUrl(config.url);
    const cookieHeader = await this.jar.getCookieString(targetUrl);
    if (cookieHeader) {
      prepared.headers = prepared.headers ?? {};
      prepared.headers.Cookie = cookieHeader;
    }

    try {
      logDebug('[udm] HTTP request', {
        method: prepared.method,
        url: prepared.url,
        attempt,
        hasCookie: Boolean(cookieHeader),
      });
      const response = await this.http.request<T>(prepared);
      await this.storeCookies(response.headers['set-cookie'], targetUrl);
      logDebug('[udm] HTTP response', {
        method: prepared.method,
        url: prepared.url,
        status: response.status,
      });
      return response;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.headers) {
          await this.storeCookies(error.response.headers['set-cookie'], targetUrl);
        }
        if (attempt === 0 && this.isAuthError(error)) {
          await this.invalidateAuth();
          return this.request(config, attempt + 1);
        }

        const errorData = this.describeResponseData(error.response?.data);
        logDebug('[udm] HTTP error', {
          method: prepared.method,
          url: prepared.url,
          status: error.response?.status,
          message: error.message,
          data: errorData,
        });
        if (error.response?.status && error.response.status >= 400) {
          const serialized = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
          console.error(
            `[udm] Request failed: ${prepared.method ?? 'GET'} ${prepared.url ?? ''} -> ${error.response.status} | ${serialized}`,
          );
        }
      }
      throw error;
    }
  }

  private isAuthError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }
    const status = error.response?.status;
    return status === 401 || status === 403;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.csrfToken) {
      return;
    }
    if (!this.loginPromise) {
      logDebug('[udm] Starting authentication');
      this.loginPromise = this.authenticate();
    }
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  private async authenticate(): Promise<void> {
    await this.resetSession();

    const loginUrl = this.resolveUrl('/api/auth/login');
    logDebug('[udm] Logging in', { loginUrl });
    const response = await this.http.post(
      '/api/auth/login',
      {
        username: this.username,
        password: this.password,
        rememberMe: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    await this.storeCookies(response.headers['set-cookie'], loginUrl);

    const csrfToken = await this.extractCsrfToken(response.headers['x-csrf-token']);
    if (!csrfToken) {
      throw new Error('Unable to determine CSRF token from UDM authentication response');
    }

    this.csrfToken = csrfToken;
    this.http.defaults.headers.common['X-CSRF-Token'] = csrfToken;
    logDebug('[udm] Authentication successful');
  }

  private async extractCsrfToken(
    headerToken: string | string[] | undefined,
  ): Promise<string | null> {
    if (Array.isArray(headerToken) && headerToken.length > 0) {
      return headerToken[0];
    }
    if (typeof headerToken === 'string' && headerToken.length > 0) {
      return headerToken;
    }

    const cookies = await this.jar.getCookies(this.baseUrl);
    const cookieToken = cookies.find((cookie: Cookie) => cookie.key === 'csrf_token');
    return cookieToken?.value ?? null;
  }

  private async storeCookies(
    rawCookies: string | string[] | undefined,
    url: string,
  ): Promise<void> {
    if (!rawCookies) {
      return;
    }
    const cookieList = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    if (cookieList.length > 0) {
      logDebug('[udm] Storing cookies', { count: cookieList.length, url });
    }
    await Promise.all(
      cookieList.filter(Boolean).map((cookieHeader) => this.jar.setCookie(cookieHeader, url)),
    );
  }

  private describeResponseData(data: unknown): unknown {
    if (!data) {
      return null;
    }
    if (typeof data === 'string') {
      return data.slice(0, 500);
    }
    if (typeof data === 'object') {
      try {
        return JSON.parse(JSON.stringify(data));
      } catch {
        return '[unserializable object]';
      }
    }
    return data;
  }

  private async resetSession(): Promise<void> {
    this.jar = new CookieJar();
    this.csrfToken = null;
    delete this.http.defaults.headers.common['X-CSRF-Token'];
    logDebug('[udm] Session reset');
  }

  private async invalidateAuth(): Promise<void> {
    await this.resetSession();
    logDebug('[udm] Authentication invalidated, will retry');
  }

  private toPayload(request: PortForwardRequest): PortForwardPayload {
    return {
      name: request.name,
      enabled: request.enabled,
      proto: this.serializeProtocol(request.protocol),
      dst_port: String(request.externalPort),
      fwd_port: String(request.internalPort),
      fwd: request.internalIp,
      src: request.source,
      dst: request.destination,
      wanip: request.wanIp,
      site_id: this.site,
    };
  }

  private serializeProtocol(protocol: UdmProtocol): string {
    return protocol;
  }

  private unwrapSingle(payload?: PortForwardResponse): RawPortForward {
    if (!payload) {
      throw new Error('Unexpected empty response from UDM Pro API');
    }
    if (Array.isArray(payload.data)) {
      if (payload.data.length === 0) {
        throw new Error('UDM Pro API returned an empty collection');
      }
      return payload.data[0];
    }
    if (!payload.data) {
      throw new Error('UDM Pro API response missing data');
    }
    return payload.data;
  }

  private mapRawToRule(raw: RawPortForward): PortForwardRule {
    if (!raw._id) {
      throw new Error('Encountered port forward entry without an identifier');
    }

    const proto = this.normalizeProtocol(raw.proto);

    return {
      id: raw._id,
      name: raw.name ?? '',
      enabled: raw.enabled ?? true,
      externalPort: raw.dst_port ?? '',
      internalPort: raw.fwd_port ?? '',
      internalIp: raw.fwd ?? '',
      protocol: proto,
      source: raw.src ?? 'any',
      destination: raw.dst ?? 'any',
      wanIp: raw.wanip,
      raw,
    };
  }

  private normalizeProtocol(value?: string): UdmProtocol {
    if (!value) {
      return 'tcp';
    }
    switch (value.toLowerCase()) {
      case 'tcp':
        return 'tcp';
      case 'udp':
        return 'udp';
      case 'both':
      case 'tcp_udp':
      case 'tcp-udp':
        return 'tcp_udp';
      default:
        return 'tcp';
    }
  }

  private resolveUrl(path?: string): string {
    try {
      return new URL(path ?? '', this.baseUrl).toString();
    } catch {
      return this.baseUrl;
    }
  }
}
