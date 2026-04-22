import type { Metadata } from 'next';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flight Tracker',
  description: 'Real-time global flight tracking. Built with Next.js, Supabase Realtime, and Clerk.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen flex flex-col">
          <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-950">
            <Link href="/" className="font-semibold tracking-wide">✈️ Flight Tracker</Link>
            <nav className="flex items-center gap-4 text-sm">
              <SignedIn>
                <Link href="/map" className="hover:text-sky-400">Map</Link>
                <Link href="/favorites" className="hover:text-sky-400">Favorites</Link>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700">Sign in</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500">Sign up</button>
                </SignUpButton>
              </SignedOut>
            </nav>
          </header>
          <main className="flex-1 flex flex-col">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
