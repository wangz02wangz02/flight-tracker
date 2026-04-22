import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import FavoritesClient from '@/components/FavoritesClient';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const { userId } = await auth();
  if (!userId) redirect('/');
  return (
    <section className="p-6 flex-1">
      <h1 className="text-2xl font-bold mb-4">Your favorites</h1>
      <FavoritesClient />
    </section>
  );
}
