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
export default async function Page() {
  const setup = getFirebaseSetupStatus();
  const host = (await headers()).get('host') || '';
  if (setup.mode === 'demo' && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return <main className="standalone-notice">This local prototype is not configured for public hosting.</main>;
  if (setup.mode === 'firebase' && !setup.enabled) return <SignIn/>;
  const user = await getWorkspaceUser();
  if (!user) redirect('/sign-in');
  const sites = await listSites(user);
  const site = sites.length ? clientSite(await getSite(user, sites[0].id)) : null;
  return <Workspace initialSites={sites} initialSite={site} user={user} editor={getEditorStatus()}/>;
}
