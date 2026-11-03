import { clearPluginGrantCookies } from '../../../lib/plugin-access-server';
import { accountServer } from '../../../lib/account-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = accountServer.accountGET;
export const POST = async (request: Request) => clearPluginGrantCookies(request, await accountServer.accountPOST(request));
export const DELETE = async (request: Request) => clearPluginGrantCookies(request, await accountServer.accountDELETE(request));
