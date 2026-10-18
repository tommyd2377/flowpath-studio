import { accountServer } from '../../../lib/account-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = accountServer.waveformGET;
export const PUT = accountServer.waveformPUT;
