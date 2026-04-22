import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import MapClient from '@/components/MapClient';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const { userId } = await auth();
  if (!userId) redirect('/');
  return <MapClient />;
}
