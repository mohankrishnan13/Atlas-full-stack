import { NextResponse } from 'next/server';
import type { TeamUser } from '@/lib/types';
import placeholderData from '@/lib/placeholder-images.json';

const CLOUD_USERS: TeamUser[] = [
    { id: 1, name: "Alice DevOps", email: "alice@atlas-sec.com", role: "Admin", avatar: placeholderData.placeholderImages[0].imageUrl },
    { id: 2, name: "Bob SRE", email: "bob@atlas-sec.com", role: "Analyst", avatar: placeholderData.placeholderImages[1].imageUrl },
    { id: 3, name: "Charlie SecOps", email: "charlie@atlas-sec.com", role: "Analyst", avatar: placeholderData.placeholderImages[3].imageUrl },
];

const LOCAL_USERS: TeamUser[] = [
    { id: 1, name: "Dave IT", email: "dave.it@atlas-internal.com", role: "Admin", avatar: placeholderData.placeholderImages[1].imageUrl },
    { id: 2, name: "Eve Security", email: "eve.sec@atlas-internal.com", role: "Admin", avatar: placeholderData.placeholderImages[2].imageUrl },
    { id: 3, name: "Frank Helpdesk", email: "frank.hd@atlas-internal.com", role: "Analyst", avatar: placeholderData.placeholderImages[3].imageUrl },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_USERS : CLOUD_USERS;
  
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
