import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

/**
 * Abmeldung.
 *
 * Bewusst als POST-Route: eine Abmeldung per GET liesse sich über ein
 * eingebettetes Bild fremdauslösen (CSRF).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  response.cookies.delete('swissov_admin_last_activity');
  return response;
}
