import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
  })),
}));

import { GET } from './route';

function request(query: string) {
  return new NextRequest(`http://localhost:3000/auth/callback${query}`);
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset();
  mocks.verifyOtp.mockReset();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
});

describe('GET /auth/callback', () => {
  it('exchanges a PKCE code and forwards to next', async () => {
    const res = await GET(request('?code=abc&next=/reset-password'));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/reset-password');
  });

  it('verifies a token_hash link when there is no code', async () => {
    const res = await GET(
      request('?token_hash=hash-1&type=recovery&next=/reset-password')
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'hash-1',
    });
    expect(res.headers.get('location')).toBe('/reset-password');
  });

  it('falls back to the dashboard when next is missing', async () => {
    const res = await GET(request('?code=abc'));

    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('refuses a protocol-relative next instead of leaving the site', async () => {
    const res = await GET(request('?code=abc&next=//evil.example'));

    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('refuses an absolute next', async () => {
    const res = await GET(
      request('?code=abc&next=https%3A%2F%2Fevil.example%2Fx')
    );

    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('sends a failed exchange back to login with the reason', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: 'code verifier missing' },
    });

    const res = await GET(request('?code=abc&next=/reset-password'));

    expect(res.headers.get('location')).toBe(
      '/login?error=code%20verifier%20missing'
    );
  });

  it('sends a failed otp verification back to login', async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: 'expired' } });

    const res = await GET(request('?token_hash=hash-1&type=recovery'));

    expect(res.headers.get('location')).toBe('/login?error=expired');
  });

  it('names the missing type when a token_hash link was truncated', async () => {
    const res = await GET(request('?token_hash=hash-1'));

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('/login?error=missing_type');
  });

  it('rejects a callback with neither code nor token_hash', async () => {
    const res = await GET(request(''));

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('/login?error=missing_code');
  });
});
