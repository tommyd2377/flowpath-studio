import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Workspace from '@/components/Workspace';
import SignIn from '@/components/SignIn';
import { clientSite } from '@/lib/local-store';
import { getFirebaseSetupStatus } from '@/lib/firebase/config';
import { getWorkspaceUser } from '@/lib/firebase/session';
import { getSite, listSites } from '@/lib/site-store';
import { getEditorStatus } from '@/lib/editor-config';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const setup = getFirebaseSetupStatus();
  const host = (await headers()).get('host') || '';
  if (setup.mode === 'demo' && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return <main className="standalone-notice">This local prototype is not configured for public hosting.</main>;
  if (setup.mode === 'firebase' && !setup.enabled) return <SignIn/>;
  const user = await getWorkspaceUser();
  if (!user) redirect('/sign-in');
  const sites = await listSites(user);
  const query = await searchParams;
  const billingReturn = query.billing === 'success' || query.billing === 'cancelled';
  const selected = billingReturn && typeof query.siteId === 'string' ? sites.find(item => item.id === query.siteId) ?? sites[0] : sites[0];
  const site = selected ? clientSite(await getSite(user, selected.id)) : null;
  // Return parameters select a view only; Stripe's signed payment event owns fulfillment.
  return <Workspace initialSites={sites} initialSite={site} user={user} editor={getEditorStatus()} initialPanel={billingReturn ? 'billing' : undefined}/>;
}
