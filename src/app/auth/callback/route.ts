import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

// Every Supabase email link (recovery, invite, email change) bounces
// through here. Two shapes arrive: `code`, from the PKCE flow the
// browser client uses, and `token_hash` + `type`, from links minted
// server-side (admin generate_link, or the older implicit flow).
// Either way we turn it into a session cookie and forward the user to
// `next`.

const DEFAULT_NEXT = '/dashboard';

// `next` is attacker-supplied query string. Same-origin absolute paths
// only — `//evil.com` is a protocol-relative URL the browser would
// happily follow off-site.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_NEXT;
  return raw;
}

// Deliberately a RELATIVE Location, not `new URL(path, request.url)`.
// Behind a reverse proxy the request URL is the *internal* one: with
// the Cloudflare Tunnel in front of this app, cloudflared sends
// `Host: localhost:3000` while `x-forwarded-proto` says https, so an
// absolute redirect built from the request comes out as the nonexistent
// `https://localhost:3000/...`. A relative Location is resolved by the
// browser against the address it actually typed, so the same code works
// on localhost, through the tunnel, and on whatever domain this ends up
// served from. Every target here is on this site, so we never need an
// absolute URL. NextResponse.redirect() demands one, hence the manual
// header.
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  const failure = (reason: string) =>
    redirectTo(`/login?error=${encodeURIComponent(reason)}`);

  const supabase = await createClient();

  if (code) {
    // The PKCE verifier sits in a cookie written when the reset was
    // requested, so a link opened in a different browser than the one
    // that asked for it cannot be exchanged — that surfaces as an
    // error here rather than a silent bounce.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(error.message);
    return redirectTo(next);
  }

  if (tokenHash) {
    // A link that lost its `type` on the way here (shells and chat
    // clients love to truncate at `&`) is not the same failure as a
    // link that never carried a token — say which one it was.
    if (!type) return failure('missing_type');

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) return failure(error.message);
    return redirectTo(next);
  }

  return failure('missing_code');
}
