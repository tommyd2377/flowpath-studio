import { accountServer } from '../../../lib/account-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = accountServer.accountGET;
export const POST = accountServer.accountPOST;
export const DELETE = accountServer.accountDELETE;
