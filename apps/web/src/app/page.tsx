import Link from 'next/link';
import { SignedIn, SignedOut, SignUpButton } from '@clerk/nextjs';

export default function Home() {
  return (
    <section className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Live flights, streamed to your browser.
        </h1>
        <p className="text-slate-400 text-lg">
          A Railway worker polls the OpenSky Network every 30 seconds and pushes updates into
          Supabase. The map you see here subscribes via Realtime — no refresh, no polling in the
          browser.
        </p>
        <div className="flex items-center justify-center gap-3">
          <SignedIn>
            <Link href="/map" className="px-5 py-2 rounded bg-sky-600 hover:bg-sky-500">Open the map</Link>
          </SignedIn>
          <SignedOut>
            <SignUpButton mode="modal">
              <button className="px-5 py-2 rounded bg-sky-600 hover:bg-sky-500">Sign up to start</button>
            </SignUpButton>
          </SignedOut>
        </div>
      </div>
    </section>
  );
}
