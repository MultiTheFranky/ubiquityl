import axios, { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UdmClient } from '../udmClient';
import type { PortForwardRule } from '../udmClient';

describe('UdmClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const createAxiosStub = (overrides: Partial<ReturnType<typeof axios.create>>) =>
    ({
      defaults: { headers: { common: {} } },
      post: vi.fn(),
      request: vi.fn(),
      ...overrides,
    }) as ReturnType<typeof axios.create>;

  it('authenticates and creates a port forward', async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        'set-cookie': ['csrf_token=abc; Path=/; HttpOnly'],
        'x-csrf-token': 'abc',
      },
    });

    const requestMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: {
        data: {
          _id: 'rule-1',
          name: 'ptero-alloc-1',
          enabled: true,
          dst_port: '25565',
          fwd_port: '25565',
          fwd: '10.0.1.3',
          proto: 'tcp_udp',
          src: 'any',
          dst: 'any',
          wanip: 'wan',
        },
      },
    });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);

    const rule = await client.createPortForward({
      name: 'ptero-alloc-1',
      enabled: true,
      externalPort: 25565,
      internalPort: 25565,
      internalIp: '10.0.1.3',
      protocol: 'tcp_udp',
      source: 'any',
      destination: 'any',
      wanIp: 'wan',
    });

    expect(postMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ username: 'admin' }),
      expect.any(Object),
    );
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/proxy/network/api/s/default/rest/portforward',
        data: expect.objectContaining({ proto: 'tcp_udp', wanip: 'wan' }),
      }),
    );
    expect(rule).toMatchObject({ id: 'rule-1', protocol: 'tcp_udp' });
  });

  it('lists existing port forwards', async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        'set-cookie': ['csrf_token=def; Path=/;'],
        'x-csrf-token': 'def',
      },
    });

    const requestMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: {
        data: [
          {
            _id: 'abc',
            name: 'Example',
            enabled: true,
            dst_port: '25565',
            fwd_port: '25565',
            fwd: '10.0.1.3',
            proto: 'tcp',
            src: 'any',
            dst: 'wan',
            wanip: 'wan',
          },
        ],
      },
    });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', false);

    const rules = await client.listPortForwards();

    expect(postMock).toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'abc', protocol: 'tcp' });
  });

  it('handles list responses returned as flat arrays', async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        'set-cookie': ['csrf_token=xyz; Path=/;'],
        'x-csrf-token': 'xyz',
      },
    });

    const requestMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: [
        {
          _id: 'flat',
          name: 'Flat',
          enabled: false,
          dst_port: '80',
          fwd_port: '8080',
          fwd: '10.0.1.50',
          proto: 'tcp-udp',
          src: 'any',
          dst: 'any',
          wanip: 'any',
        },
      ],
    });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', false);

    const rules = await client.listPortForwards();

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'flat', protocol: 'tcp_udp', enabled: false });
  });

  it('returns an empty list when the response lacks data', async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        'set-cookie': ['csrf_token=uvw; Path=/;'],
        'x-csrf-token': 'uvw',
      },
    });

    const requestMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: {},
    });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', false);

    const rules = await client.listPortForwards();

    expect(rules).toEqual([]);
  });

  it('updates and deletes existing port forwards', async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        'set-cookie': ['csrf_token=ghi; Path=/; HttpOnly'],
        'x-csrf-token': 'ghi',
      },
    });

    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          data: {
            _id: 'rule-1',
            name: 'ptero-alloc-1',
            enabled: true,
            dst_port: '25565',
            fwd_port: '25565',
            fwd: '10.0.1.20',
            proto: 'udp',
            src: 'any',
            dst: 'any',
            wanip: 'wan',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {},
      });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);

    const existingRule: PortForwardRule = {
      id: 'rule-1',
      name: 'ptero-alloc-1',
      enabled: true,
      externalPort: '25565',
      internalPort: '25565',
      internalIp: '10.0.1.10',
      protocol: 'tcp_udp',
      source: 'any',
      destination: 'any',
      wanIp: 'wan',
      raw: {} as never,
    };

    const updated = await client.updatePortForward(existingRule, {
      name: 'ptero-alloc-1',
      enabled: true,
      externalPort: 25565,
      internalPort: 25565,
      internalIp: '10.0.1.20',
      protocol: 'udp',
      source: 'any',
      destination: 'any',
      wanIp: 'wan',
    });

    await client.deletePortForward('rule-1');

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'PUT',
        url: '/proxy/network/api/s/default/rest/portforward/rule-1',
        data: expect.objectContaining({ proto: 'udp', fwd: '10.0.1.20' }),
      }),
    );
    expect(updated).toMatchObject({ id: 'rule-1', internalIp: '10.0.1.20', protocol: 'udp' });
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'DELETE',
        url: '/proxy/network/api/s/default/rest/portforward/rule-1',
      }),
    );
  });

  it('re-authenticates when the session expires', async () => {
    const postMock = vi.fn().mockResolvedValue({
      headers: {
        'set-cookie': ['csrf_token=jkl; Path=/; HttpOnly'],
        'x-csrf-token': 'jkl',
      },
    });

    const authFailure = new AxiosError('Unauthorized');
    authFailure.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {
        'set-cookie': ['csrf_token=retry; Path=/; HttpOnly'],
      },
      config: {},
      data: { message: 'Unauthorized' },
    } as AxiosResponse;

    const requestMock = vi
      .fn()
      .mockRejectedValueOnce(authFailure)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: { data: [] },
      });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ post: postMock, request: requestMock }),
    );

    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);

    const rules = await client.listPortForwards();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(rules).toEqual([]);
  });

  it('attaches stored cookies to outgoing requests', async () => {
    const requestMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: {},
    });

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ request: requestMock, post: vi.fn() }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      request: (config: { method: string; url: string }) => Promise<unknown>;
      jar: { setCookie: (cookie: string, url: string) => Promise<unknown> };
      csrfToken: string | null;
    };

    internals.csrfToken = 'ready';
    await internals.jar.setCookie('session=abc; Path=/;', 'https://udm.example.com');

    await internals.request({
      method: 'GET',
      url: '/proxy/network/api/s/default/rest/portforward',
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: expect.stringContaining('session=abc'),
        }),
      }),
    );
  });

  it('rethrows non-Axios errors from request pipeline', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('boom'));

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ request: requestMock, post: vi.fn() }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      request: (config: { method: string; url: string }) => Promise<unknown>;
      csrfToken: string | null;
    };

    internals.csrfToken = 'ready';

    await expect(
      internals.request({ method: 'GET', url: '/proxy/network/api/s/default/rest/portforward' }),
    ).rejects.toThrow('boom');
  });

  it('handles Axios errors without response metadata', async () => {
    const error = new AxiosError('Network error');
    const requestMock = vi.fn().mockRejectedValue(error);

    vi.spyOn(axios, 'create').mockReturnValue(
      createAxiosStub({ request: requestMock, post: vi.fn() }),
    );

    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      request: (config: { method: string; url: string }) => Promise<unknown>;
      csrfToken: string | null;
    };

    internals.csrfToken = 'ready';

    await expect(
      internals.request({ method: 'GET', url: '/proxy/network/api/s/default/rest/portforward' }),
    ).rejects.toBe(error);
  });

  it('normalizes protocol variants', () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      normalizeProtocol: (value?: string) => string;
    };

    expect(internals.normalizeProtocol()).toBe('tcp');
    expect(internals.normalizeProtocol('UDP')).toBe('udp');
    expect(internals.normalizeProtocol('tcp-udp')).toBe('tcp_udp');
    expect(internals.normalizeProtocol('both')).toBe('tcp_udp');
    expect(internals.normalizeProtocol('unexpected')).toBe('tcp');
  });

  it('extracts CSRF tokens from various sources', async () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      extractCsrfToken: (headerToken: string | string[] | undefined) => Promise<string | null>;
      jar: { setCookie: (cookie: string, url: string) => Promise<unknown> };
    };

    expect(await internals.extractCsrfToken('header-token')).toBe('header-token');
    expect(await internals.extractCsrfToken(['array-token'])).toBe('array-token');
    expect(await internals.extractCsrfToken(undefined)).toBeNull();

    await internals.jar.setCookie('csrf_token=cookie-token; Path=/;', 'https://udm.example.com');
    expect(await internals.extractCsrfToken(undefined)).toBe('cookie-token');
  });

  it('summarises response payloads safely', () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      describeResponseData: (data: unknown) => unknown;
    };

    expect(internals.describeResponseData(undefined)).toBeNull();
    expect(internals.describeResponseData('simple')).toBe('simple');
    expect(internals.describeResponseData({ ok: true })).toEqual({ ok: true });

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(internals.describeResponseData(circular)).toBe('[unserializable object]');
  });

  it('validates unwrapSingle payload variations', () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      unwrapSingle: (payload?: { data?: unknown }) => unknown;
    };

    expect(() => internals.unwrapSingle(undefined)).toThrow('Unexpected empty response');
    expect(() => internals.unwrapSingle({ data: [] })).toThrow('empty collection');
    expect(() => internals.unwrapSingle({ data: undefined })).toThrow('missing data');

    const extracted = internals.unwrapSingle({ data: [{ _id: 'ok' }] } as never);
    expect(extracted).toMatchObject({ _id: 'ok' });
  });

  it('rejects raw port forwards that lack identifiers', () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      mapRawToRule: (raw: Record<string, unknown>) => unknown;
    };

    expect(() =>
      internals.mapRawToRule({
        name: 'missing-id',
      }),
    ).toThrow('Encountered port forward entry without an identifier');
  });

  it('stores cookie headers supplied as strings', async () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      storeCookies: (raw: string | string[] | undefined, url: string) => Promise<void>;
      jar: { getCookieString: (url: string) => Promise<string> };
    };

    await internals.storeCookies(undefined, 'https://udm.example.com');
    await internals.storeCookies('session=xyz; Path=/;', 'https://udm.example.com');

    const cookieString = await internals.jar.getCookieString('https://udm.example.com');
    expect(cookieString).toContain('session=xyz');
  });

  it('maps raw port forwards with fallback defaults', () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('https://udm.example.com', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      mapRawToRule: (raw: Record<string, unknown>) => PortForwardRule;
    };

    const mapped = internals.mapRawToRule({
      _id: 'minimal',
    });

    expect(mapped).toMatchObject({
      id: 'minimal',
      name: '',
      enabled: true,
      externalPort: '',
      internalPort: '',
      internalIp: '',
      source: 'any',
      destination: 'any',
      protocol: 'tcp',
    });
  });

  it('resolves URLs safely when base is invalid', () => {
    vi.spyOn(axios, 'create').mockReturnValue(createAxiosStub({ post: vi.fn(), request: vi.fn() }));
    const client = new UdmClient('nota-url', 'admin', 'password', 'default', true);
    const internals = client as unknown as {
      resolveUrl: (path?: string) => string;
    };

    expect(internals.resolveUrl('/anything')).toBe('nota-url');
  });
});
